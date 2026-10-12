"""Cross-operation boundaries against an isolated local PostgreSQL database."""

from uuid import uuid4

import psycopg
from test_applications import client_for, setup
from test_attachments import MemoryStorage
from test_attachments import client_for as attachment_client
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers
from test_reviews import fixture, future, post


def test_cancelled_selection_frees_one_slot_without_replaying_failed_approval(isolated_db):  # noqa: F811
    # Counting CANCELLED as occupied or rerunning a saved failure breaks this contract.
    op, _, _, seller, project, aid = fixture(isolated_db, "REVIEWING")
    other_user, other_seller, waiting = uuid4(), uuid4(), uuid4()
    with psycopg.connect(isolated_db) as conn:
        conn.execute("INSERT INTO auth.users VALUES(%s)", (other_user,))
        conn.execute(
            "INSERT INTO public.users(user_id,email) VALUES(%s,'waiting@test.invalid')",
            (other_user,),
        )
        conn.execute(
            "INSERT INTO public.sellers(seller_id,user_id,shop_name,owner_name,phone) "
            "VALUES(%s,%s,'Waiting','Owner','01000000000')",
            (other_seller, other_user),
        )
        conn.execute(
            "INSERT INTO public.applications(application_id,project_id,seller_id,status,"
            "product_name,product_desc,price_range,category,submitted_at,seller_snapshot_json,"
            "policy_version,consent_json,notification_email,notification_email_verified_at,"
            "waiting_rank) SELECT %s,project_id,%s,'WAITING',product_name,product_desc,"
            "price_range,category,submitted_at,seller_snapshot_json,policy_version,consent_json,"
            "notification_email,notification_email_verified_at,1 FROM public.applications "
            "WHERE application_id=%s",
            (waiting, other_seller, aid),
        )
        conn.execute(
            "UPDATE public.projects SET target_team_count=1 WHERE project_id=%s", (project,)
        )
    with client_for(isolated_db) as c:
        selected = post(
            c, op, aid, "decision", decision="APPROVED", reason="Selected", confirm_due_at=future()
        )
        assert selected.status_code == 200, selected.text
        h = headers(op)
        body = dict(
            expected_version=1, decision="APPROVED", reason="Promote", confirm_due_at=future()
        )
        path = f"/api/applications/{waiting}/decision"
        full = c.post(path, headers=h, json=body)
        assert full.status_code == 409 and full.json()["code"] == "CAPACITY_FULL"
        cancelled = c.post(
            f"/api/applications/{aid}/cancel",
            headers=headers(seller),
            json={"expected_version": 2, "reason": "일정 변경"},
        )
        assert cancelled.status_code == 200, cancelled.text
        replay = c.post(path, headers=h, json=body)
        assert replay.status_code == 409 and replay.json() == full.json()
        promoted = c.post(path, headers=headers(op), json=body)
        assert promoted.status_code == 200, promoted.text
        assert promoted.json()["data"]["status"] == "APPROVED"
        assert promoted.json()["data"]["waiting_rank"] is None
    with psycopg.connect(isolated_db) as conn:
        states = dict(
            conn.execute(
                "SELECT status,count(*) FROM public.applications "
                "WHERE project_id=%s GROUP BY status",
                (project,),
            ).fetchall()
        )
        assert states == {"CANCELLED": 1, "APPROVED": 1}
        assert (
            conn.execute(
                "SELECT count(*) FROM public.audit_logs WHERE action='REVIEW.NOTICE_DRAFT'"
            ).fetchone()[0]
            == 2
        )


def test_other_seller_cannot_read_change_or_download_an_application(isolated_db):  # noqa: F811
    # Removing ownership checks must not expose details, files, or permit cancellation.
    _, _, _, owner, _, aid = fixture(isolated_db, "REVIEWING")
    _, outsider, _ = setup(isolated_db)
    with psycopg.connect(isolated_db) as conn:
        files = conn.execute(
            "SELECT attachment_id FROM public.attachments WHERE application_id=%s",
            (aid,),
        ).fetchall()
    with attachment_client(isolated_db, MemoryStorage()) as c:
        assert c.get(f"/api/applications/{aid}", headers=headers(owner)).status_code == 200
        denied = [
            c.get(f"/api/applications/{aid}", headers=headers(outsider)),
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(outsider),
                json={"expected_version": 1, "product_name": "Unauthorized"},
            ),
            c.post(
                f"/api/applications/{aid}/cancel",
                headers=headers(outsider),
                json={"expected_version": 1, "reason": "Unauthorized"},
            ),
            c.post(
                f"/api/applications/{aid}/confirm",
                headers=headers(outsider),
                json={"expected_version": 1},
            ),
            *[
                c.get(f"/api/attachments/{fid}/download", headers=headers(outsider))
                for (fid,) in files
            ],
        ]
        for response in denied:
            assert response.status_code == 404, response.text
            assert "private@test.invalid" not in response.text
            assert "storage.test.invalid" not in response.text
        current = c.get(f"/api/applications/{aid}", headers=headers(owner)).json()["data"]
        assert current["status"] == "REVIEWING" and current["version"] == 1
        assert current["product_name"] == "Cup"
    with psycopg.connect(isolated_db) as conn:
        assert conn.execute("SELECT count(*) FROM public.audit_logs").fetchone()[0] == 0
