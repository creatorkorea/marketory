from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
from test_applications import client_for, setup
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers


def fixture(dsn, status="SUBMITTED"):
    operator, seller, project = setup(dsn)
    reviewer, viewer, aid = uuid4(), uuid4(), uuid4()
    with psycopg.connect(dsn) as conn:
        for user, role in ((reviewer, "REVIEWER"), (viewer, "VIEWER")):
            conn.execute("INSERT INTO auth.users VALUES(%s)", (user,))
            conn.execute(
                "INSERT INTO public.users(user_id,email,account_role) VALUES(%s,%s,'STAFF')",
                (user, f"{user}@test.invalid"),
            )
            conn.execute(
                "INSERT INTO public.project_members(project_id,user_id,role) VALUES(%s,%s,%s)",
                (project, user, role),
            )
        sid = conn.execute(
            "INSERT INTO public.sellers(user_id,shop_name,owner_name,phone) "
            "VALUES(%s,'Shop','Owner','01012345678') RETURNING seller_id",
            (seller,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO public.applications(application_id,project_id,seller_id,status,"
            "product_name,product_desc,price_range,category,submitted_at,seller_snapshot_json,"
            "policy_version,consent_json,notification_email,notification_email_verified_at) "
            "VALUES(%s,%s,%s,%s,'Cup','Handmade','10000','공예',now(),%s,1,'{}',"
            "'private@test.invalid',now())",
            (
                aid,
                project,
                sid,
                status,
                Jsonb(
                    dict(
                        shop_name="Shop",
                        owner_name="Owner",
                        phone="01012345678",
                        business_no="1234567890",
                    )
                ),
            ),
        )
        for kind in ("PRODUCT_IMAGE", "BUSINESS_DOC"):
            conn.execute(
                "INSERT INTO public.attachments(application_id,file_type,storage_key,"
                "original_name,mime_type,size_bytes,uploaded_by) "
                "VALUES(%s,%s,%s,'file.png','image/png',100,%s)",
                (aid, kind, str(uuid4()), seller),
            )
    return operator, reviewer, viewer, seller, project, aid


def future(hours=12):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def post(c, actor, aid, suffix, version=1, **body):
    return c.post(
        f"/api/applications/{aid}/{suffix}",
        headers=headers(actor),
        json=dict(expected_version=version, **body),
    )


def test_staff_projection_masks_contacts_and_restricts_audiences(isolated_db):  # noqa: F811
    op, rev, viewer, seller, project, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        detail = c.get(f"/api/review/applications/{aid}", headers=headers(op))
        assert detail.status_code == 200
        assert detail.json()["data"]["seller"]["phone"] == "01012345678"
        data = c.get(f"/api/review/applications/{aid}", headers=headers(rev)).json()["data"]
        assert data["seller"]["phone"] != "01012345678"
        assert data["seller"]["email"] != "private@test.invalid"
        assert "seller_snapshot_json" not in data and "notification_email" not in data
        assert "1234567890" not in str(data)
        assert [x["file_type"] for x in data["attachments"]] == ["PRODUCT_IMAGE"]
        assert data["allowed_actions"] == ["note"]
        for actor in (viewer, seller):
            assert c.get(f"/api/review/applications/{aid}", headers=headers(actor)).status_code in (
                403,
                404,
            )
        summary = c.get(f"/api/projects/{project}/application-summary", headers=headers(viewer))
        assert summary.status_code == 200
        assert summary.json()["data"]["counts"]["SUBMITTED"] == 1
        listing = c.get(
            f"/api/projects/{project}/applications?category=공예&limit=1", headers=headers(rev)
        )
        assert listing.status_code == 200
        assert listing.json()["data"]["total"] == 1
        assert "phone" not in str(listing.json())
        assert (
            c.get(f"/api/projects/{project}/applications", headers=headers(viewer)).status_code
            == 403
        )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET status='DRAFT' WHERE application_id=%s", (aid,)
            )
        assert c.get(f"/api/review/applications/{aid}", headers=headers(op)).status_code == 404
        assert (
            c.get(f"/api/projects/{project}/applications", headers=headers(op)).json()["data"][
                "total"
            ]
            == 0
        )


def test_start_review_replay_notes_and_role_downgrade(isolated_db):  # noqa: F811
    op, rev, _, seller, _, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        assert post(c, rev, aid, "start-review", reason="Manual").status_code == 403
        h, body = headers(op), dict(expected_version=1, reason="Manual")
        first = c.post(f"/api/applications/{aid}/start-review", headers=h, json=body)
        assert first.status_code == 200
        assert first.json()["data"]["status"] == "REVIEWING"
        assert first.json()["data"]["revision_no"] == 1
        assert (
            c.post(f"/api/applications/{aid}/start-review", headers=h, json=body).json()
            == first.json()
        )
        assert post(c, op, aid, "decision", decision="REJECTED", reason="stale").status_code == 409
        note_headers, note_body = headers(op), dict(expected_version=2, body="Project private")
        note = c.post(f"/api/applications/{aid}/notes", headers=note_headers, json=note_body)
        assert note.status_code == 200
        assert note.json()["data"]["notes"][0]["body"] == "Project private"
        assert (
            "notes" not in c.get(f"/api/applications/{aid}", headers=headers(seller)).json()["data"]
        )
        assert post(c, rev, aid, "notes", 3, body="Reviewer note").status_code == 200
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.project_members SET role='REVIEWER' WHERE user_id=%s", (op,)
            )
        assert (
            c.post(
                f"/api/applications/{aid}/notes", headers=note_headers, json=note_body
            ).status_code
            == 403
        )
        assert (
            c.post(f"/api/applications/{aid}/start-review", headers=h, json=body).status_code == 403
        )
        result = c.get(
            f"/api/me/requests/reviews.note/{note_headers['Idempotency-Key']}", headers=headers(op)
        )
        assert result.status_code == 403
        assert post(c, rev, aid, "notes", 4, body="  ").status_code == 422


def test_info_requests_and_extensions_preserve_revision_and_notice_snapshot(isolated_db):  # noqa: F811
    op, _, _, _, project, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        for fields in ([], ["phone"], ["product_desc", "product_desc"]):
            assert (
                post(
                    c, op, aid, "request-info", fields=fields, reason="Fix", info_due_at=future()
                ).status_code
                == 422
            )
        assert (
            post(
                c,
                op,
                aid,
                "request-info",
                fields=["product_desc"],
                reason="Fix",
                info_due_at=future(60),
            ).status_code
            == 422
        )
        r = post(
            c,
            op,
            aid,
            "request-info",
            fields=["product_desc", "product_images"],
            reason="Fix",
            info_due_at=future(1),
        )
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["status"] == "NEED_INFO" and data["revision_no"] == 1
        assert data["info_requests_json"] == [
            {"field": "product_desc", "reason": "Fix"},
            {"field": "product_images", "reason": "Fix"},
        ]
        assert len(data["notice_drafts"]) == 1
        assert (
            post(c, op, aid, "extend-info", 2, reason="Extend", info_due_at=future(0.5)).status_code
            == 422
        )
        r = post(c, op, aid, "extend-info", 2, reason="Extend", info_due_at=future(2))
        assert r.status_code == 200
        assert r.json()["data"]["history"][-1]["from_status"] == "NEED_INFO"
        assert len(r.json()["data"]["notice_drafts"]) == 2
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET status='CLOSED' WHERE project_id=%s", (project,)
            )
        assert (
            post(c, op, aid, "extend-info", 3, reason="Closed", info_due_at=future(3)).status_code
            == 409
        )


def test_decision_capacity_serializes_competing_approvals(isolated_db):  # noqa: F811
    op, _, _, _, project, aid = fixture(isolated_db, "REVIEWING")
    second = uuid4()
    with psycopg.connect(isolated_db) as conn:
        uid = uuid4()
        conn.execute("INSERT INTO auth.users VALUES(%s)", (uid,))
        conn.execute(
            "INSERT INTO public.users(user_id,email) VALUES(%s,'second@test.invalid')", (uid,)
        )
        sid = conn.execute(
            "INSERT INTO public.sellers(user_id,shop_name,owner_name,phone) "
            "VALUES(%s,'Second','Owner','01012345678') RETURNING seller_id",
            (uid,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO public.applications(application_id,project_id,seller_id,status,"
            "product_name,product_desc,price_range,category,submitted_at,seller_snapshot_json,"
            "policy_version,consent_json,notification_email,notification_email_verified_at) "
            "SELECT %s,project_id,%s,status,product_name,product_desc,price_range,category,"
            "submitted_at,seller_snapshot_json,policy_version,consent_json,notification_email,"
            "notification_email_verified_at FROM public.applications WHERE application_id=%s",
            (second, sid, aid),
        )
        conn.execute(
            "UPDATE public.projects SET target_team_count=1 WHERE project_id=%s", (project,)
        )
    with client_for(isolated_db) as c:

        def approve(target):
            return post(
                c,
                op,
                target,
                "decision",
                decision="APPROVED",
                reason="Selected",
                confirm_due_at=future(),
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(approve, [aid, second]))
        assert sorted(r.status_code for r in responses) == [200, 409]
        assert next(r for r in responses if r.status_code == 409).json()["code"] == "CAPACITY_FULL"
    with psycopg.connect(isolated_db) as conn:
        assert (
            conn.execute(
                "SELECT count(*) FROM public.applications WHERE status='APPROVED'"
            ).fetchone()[0]
            == 1
        )
        assert (
            conn.execute(
                "SELECT count(*) FROM public.audit_logs WHERE action='REVIEW.NOTICE_DRAFT'"
            ).fetchone()[0]
            == 1
        )


def test_waiting_promotion_confirmation_extension_and_input_guards(isolated_db):  # noqa: F811
    op, _, _, _, project, aid = fixture(isolated_db, "REVIEWING")
    with client_for(isolated_db) as c:
        assert post(c, op, aid, "decision", decision="WAITING", reason="Queue").status_code == 422
        assert (
            post(
                c, op, aid, "decision", decision="REJECTED", reason="No", waiting_rank=1
            ).status_code
            == 422
        )
        assert (
            post(
                c, op, aid, "decision", decision="APPROVED", reason=" ", confirm_due_at=future()
            ).status_code
            == 422
        )
        assert (
            post(
                c, op, aid, "decision", decision="WAITING", reason="Queue", waiting_rank=2
            ).status_code
            == 200
        )
        assert (
            post(
                c, op, aid, "decision", 2, decision="WAITING", reason="Again", waiting_rank=1
            ).status_code
            == 409
        )
        r = post(
            c,
            op,
            aid,
            "decision",
            2,
            decision="APPROVED",
            reason="Promoted",
            confirm_due_at=future(1),
        )
        assert r.status_code == 200
        assert r.json()["data"]["waiting_rank"] is None
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET status='CLOSED' WHERE project_id=%s", (project,)
            )
        assert (
            post(
                c, op, aid, "extend-confirmation", 3, reason="Extend", confirm_due_at=future(0.5)
            ).status_code
            == 422
        )
        extended = post(
            c, op, aid, "extend-confirmation", 3, reason="Extend", confirm_due_at=future(2)
        )
        assert extended.status_code == 200
        assert extended.json()["data"]["revision_no"] == 1
        assert "confirm" in extended.json()["data"]["allowed_actions"]
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET recruit_start_at=now()-interval '3 days',"
                "recruit_end_at=now()-interval '2 days',event_end_at=now()-interval '1 day' "
                "WHERE project_id=%s",
                (project,),
            )
        assert post(c, op, aid, "notes", 4, body="Too late").status_code == 409
        assert (
            post(
                c, op, aid, "extend-confirmation", 4, reason="Late", confirm_due_at=future(3)
            ).status_code
            == 409
        )


def test_waiting_list_uses_priority_then_submission_order(isolated_db):  # noqa: F811
    op, _, _, _, project, aid = fixture(isolated_db, "WAITING")
    _, _, _, _, _, second = fixture(isolated_db, "WAITING")
    with psycopg.connect(isolated_db) as conn:
        conn.execute(
            "UPDATE public.applications SET waiting_rank=2 WHERE application_id=%s", (aid,)
        )
        conn.execute(
            "UPDATE public.applications SET project_id=%s,waiting_rank=1 WHERE application_id=%s",
            (project, second),
        )
    with client_for(isolated_db) as c:
        response = c.get(
            f"/api/projects/{project}/applications?status=WAITING&limit=1", headers=headers(op)
        )
        assert response.status_code == 200
        assert response.json()["data"]["total"] == 2
        assert response.json()["data"]["items"][0]["application_id"] == str(second)
        response = c.get(
            f"/api/projects/{project}/applications?status=WAITING&limit=1&offset=1",
            headers=headers(op),
        )
        assert response.json()["data"]["items"][0]["application_id"] == str(aid)


def test_notes_remain_project_scoped_and_reviewer_replay_rechecks_membership(isolated_db):  # noqa: F811
    op, rev, _, _, project, aid = fixture(isolated_db)
    other_op, _, _, _, other_project, other_aid = fixture(isolated_db)
    h, body = headers(rev), dict(expected_version=1, body="Scoped review note")
    with client_for(isolated_db) as c:
        saved = c.post(f"/api/applications/{aid}/notes", headers=h, json=body)
        assert saved.status_code == 200
        assert saved.json()["data"]["seller"]["phone"] == "***"
        assert "notice_drafts" not in saved.json()["data"]
        assert c.post(f"/api/applications/{aid}/notes", headers=h, json=body).json() == saved.json()
        lookup = c.get(
            f"/api/me/requests/reviews.note/{h['Idempotency-Key']}", headers=headers(rev)
        )
        assert lookup.status_code == 200 and lookup.json()["response"] == saved.json()
        assert (
            c.get(f"/api/review/applications/{other_aid}", headers=headers(op)).status_code == 404
        )
        assert (
            c.get(
                f"/api/projects/{other_project}/application-summary", headers=headers(rev)
            ).status_code
            == 404
        )
        assert (
            c.get(f"/api/review/applications/{other_aid}", headers=headers(other_op)).json()[
                "data"
            ]["notes"]
            == []
        )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.project_members SET active=false WHERE project_id=%s AND user_id=%s",
                (project, rev),
            )
        assert c.post(f"/api/applications/{aid}/notes", headers=h, json=body).status_code == 404
        assert (
            c.get(
                f"/api/me/requests/reviews.note/{h['Idempotency-Key']}", headers=headers(rev)
            ).status_code
            == 404
        )


def test_rejection_is_terminal_and_failed_decision_recovers_without_side_effects(isolated_db):  # noqa: F811
    op, _, _, _, _, aid = fixture(isolated_db, "REVIEWING")
    with client_for(isolated_db) as c:
        h = headers(op)
        body = dict(
            expected_version=1,
            decision="APPROVED",
            reason="Bad deadline",
            confirm_due_at=future(-1),
        )
        failed = c.post(f"/api/applications/{aid}/decision", headers=h, json=body)
        assert failed.status_code == 422
        assert (
            c.post(f"/api/applications/{aid}/decision", headers=h, json=body).json()
            == failed.json()
        )
        lookup = c.get(
            f"/api/me/requests/reviews.decision/{h['Idempotency-Key']}", headers=headers(op)
        )
        assert lookup.status_code == 200 and lookup.json()["outcome"] == "FAILED"
        rejected = post(c, op, aid, "decision", decision="REJECTED", reason="Criteria")
        assert rejected.status_code == 200
        data = rejected.json()["data"]
        assert data["status"] == "REJECTED" and data["version"] == 2 and data["revision_no"] == 1
        assert len(data["notice_drafts"]) == 1 and len(data["history"]) == 1
        assert (
            post(
                c,
                op,
                aid,
                "decision",
                2,
                decision="APPROVED",
                reason="Retry",
                confirm_due_at=future(),
            ).status_code
            == 409
        )
