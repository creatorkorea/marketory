import psycopg
import pytest
from test_communications import action, client_for, data, generate
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers
from test_reviews import fixture


def notices(c, seller, aid):
    return c.get(f"/api/applications/{aid}/notices", headers=headers(seller))


def test_publication_snapshot_republish_unpublish_and_no_email(isolated_db):  # noqa: F811
    op, _, _, seller, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg = data(generate(c, op, pid, aid, subject="첫 안내", body="준비물\n가격표"), 201)
        assert data(notices(c, seller, aid))["items"] == []
        assert action(c, op, msg, "publish", content_version=1).status_code == 409
        msg = data(action(c, op, msg, "approve", content_version=1))
        assert data(notices(c, seller, aid))["items"] == []
        h = headers(op)
        path = f"/api/communications/{msg['communication_id']}/publish"
        body = dict(expected_version=msg["version"], content_version=1, reason="게시 확인")
        published = c.post(path, headers=h, json=body)
        msg = data(published)
        assert c.post(path, headers=h, json=body).json() == published.json()
        assert msg["send_status"] == "READY" and msg["attempts"] == []
        assert msg["publication"]["content_version"] == 1
        item = data(notices(c, seller, aid))["items"][0]
        assert set(item) == {
            "communication_id",
            "subject",
            "body",
            "published_at",
            "content_version",
        }
        assert item["body"] == "준비물\n가격표"
        assert "private@test.invalid" not in str(item)
        assert action(c, op, msg, "publish", content_version=1).status_code == 409
        revised = data(action(c, op, msg, "revise", subject="둘째 안내", body="입장 9시"))
        assert revised["publication"]["subject"] == "첫 안내"
        assert data(notices(c, seller, aid))["items"][0] == item
        assert action(c, op, revised, "publish", content_version=2).status_code == 409
        revised = data(action(c, op, revised, "approve", content_version=2))
        assert action(c, op, revised, "publish", content_version=1).status_code == 409
        msg = data(action(c, op, revised, "publish", content_version=2))
        assert data(notices(c, seller, aid))["items"][0]["subject"] == "둘째 안내"
        msg = data(action(c, op, msg, "unpublish"))
        assert msg["publication"]["withdrawn_at"]
        assert data(notices(c, seller, aid))["items"] == []
        msg = data(action(c, op, msg, "publish", content_version=2))
        assert len(data(notices(c, seller, aid))["items"]) == 1
        assert msg["send_status"] == "READY" and msg["queued_at"] is None
    with psycopg.connect(isolated_db) as conn:
        assert conn.execute("SELECT count(*) FROM public.communication_attempts").fetchone()[0] == 0
        assert (
            conn.execute(
                "SELECT count(*) FROM public.audit_logs WHERE action='COMMUNICATIONS.PUBLISH'"
            ).fetchone()[0]
            == 3
        )


def test_publication_authorization_context_and_withdraw_after_event(isolated_db):  # noqa: F811
    op, rev, viewer, seller, pid, aid = fixture(isolated_db)
    other_op, _, _, other_seller, _, _ = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg = data(generate(c, op, pid, aid), 201)
        msg = data(action(c, op, msg, "approve", content_version=1))
        for actor in (seller, rev, viewer, other_op, other_seller):
            assert action(c, actor, msg, "publish", content_version=1).status_code in (403, 404)
        for actor in (other_seller, op, rev):
            assert notices(c, actor, aid).status_code == 404
        assert c.get(f"/api/applications/{aid}/notices").status_code == 401
        msg = data(action(c, op, msg, "publish", content_version=1))
        for actor in (seller, rev, viewer, other_op):
            assert action(c, actor, msg, "unpublish").status_code in (403, 404)
        assert action(c, op, dict(msg, version=1), "unpublish").status_code == 409
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET status='COMPLETED' WHERE project_id=%s", (pid,)
            )
        msg = data(action(c, op, msg, "unpublish"))
        assert data(notices(c, seller, aid))["items"] == []
        assert action(c, op, msg, "publish", content_version=1).status_code == 409


def test_context_change_blocks_publish_and_direct_access_stays_private(isolated_db):  # noqa: F811
    op, _, _, seller, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg = data(generate(c, op, pid, aid), 201)
        msg = data(action(c, op, msg, "approve", content_version=1))
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET version=version+1 WHERE application_id=%s", (aid,)
            )
        msg = data(c.get(f"/api/communications/{msg['communication_id']}", headers=headers(op)))
        assert "publish" not in msg["allowed_actions"]
        assert action(c, op, msg, "publish", content_version=1).status_code == 409
        assert data(notices(c, seller, aid))["items"] == []
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(isolated_db) as conn:
            conn.execute("SET LOCAL ROLE authenticated")
            conn.execute("SELECT * FROM public.communications")


def test_publication_paging_and_recovery_rechecks_permissions(isolated_db):  # noqa: F811
    op, _, _, seller, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        for title in ("첫 게시", "최근 게시"):
            msg = data(generate(c, op, pid, aid, subject=title), 201)
            msg = data(action(c, op, msg, "approve", content_version=1))
            h = headers(op)
            path = f"/api/communications/{msg['communication_id']}/publish"
            body = dict(expected_version=msg["version"], content_version=1, reason="게시")
            response = c.post(path, headers=h, json=body)
            msg = data(response)
        first = data(c.get(f"/api/applications/{aid}/notices?limit=1", headers=headers(seller)))
        assert first["has_more"] and first["items"][0]["subject"] == "최근 게시"
        second = data(
            c.get(f"/api/applications/{aid}/notices?limit=1&offset=1", headers=headers(seller))
        )
        assert not second["has_more"] and second["items"][0]["subject"] == "첫 게시"
        assert (
            c.get(f"/api/applications/{aid}/notices?limit=21", headers=headers(seller)).status_code
            == 422
        )
        recovery = f"/api/me/requests/communications.publish/{h['Idempotency-Key']}"
        assert c.get(recovery, headers=headers(op)).status_code == 200
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.project_members SET role='REVIEWER' WHERE user_id=%s", (op,)
            )
        assert c.post(path, headers=h, json=body).status_code == 403
        assert c.get(recovery, headers=headers(op)).status_code == 403
