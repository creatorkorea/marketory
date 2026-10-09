from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from uuid import UUID, uuid4

import psycopg
from fastapi.testclient import TestClient
from test_p1_p3 import isolated_db, seed  # noqa: F401
from test_projects import headers

from marketory.auth import Identity
from marketory.config import Settings
from marketory.main import create_app


def client_for(dsn):
    async def verify(token):
        return Identity(UUID(token), f"{token}@test.invalid", datetime.now(timezone.utc))

    settings = Settings(environment="test", database_url=dsn)
    app = create_app(settings, authenticator=verify)
    return TestClient(
        app,
        backend_options={"loop_factory": __import__("asyncio").SelectorEventLoop},
    )


def setup(dsn):
    actor, other, project = seed(dsn)
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM public.project_members WHERE user_id=%s", (other,))
        conn.execute("UPDATE public.users SET account_role='SELLER' WHERE user_id=%s", (other,))
        conn.execute(
            "UPDATE public.projects SET status='RECRUITING', "
            "recruit_start_at=now()-interval '1 hour',policy_json=%s WHERE project_id=%s",
            (
                psycopg.types.json.Jsonb(
                    dict(
                        allowed_categories=["공예"],
                        photo_required=False,
                        business_required=False,
                        consent_version="v1",
                    )
                ),
                project,
            ),
        )
    return actor, other, project


def profile(**changes):
    return dict(
        name="이름",
        shop_name="공방",
        owner_name="대표",
        phone="010-1234-5678",
        expected_version=0,
        **changes,
    )


def test_profile_strict_version_replay_and_revocation(isolated_db):  # noqa: F811
    _, actor, _ = setup(isolated_db)
    with client_for(isolated_db) as c:
        assert c.get("/api/me/seller", headers=headers(actor)).json()["data"] is None
        assert (
            c.post(
                "/api/me/seller", headers=headers(actor), json=profile(email="evil@test.invalid")
            ).status_code
            == 422
        )
        h = headers(actor)
        first = c.post("/api/me/seller", headers=h, json=profile())
        assert first.status_code == 200
        assert first.json()["data"]["phone"] == "01012345678"
        assert c.post("/api/me/seller", headers=h, json=profile()).json() == first.json()
        assert c.patch("/api/me/seller", headers=h, json=profile()).status_code == 409
        assert c.post("/api/me/seller", headers=headers(actor), json=profile()).status_code == 409
        with psycopg.connect(isolated_db) as conn:
            conn.execute("UPDATE public.users SET status='INACTIVE' WHERE user_id=%s", (actor,))
        assert c.post("/api/me/seller", headers=h, json=profile()).status_code == 403


def draft(c, actor, project):
    assert c.post("/api/me/seller", headers=headers(actor), json=profile()).status_code == 200
    response = c.post(
        "/api/applications", headers=headers(actor), json={"project_id": str(project)}
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert {"upload", "detach"} <= set(data["allowed_actions"])
    return data


def test_submission_snapshot_consent_content_and_owner(isolated_db):  # noqa: F811
    stranger, actor, project = setup(isolated_db)
    with client_for(isolated_db) as c:
        app = draft(c, actor, project)
        aid = app["application_id"]
        assert c.get(f"/api/applications/{aid}", headers=headers(stranger)).status_code == 404
        consent = dict(
            expected_version=1,
            expected_policy_version=1,
            consent_version="v1",
            consent_accepted=True,
        )
        assert (
            c.post(
                f"/api/applications/{aid}/submit", headers=headers(actor), json=consent
            ).status_code
            == 422
        )
        app = c.patch(
            f"/api/applications/{aid}",
            headers=headers(actor),
            json=dict(
                expected_version=1,
                product_name="컵",
                product_desc="수제 컵",
                price_range="10000",
                category="공예",
            ),
        ).json()["data"]
        assert (app["version"], app["revision_no"]) == (2, 2)
        consent["expected_version"] = 2
        assert (
            c.post(
                f"/api/applications/{aid}/submit",
                headers=headers(actor),
                json={**consent, "expected_policy_version": 2},
            ).status_code
            == 409
        )
        h = headers(actor)
        submitted = c.post(f"/api/applications/{aid}/submit", headers=h, json=consent)
        assert submitted.status_code == 200, submitted.text
        data = submitted.json()["data"]
        assert (data["status"], data["version"], data["revision_no"]) == ("SUBMITTED", 3, 2)
        assert (
            c.post(f"/api/applications/{aid}/submit", headers=h, json=consent).json()
            == submitted.json()
        )
        assert "evaluation_policy_json" not in data["project"]
        assert "waiting_rank" not in data
        assert (
            c.patch(
                "/api/me/seller",
                headers=headers(actor),
                json={**profile(), "expected_version": 1, "shop_name": "새 상호"},
            ).status_code
            == 200
        )
        assert (
            c.get(f"/api/applications/{aid}", headers=headers(actor)).json()["data"][
                "seller_snapshot_json"
            ]["shop_name"]
            == "공방"
        )
        assert (
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(actor),
                json=dict(expected_version=3, product_name="변경"),
            ).status_code
            == 409
        )


def test_duplicate_race_cancel_and_end_guards(isolated_db):  # noqa: F811
    _, actor, project = setup(isolated_db)
    with client_for(isolated_db) as c:
        assert c.post("/api/me/seller", headers=headers(actor), json=profile()).status_code == 200

        def create(_):
            return c.post(
                "/api/applications", headers=headers(actor), json={"project_id": str(project)}
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(create, range(2)))
        assert sorted(r.status_code for r in replies) == [201, 409]
        app = next(r for r in replies if r.status_code == 201).json()["data"]
        aid = app["application_id"]
        cancelled = c.post(
            f"/api/applications/{aid}/cancel",
            headers=headers(actor),
            json=dict(expected_version=1, reason="일정 변경"),
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["data"]["revision_no"] == 1
        assert create(0).status_code == 409
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET recruit_start_at=now()-interval '3 days',"
                "recruit_end_at=now()-interval '2 days',event_end_at=now()-interval '1 day' "
                "WHERE project_id=%s",
                (project,),
            )
        assert c.get(f"/api/applications/{aid}", headers=headers(actor)).status_code == 200


def test_need_info_fields_and_deadline(isolated_db):  # noqa: F811
    _, actor, project = setup(isolated_db)
    with client_for(isolated_db) as c:
        app = draft(c, actor, project)
        aid = app["application_id"]
        assert (
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(actor),
                json=dict(
                    expected_version=1,
                    product_name="컵",
                    product_desc="수제 컵",
                    price_range="10000",
                    category="공예",
                ),
            ).status_code
            == 200
        )
        assert (
            c.post(
                f"/api/applications/{aid}/submit",
                headers=headers(actor),
                json=dict(
                    expected_version=2,
                    expected_policy_version=1,
                    consent_version="v1",
                    consent_accepted=True,
                ),
            ).status_code
            == 200
        )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET status='NEED_INFO',info_requests_json="
                "'[{\"field\":\"product_desc\"}]',info_due_at=now()+interval '1 hour' "
                "WHERE application_id=%s",
                (aid,),
            )
            conn.execute(
                "UPDATE public.projects SET status='REVIEWING' WHERE project_id=%s", (project,)
            )
        assert (
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(actor),
                json=dict(expected_version=3, product_name="허용 안 됨"),
            ).status_code
            == 403
        )
        assert (
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(actor),
                json=dict(expected_version=3, product_desc=None),
            ).status_code
            == 422
        )
        assert (
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(actor),
                json=dict(expected_version=3, product_desc="보완"),
            ).status_code
            == 200
        )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET recruit_end_at=now()-interval '1 second' "
                "WHERE project_id=%s",
                (project,),
            )
        resubmitted = c.post(
            f"/api/applications/{aid}/resubmit",
            headers=headers(actor),
            json=dict(
                expected_version=4,
                expected_policy_version=1,
                consent_version="v1",
                consent_accepted=True,
            ),
        )
        assert resubmitted.status_code == 200, resubmitted.text
        assert resubmitted.json()["data"]["revision_no"] == 3
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET status='NEED_INFO',"
                "info_due_at=now()-interval '1 second' "
                "WHERE application_id=%s",
                (aid,),
            )
        assert (
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(actor),
                json=dict(expected_version=5, product_desc="늦음"),
            ).status_code
            == 409
        )


def test_submission_files_pending_and_recruitment_guards(isolated_db):  # noqa: F811
    _, actor, project = setup(isolated_db)
    with client_for(isolated_db) as c:
        app = draft(c, actor, project)
        aid = app["application_id"]
        assert (
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(actor),
                json=dict(
                    expected_version=1,
                    product_name="컵",
                    product_desc="수제 컵",
                    price_range="10000",
                    category="공예",
                ),
            ).status_code
            == 200
        )
        consent = dict(
            expected_version=2,
            expected_policy_version=1,
            consent_version="v1",
            consent_accepted=True,
        )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET policy_json=policy_json || "
                '\'{"photo_required":true,"business_required":true}\' '
                "WHERE project_id=%s",
                (project,),
            )
        r = c.post(f"/api/applications/{aid}/submit", headers=headers(actor), json=consent)
        assert r.status_code == 422
        fields = {d["field"] for d in r.json()["details"]}
        assert {"product_images", "business_document"} <= fields
        with psycopg.connect(isolated_db) as conn:
            for kind in ("PRODUCT_IMAGE", "BUSINESS_DOC"):
                conn.execute(
                    "INSERT INTO public.attachments(application_id,file_type,storage_key,"
                    "original_name,mime_type,size_bytes,uploaded_by) "
                    "VALUES(%s,%s,%s,'test.png','image/png',100,%s)",
                    (aid, kind, str(uuid4()), actor),
                )
            conn.execute(
                "INSERT INTO public.upload_intents(application_id,storage_key,field_code,"
                "requested_by,expected_application_version,expected_revision_no,"
                "original_name,mime_type,size_bytes,max_size_bytes,expires_at) "
                "VALUES(%s,%s,'product_images',%s,2,2,'test.png','image/png',100,100,"
                "now()-interval '1 hour')",
                (aid, str(uuid4()), actor),
            )
        assert (
            c.post(
                f"/api/applications/{aid}/submit", headers=headers(actor), json=consent
            ).status_code
            == 422
        )
        pending = c.get(f"/api/applications/{aid}", headers=headers(actor)).json()["data"][
            "pending_uploads"
        ]
        assert len(pending) == 1
        assert set(pending[0]) == {
            "upload_intent_id",
            "application_version",
            "revision_no",
            "original_name",
            "field_code",
            "expires_at",
        }
        assert pending[0]["application_version"] == 2
        with psycopg.connect(isolated_db) as conn:
            conn.execute("UPDATE public.upload_intents SET status='REJECTED'")
            conn.execute(
                "UPDATE public.projects SET recruit_end_at=now()-interval '1 second' "
                "WHERE project_id=%s",
                (project,),
            )
        assert (
            c.post(
                f"/api/applications/{aid}/submit", headers=headers(actor), json=consent
            ).status_code
            == 409
        )
        assert c.get("/api/me/applications", headers=headers(actor)).json()["data"][0][
            "allowed_actions"
        ] == ["cancel"]


def test_closed_selection_still_allows_approved_seller_cancellation(isolated_db):  # noqa: F811
    _, actor, project = setup(isolated_db)
    with client_for(isolated_db) as c:
        app = draft(c, actor, project)
        aid = app["application_id"]
        assert (
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(actor),
                json=dict(
                    expected_version=1,
                    product_name="컵",
                    product_desc="수제 컵",
                    price_range="10000",
                    category="공예",
                ),
            ).status_code
            == 200
        )
        assert (
            c.post(
                f"/api/applications/{aid}/submit",
                headers=headers(actor),
                json=dict(
                    expected_version=2,
                    expected_policy_version=1,
                    consent_version="v1",
                    consent_accepted=True,
                ),
            ).status_code
            == 200
        )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET status='APPROVED' WHERE application_id=%s", (aid,)
            )
            conn.execute(
                "UPDATE public.projects SET status='CLOSED' WHERE project_id=%s", (project,)
            )
        assert (
            "cancel"
            in c.get(f"/api/applications/{aid}", headers=headers(actor)).json()["data"][
                "allowed_actions"
            ]
        )
        r = c.post(
            f"/api/applications/{aid}/cancel",
            headers=headers(actor),
            json=dict(expected_version=3, reason="참가 취소"),
        )
        assert r.status_code == 200
        assert r.json()["data"]["status"] == "CANCELLED"


def test_patch_replay_distinguishes_omitted_and_explicit_defaults(isolated_db):  # noqa: F811
    _, actor, project = setup(isolated_db)
    with client_for(isolated_db) as c:
        app = draft(c, actor, project)
        aid = app["application_id"]
        assert (
            c.patch(
                f"/api/applications/{aid}",
                headers=headers(actor),
                json=dict(expected_version=1, electricity_required=True),
            ).status_code
            == 200
        )
        h = headers(actor)
        body = dict(expected_version=2, product_name="컵")
        saved = c.patch(f"/api/applications/{aid}", headers=h, json=body)
        assert saved.status_code == 200
        assert saved.json()["data"]["electricity_required"] is True
        assert c.patch(f"/api/applications/{aid}", headers=h, json=body).json() == saved.json()
        replay = c.patch(
            f"/api/applications/{aid}", headers=h, json={**body, "electricity_required": False}
        )
        assert replay.status_code == 409
        assert replay.json()["code"] == "IDEMPOTENCY_CONFLICT"
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET waiting_rank=3 WHERE application_id=%s", (aid,)
            )
        detail = c.get(f"/api/applications/{aid}", headers=headers(actor)).json()["data"]
        listing = c.get("/api/me/applications", headers=headers(actor)).json()["data"]
        assert "waiting_rank" not in detail
        assert "waiting_rank" not in listing[0]
