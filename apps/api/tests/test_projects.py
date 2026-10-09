from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient
from test_p1_p3 import isolated_db, seed  # noqa: F401

from marketory.auth import Identity
from marketory.config import Settings
from marketory.main import create_app


def payload():
    end = datetime.now(timezone.utc).replace(hour=8, minute=0, second=0, microsecond=0) + timedelta(
        days=30
    )
    return dict(
        name="테스트 마켓",
        venue="검증용 장소",
        event_date=end.date().isoformat(),
        recruit_start_at=(end - timedelta(days=10)).isoformat(),
        recruit_end_at=(end - timedelta(days=1)).isoformat(),
        event_end_at=end.isoformat(),
        target_team_count=10,
        policy_json={
            "schema_version": 1,
            "allowed_categories": ["공예"],
            "restricted_items": [],
            "business_required": False,
            "photo_required": True,
            "participation_fee_krw": 0,
            "consent_version": "test-1",
            "consent_text": "검증용 동의 문구",
        },
        booth_policy_json={"schema_version": 1, "description": "테이블 제공"},
        evaluation_policy_json={
            "schema_version": 1,
            "criteria": [{"code": "적합성", "weight": 100}],
        },
        reason="검증",
    )


def client_for(dsn):
    async def verify(token):
        from uuid import UUID

        return Identity(UUID(token), f"{token}@test.invalid")

    return TestClient(
        create_app(Settings(environment="test", database_url=dsn), authenticator=verify),
        backend_options={"loop_factory": __import__("asyncio").SelectorEventLoop},
    )


def headers(actor, key=None):
    return {"Authorization": f"Bearer {actor}", "Idempotency-Key": str(key or uuid4())}


def test_create_replay_and_permissions(isolated_db):  # noqa: F811
    actor, other, _ = seed(isolated_db)
    with client_for(isolated_db) as c:
        assert c.get("/api/me", headers=headers(actor)).json()["data"]["can_create_project"]
        assert not c.get("/api/me", headers=headers(other)).json()["data"]["can_create_project"]
        h = headers(actor)
        first = c.post("/api/projects", headers=h, json=payload())
        assert first.status_code == 201
        assert c.post("/api/projects", headers=h, json=payload()).json() == first.json()
        assert c.post("/api/projects", headers=headers(other), json=payload()).status_code == 403
        project = first.json()["data"]["project_id"]
        assert c.get(f"/api/projects/{project}/settings", headers=headers(other)).status_code == 404
        with psycopg.connect(isolated_db) as conn:
            assert (
                conn.execute(
                    "select count(*) from public.projects where name='테스트 마켓'"
                ).fetchone()[0]
                == 1
            )


def test_version_policy_and_state_guards(isolated_db):  # noqa: F811
    actor, _, _ = seed(isolated_db)
    with client_for(isolated_db) as c:
        project = c.post("/api/projects", headers=headers(actor), json=payload()).json()["data"][
            "project_id"
        ]
        body = {**payload(), "expected_version": 1}
        body["policy_json"]["photo_required"] = False
        h = headers(actor)
        r = c.patch(f"/api/projects/{project}", headers=h, json=body)
        assert r.status_code == 200 and r.json()["data"]["policy_version"] == 2
        assert c.patch(f"/api/projects/{project}", headers=h, json=body).json() == r.json()
        assert (
            c.patch(f"/api/projects/{project}", headers=headers(actor), json=body).status_code
            == 409
        )
        assert (
            c.post(
                f"/api/projects/{project}/status",
                headers=headers(actor),
                json={"expected_version": 2, "status": "CLOSED", "reason": "잘못된 전환"},
            ).status_code
            == 409
        )
        assert (
            c.post(
                f"/api/projects/{project}/status",
                headers=headers(actor),
                json={"expected_version": 2, "status": "RECRUITING", "reason": "공개"},
            ).status_code
            == 200
        )
        public = c.get(f"/api/public/projects/{project}").json()["data"]
        assert public["accepting_applications"] is False  # future recruitment
        assert "created_by" not in public and "evaluation_policy_json" not in public
        # Editing an open recruitment uses aware datetimes, not JSON string comparison.
        body["expected_version"] = 3
        assert (
            c.patch(f"/api/projects/{project}", headers=headers(actor), json=body).status_code
            == 200
        )
        body["expected_version"] = 4
        old = datetime.now(timezone.utc) - timedelta(days=1)
        body.update(
            event_date=old.astimezone(timezone(timedelta(hours=9))).date().isoformat(),
            event_end_at=old.isoformat(),
            recruit_end_at=(old - timedelta(days=1)).isoformat(),
            recruit_start_at=(old - timedelta(days=2)).isoformat(),
        )
        assert (
            c.patch(f"/api/projects/{project}", headers=headers(actor), json=body).status_code
            == 422
        )


def test_invalid_policy_and_publish_requirements(isolated_db):  # noqa: F811
    actor, _, _ = seed(isolated_db)
    with client_for(isolated_db) as c:
        body = payload()
        body["evaluation_policy_json"]["criteria"][0]["weight"] = 90
        assert c.post("/api/projects", headers=headers(actor), json=body).status_code == 422
        body = payload()
        body["policy_json"]["consent_text"] = ""
        project = c.post("/api/projects", headers=headers(actor), json=body).json()["data"][
            "project_id"
        ]
        assert (
            c.post(
                f"/api/projects/{project}/status",
                headers=headers(actor),
                json={"expected_version": 1, "status": "RECRUITING", "reason": "공개"},
            ).status_code
            == 422
        )


def test_admin_assigns_staff_and_revocation_blocks_replay(isolated_db):  # noqa: F811
    actor, other, project = seed(isolated_db)
    with psycopg.connect(isolated_db) as conn:
        conn.execute(
            "update public.users set global_role='PLATFORM_ADMIN' where user_id=%s", (actor,)
        )
    with client_for(isolated_db) as c:
        body = {
            "email": f"{other}@test.invalid",
            "role": "OPERATOR",
            "active": True,
            "expected_version": 1,
            "reason": "운영자 배정",
        }
        assert (
            c.post(
                f"/api/projects/{project}/members", headers=headers(actor), json=body
            ).status_code
            == 200
        )
        update = {**payload(), "expected_version": 2}
        h = headers(other)
        assert c.patch(f"/api/projects/{project}", headers=h, json=update).status_code == 200
        body.update(active=False, expected_version=3)
        assert (
            c.post(
                f"/api/projects/{project}/members", headers=headers(actor), json=body
            ).status_code
            == 200
        )
        assert c.patch(f"/api/projects/{project}", headers=h, json=update).status_code == 404


def test_concurrent_create_and_update_serialize(isolated_db):  # noqa: F811
    actor, _, _ = seed(isolated_db)
    h, body = headers(actor), payload()

    def create():
        with client_for(isolated_db) as c:
            return c.post("/api/projects", headers=h, json=body)

    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _: create(), range(2)))
    assert [r.status_code for r in replies] == [201, 201]
    assert replies[0].json() == replies[1].json()
    project = replies[0].json()["data"]["project_id"]

    def update(name):
        with client_for(isolated_db) as c:
            return c.patch(
                f"/api/projects/{project}",
                headers=headers(actor),
                json={**body, "name": name, "expected_version": 1},
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(update, ["수정 A", "수정 B"]))
    assert sorted(codes) == [200, 409]


def test_admin_creator_always_becomes_operator(isolated_db):  # noqa: F811
    actor, _, _ = seed(isolated_db)
    with psycopg.connect(isolated_db) as conn:
        conn.execute(
            "UPDATE public.users SET global_role='PLATFORM_ADMIN',account_role='SELLER' "
            "WHERE user_id=%s",
            (actor,),
        )
    with client_for(isolated_db) as c:
        r = c.post("/api/projects", headers=headers(actor), json=payload())
        assert r.status_code == 201
        pid = r.json()["data"]["project_id"]
        rows = c.get(f"/api/projects/{pid}/members", headers=headers(actor)).json()["data"]
        assert any(m["user_id"] == str(actor) and m["role"] == "OPERATOR" for m in rows)


def test_roles_end_time_and_recruitment_guards(isolated_db):  # noqa: F811
    actor, other, _ = seed(isolated_db)
    with client_for(isolated_db) as c:
        project = c.post("/api/projects", headers=headers(actor), json=payload()).json()["data"]
        pid = project["project_id"]
        assert c.get(f"/api/public/projects/{pid}").status_code == 404
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "INSERT INTO public.project_members(project_id,user_id,role) "
                "VALUES(%s,%s,'REVIEWER')",
                (pid, other),
            )
        assert c.get(f"/api/projects/{pid}", headers=headers(other)).status_code == 200
        assert c.get(f"/api/projects/{pid}/settings", headers=headers(other)).status_code == 403
        assert c.get(f"/api/projects/{pid}/members", headers=headers(actor)).status_code == 403
        with psycopg.connect(isolated_db) as conn:
            conn.execute("UPDATE public.projects SET status='CLOSED' WHERE project_id=%s", (pid,))
        transition = {"expected_version": 1, "status": "COMPLETED", "reason": "종료"}
        assert (
            c.post(
                f"/api/projects/{pid}/status", headers=headers(actor), json=transition
            ).status_code
            == 409
        )
        with psycopg.connect(isolated_db) as conn:
            # Shift the whole valid interval together to preserve database constraints.
            conn.execute(
                "UPDATE public.projects SET event_end_at=event_end_at-interval '60 days',"
                "event_date=event_date-60,recruit_start_at=recruit_start_at-interval '60 days',"
                "recruit_end_at=recruit_end_at-interval '60 days' WHERE project_id=%s",
                (pid,),
            )
        assert (
            c.patch(
                f"/api/projects/{pid}",
                headers=headers(actor),
                json={**payload(), "expected_version": 1},
            ).status_code
            == 409
        )
        assert (
            c.post(
                f"/api/projects/{pid}/status", headers=headers(actor), json=transition
            ).status_code
            == 200
        )
