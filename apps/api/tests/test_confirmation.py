from concurrent.futures import ThreadPoolExecutor

import psycopg
from test_applications import client_for, draft, setup
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers


def approved(c, dsn, actor, project):
    app = draft(c, actor, project)
    aid = app["application_id"]
    c.patch(
        f"/api/applications/{aid}",
        headers=headers(actor),
        json={
            "expected_version": 1,
            "product_name": "작품",
            "product_desc": "테스트 소개",
            "category": "공예",
            "price_range": "1만원",
        },
    )
    result = c.post(
        f"/api/applications/{aid}/submit",
        headers=headers(actor),
        json={
            "expected_version": 2,
            "expected_policy_version": 1,
            "consent_version": "v1",
            "consent_accepted": True,
        },
    )
    assert result.status_code == 200
    with psycopg.connect(dsn) as conn:
        conn.execute(
            "UPDATE public.applications SET status='APPROVED',"
            "confirm_due_at=now()+interval '1 day' WHERE application_id=%s",
            (aid,),
        )
    return aid


def test_owner_confirm_replay_and_cancel_race(isolated_db):  # noqa: F811
    _, actor, project = setup(isolated_db)
    with client_for(isolated_db) as c:
        aid = approved(c, isolated_db, actor, project)
        h = headers(actor)
        body = {"expected_version": 3}
        with ThreadPoolExecutor(2) as pool:
            a = pool.submit(c.post, f"/api/applications/{aid}/confirm", headers=h, json=body)
            b = pool.submit(
                c.post,
                f"/api/applications/{aid}/cancel",
                headers=headers(actor),
                json={"expected_version": 3, "reason": "변경"},
            )
            replies = [a.result(), b.result()]
        assert sorted(r.status_code for r in replies) == [200, 409]
        replay = c.post(f"/api/applications/{aid}/confirm", headers=h, json=body)
        assert replay.json() == replies[0].json()
        current = c.get(f"/api/applications/{aid}", headers=headers(actor)).json()["data"]
        assert current["version"] == 4 and current["revision_no"] == 2
        assert current["status"] in ("CONFIRMED", "CANCELLED")


def test_confirmation_deadline_and_staff_evidence(isolated_db):  # noqa: F811
    staff, actor, project = setup(isolated_db)
    with client_for(isolated_db) as c:
        aid = approved(c, isolated_db, actor, project)
        assert c.post(
            f"/api/applications/{aid}/confirm", headers=headers(staff),
            json={"expected_version": 3, "reason": "   "},
        ).status_code == 422
        assert (
            c.post(
                f"/api/applications/{aid}/confirm",
                headers=headers(staff),
                json={"expected_version": 3},
            ).status_code
            == 422
        )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET confirm_due_at=now()-interval '1 minute' "
                "WHERE application_id=%s",
                (aid,),
            )
        assert (
            c.post(
                f"/api/applications/{aid}/confirm",
                headers=headers(actor),
                json={"expected_version": 3},
            ).status_code
            == 409
        )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET confirm_due_at=now()+interval '1 hour' "
                "WHERE application_id=%s",
                (aid,),
            )
            conn.execute(
                "UPDATE public.projects SET status='CLOSED' WHERE project_id=%s", (project,)
            )
        h = headers(staff)
        body = {"expected_version": 3, "reason": "셀러와 전화로 참가 의사 확인"}
        success = c.post(f"/api/applications/{aid}/confirm", headers=h, json=body)
        assert success.status_code == 200, success.text
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.project_members SET role='REVIEWER' WHERE user_id=%s", (staff,)
            )
        assert c.post(f"/api/applications/{aid}/confirm", headers=h, json=body).status_code == 403
        assert (
            c.get(
                f"/api/me/requests/applications.confirm/{h['Idempotency-Key']}",
                headers=headers(staff),
            ).status_code
            == 403
        )
