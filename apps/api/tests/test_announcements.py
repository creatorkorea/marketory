import psycopg
import pytest
from test_communications import client_for, data
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers
from test_reviews import fixture


def create(c, actor, pid, audience="ALL_APPLICANTS"):
    return c.post(
        f"/api/projects/{pid}/announcements",
        headers=headers(actor),
        json=dict(
            subject="공통 안내", body="입장 안내\n준비물", audience=audience, reason="테스트"
        ),
    )


def action(c, actor, msg, verb, **extra):
    return c.post(
        f"/api/announcements/{msg['announcement_id']}/{verb}",
        headers=headers(actor),
        json=dict(expected_version=msg["version"], reason="테스트", **extra),
    )


def notices(c, seller, aid):
    return c.get(f"/api/applications/{aid}/market-notices", headers=headers(seller))


def test_lifecycle_and_audience_snapshot(isolated_db):  # noqa: F811
    op, _, _, seller, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg = data(create(c, op, pid), 201)
        assert data(notices(c, seller, aid))["items"] == []
        assert action(c, op, msg, "publish", content_version=1).status_code == 409
        msg = data(action(c, op, msg, "approve", content_version=1))
        assert data(notices(c, seller, aid))["items"] == []
        msg = data(action(c, op, msg, "publish", content_version=1))
        item = data(notices(c, seller, aid))["items"][0]
        assert set(item) == {
            "announcement_id",
            "subject",
            "body",
            "audience",
            "content_version",
            "published_at",
        }
        assert action(c, op, msg, "publish", content_version=1).status_code == 409
        msg = data(
            action(
                c, op, msg, "revise", subject="수정 안내", body="확정자 안내", audience="CONFIRMED"
            )
        )
        assert data(notices(c, seller, aid))["items"][0] == item
        assert action(c, op, msg, "publish", content_version=2).status_code == 409
        msg = data(action(c, op, msg, "approve", content_version=2))
        assert data(notices(c, seller, aid))["items"][0] == item
        msg = data(action(c, op, msg, "publish", content_version=2))
        assert data(notices(c, seller, aid))["items"] == []
        with psycopg.connect(isolated_db) as db:
            db.execute(
                "UPDATE public.applications SET status='CONFIRMED',confirmed_at=now() WHERE "
                "application_id=%s",
                (aid,),
            )
        assert data(notices(c, seller, aid))["items"][0]["body"] == "확정자 안내"
        msg = data(action(c, op, msg, "unpublish"))
        assert data(notices(c, seller, aid))["items"] == []
        msg = data(action(c, op, msg, "publish", content_version=2))
        assert len(data(notices(c, seller, aid))["items"]) == 1
    with psycopg.connect(isolated_db) as db:
        assert db.execute("SELECT count(*) FROM public.communication_attempts").fetchone()[0] == 0


def test_permissions_and_recovery(isolated_db):  # noqa: F811
    op, rev, viewer, seller, pid, aid = fixture(isolated_db)
    other, _, _, other_seller, _, _ = fixture(isolated_db)
    with client_for(isolated_db) as c:
        for actor in (rev, viewer, seller, other):
            assert create(c, actor, pid).status_code in (403, 404)
        assert c.get(f"/api/applications/{aid}/market-notices").status_code == 401
        assert notices(c, other_seller, aid).status_code == 404
        h = headers(op)
        payload = dict(subject="공지", body="본문", audience="ALL_APPLICANTS", reason="테스트")
        path = f"/api/projects/{pid}/announcements"
        first = c.post(path, headers=h, json=payload)
        msg = data(first, 201)
        assert c.post(path, headers=h, json=payload).json() == first.json()
        assert c.post(path, headers=h, json=dict(payload, subject="다른 내용")).status_code == 409
        lookup = f"/api/me/requests/announcements.create/{h['Idempotency-Key']}"
        assert c.get(lookup, headers=headers(op)).status_code == 200
        for verb in ("approve", "publish", "unpublish", "revise"):
            h = headers(op)
            body = dict(expected_version=msg["version"], reason="검증")
            if verb in ("approve", "publish"):
                body["content_version"] = msg["content_version"]
            if verb == "revise":
                body.update(subject="다음", body="본문", audience="CONFIRMED")
            path = f"/api/announcements/{msg['announcement_id']}/{verb}"
            response = c.post(path, headers=h, json=body)
            msg = data(response)
            assert c.post(path, headers=h, json=body).json() == response.json()
            assert (
                c.get(
                    f"/api/me/requests/announcements.{verb}/{h['Idempotency-Key']}",
                    headers=headers(op),
                ).status_code
                == 200
            )
        with psycopg.connect(isolated_db) as db:
            db.execute(
                "UPDATE public.project_members SET active=false WHERE user_id=%s AND project_id=%s",
                (op, pid),
            )
        assert c.get(lookup, headers=headers(op)).status_code in (403, 404)


def test_versions_end_and_privacy(isolated_db):  # noqa: F811
    op, _, _, seller, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg = data(create(c, op, pid), 201)
        assert action(c, op, msg, "approve", content_version=2).status_code == 409
        msg = data(action(c, op, msg, "approve", content_version=1))
        assert action(c, op, dict(msg, version=1), "publish", content_version=1).status_code == 409
        msg = data(action(c, op, msg, "publish", content_version=1))
        with psycopg.connect(isolated_db) as db:
            assert db.execute(
                "SELECT relrowsecurity FROM pg_class WHERE "
                "oid='public.market_announcements'::regclass"
            ).fetchone()[0]
            assert (
                db.execute(
                    "SELECT count(*) FROM information_schema.role_table_grants WHERE "
                    "table_name='market_announcements' AND grantee IN "
                    "('anon','authenticated')"
                ).fetchone()[0]
                == 0
            )
            db.execute("UPDATE public.projects SET status='COMPLETED' WHERE project_id=%s", (pid,))
        assert len(data(notices(c, seller, aid))["items"]) == 1
        msg = data(action(c, op, msg, "unpublish"))
        assert action(c, op, msg, "publish", content_version=1).status_code == 409
        assert create(c, op, pid).status_code == 409


def test_audience_status_matrix_and_pages(isolated_db):  # noqa: F811
    op, _, _, seller, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        for audience in ("ALL_APPLICANTS", "CONFIRMED"):
            msg = data(create(c, op, pid, audience), 201)
            msg = data(action(c, op, msg, "approve", content_version=1))
            data(action(c, op, msg, "publish", content_version=1))
        for status in (
            "SUBMITTED",
            "NEED_INFO",
            "REVIEWING",
            "APPROVED",
            "WAITING",
            "REJECTED",
            "CONFIRMED",
            "CANCELLED",
            "DRAFT",
        ):
            with psycopg.connect(isolated_db) as db:
                db.execute(
                    "UPDATE public.applications SET status=%s,info_due_at=now()+interval '1 day',"
                    "info_requests_json='[]',cancel_reason='test',confirmed_at=now() "
                    "WHERE application_id=%s",
                    (status, aid),
                )
            items = data(notices(c, seller, aid))["items"]
            assert len(items) == (
                2 if status == "CONFIRMED" else 0 if status in ("DRAFT", "CANCELLED") else 1
            )
        with psycopg.connect(isolated_db) as db:
            db.execute(
                "UPDATE public.applications SET status='CONFIRMED' WHERE application_id=%s", (aid,)
            )
        url = f"/api/applications/{aid}/market-notices"
        first = data(c.get(url + "?limit=1", headers=headers(seller)))
        second = data(c.get(url + "?limit=1&offset=1", headers=headers(seller)))
        assert first["has_more"] and not second["has_more"]
        assert first["items"][0]["announcement_id"] != second["items"][0]["announcement_id"]
        assert data(c.get(url + "?offset=20", headers=headers(seller)))["items"] == []
        for limit in (0, 21):
            assert c.get(url + f"?limit={limit}", headers=headers(seller)).status_code == 422
        with psycopg.connect(isolated_db) as db:
            db.execute("UPDATE public.projects SET deleted_at=now() WHERE project_id=%s", (pid,))
        assert notices(c, seller, aid).status_code == 404


def test_schema_constraints_and_failed_creation_recovery(isolated_db):  # noqa: F811
    op, _, _, _, pid, _ = fixture(isolated_db)
    for role in ("anon", "authenticated"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with psycopg.connect(isolated_db) as db:
                db.execute("SET LOCAL ROLE " + role)
                db.execute("SELECT * FROM public.market_announcements")
    with client_for(isolated_db) as c:
        msg = data(create(c, op, pid), 201)
        for field in ("approved_at", "published_at"):
            with pytest.raises(psycopg.errors.CheckViolation):
                with psycopg.connect(isolated_db) as db:
                    db.execute(
                        f"UPDATE public.market_announcements SET {field}=now() "
                        "WHERE announcement_id=%s",
                        (msg["announcement_id"],),
                    )
        with psycopg.connect(isolated_db) as db:
            db.execute("UPDATE public.projects SET status='COMPLETED' WHERE project_id=%s", (pid,))
        h = headers(op)
        response = c.post(
            f"/api/projects/{pid}/announcements",
            headers=h,
            json=dict(subject="test", body="test", audience="CONFIRMED", reason="test"),
        )
        assert response.status_code == 409
        assert (
            c.get(
                f"/api/me/requests/announcements.create/{h['Idempotency-Key']}", headers=headers(op)
            ).status_code
            == 200
        )
