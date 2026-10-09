import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def isolated_db():
    dsn = os.getenv("MARKETORY_TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("Dedicated local test DB required")
    if psycopg.conninfo.conninfo_to_dict(dsn).get("host") not in ("127.0.0.1", "localhost", "::1"):
        pytest.fail("Integration fixtures may only create databases on loopback hosts")
    name = "marketory_test_" + uuid4().hex
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    target = psycopg.conninfo.make_conninfo(dsn, dbname=name)
    try:
        with psycopg.connect(target) as conn:
            conn.execute("CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY)")
            conn.execute("""DO $$ BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
                    CREATE ROLE anon NOLOGIN; END IF;
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
                    CREATE ROLE authenticated NOLOGIN; END IF;
                END $$""")
            for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
                conn.execute(migration.read_text(encoding="utf-8"))
        yield target
    finally:
        with psycopg.connect(dsn, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


def test_migration_blocks_direct_access_and_incomplete_commit(isolated_db):
    actor = uuid4()
    with psycopg.connect(isolated_db) as conn:
        conn.execute("INSERT INTO auth.users VALUES (%s)", (actor,))
        conn.execute(
            "INSERT INTO public.users(user_id,email) VALUES (%s,%s)", (actor, "a@test.invalid")
        )
    with pytest.raises(psycopg.errors.CheckViolation):
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                """INSERT INTO public.api_idempotency
                (actor_user_id,operation,idempotency_key,request_hash,status)
                VALUES (%s,'test',%s,'hash','IN_PROGRESS')""",
                (actor, uuid4()),
            )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(isolated_db) as conn:
            conn.execute("SET LOCAL ROLE authenticated")
            conn.execute("SELECT * FROM public.users")
    with pytest.raises(psycopg.errors.CheckViolation):
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                """INSERT INTO public.api_idempotency
                (actor_user_id,operation,idempotency_key,request_hash,status,response_json)
                VALUES (%s,'bad-result',%s,'hash','SUCCEEDED','{}')""",
                (actor, uuid4()),
            )
    with psycopg.connect(isolated_db) as conn:
        assert conn.execute("SELECT count(*) FROM public.api_idempotency").fetchone()[0] == 0


def seed(dsn):
    actor, other, project = uuid4(), uuid4(), uuid4()
    with psycopg.connect(dsn) as conn:
        for uid in (actor, other):
            conn.execute("INSERT INTO auth.users VALUES (%s)", (uid,))
            conn.execute(
                "INSERT INTO public.users(user_id,email,account_role) VALUES (%s,%s,'STAFF')",
                (uid, f"{uid}@test.invalid"),
            )
        conn.execute(
            """INSERT INTO public.projects(project_id,name,event_date,venue,recruit_start_at,
            recruit_end_at,event_end_at,target_team_count,policy_json,evaluation_policy_json,created_by)
            VALUES (%s,'Original',CURRENT_DATE,'Test',now(),now()+interval '1 day',
                    now()+interval '2 days',10,'{}','{}',%s)""",
            (project, actor),
        )
        conn.execute(
            "INSERT INTO public.project_members(project_id,user_id,role) VALUES (%s,%s,'OPERATOR')",
            (project, actor),
        )
    return actor, other, project


def test_idempotency_replay_conflict_rollback_expiry(isolated_db):
    from marketory.config import Settings
    from marketory.db import transaction
    from marketory.errors import DomainError
    from marketory.idempotency import Change, execute, expire, lookup
    from marketory.permissions import require_project
    from marketory.runtime import run_async

    actor, other, project = seed(isolated_db)
    key = uuid4()
    config = Settings(database_url=isolated_db)

    async def scenario():
        async def invoke(key=key, body=None, crash=False):
            payload = body or {"expected_version": 1, "name": "Changed"}
            async with transaction(config) as conn:

                async def authorize():
                    await require_project(conn, actor, project, "operate")

                async def change():
                    row = await conn.execute(
                        "UPDATE public.projects SET name=%s,version=version+1 "
                        "WHERE project_id=%s AND version=%s RETURNING version",
                        (payload["name"], project, payload["expected_version"]),
                    )
                    result = await row.fetchone()
                    if not result:
                        raise DomainError(409, "VERSION_CONFLICT", "Version changed")
                    if crash:
                        raise RuntimeError("simulated precommit crash")
                    return Change(
                        {"version": result[0]}, resource_type="project", resource_id=project
                    )

                return await execute(
                    conn,
                    actor,
                    "projects.update",
                    key,
                    "PATCH",
                    f"/api/projects/{project}",
                    "project",
                    project,
                    payload,
                    authorize,
                    change,
                )

        first = await invoke()
        assert await invoke() == first
        with pytest.raises(DomainError) as mismatch:
            await invoke(body={"expected_version": 2, "name": "Different"})
        assert mismatch.value.code == "IDEMPOTENCY_CONFLICT"
        crash_key = uuid4()
        with pytest.raises(RuntimeError):
            await invoke(crash_key, {"expected_version": 2, "name": "Crash"}, True)
        async with transaction(config) as conn:
            missing = await lookup(conn, actor, "projects.update", crash_key)
            assert missing.status == 202
        await invoke(crash_key, {"expected_version": 2, "name": "Recovered"})
        async with transaction(config) as conn:
            await expire(conn, actor, "projects.update", key, cutoff="2100-01-01T00:00:00Z")
        with pytest.raises(DomainError) as expired:
            await invoke(body={"expected_version": 99, "name": "No repeat"})
        assert expired.value.status == 410
        async with transaction(config) as conn:
            assert (await lookup(conn, other, "projects.update", key)).status == 202
            with pytest.raises(DomainError) as expired_lookup:
                await lookup(conn, actor, "projects.update", key)
            assert expired_lookup.value.status == 410

    run_async(scenario())


def test_concurrent_requests_and_revoked_permissions(isolated_db):
    import asyncio

    from marketory.config import Settings
    from marketory.db import transaction
    from marketory.errors import DomainError
    from marketory.idempotency import Change, execute, lookup
    from marketory.permissions import require_project
    from marketory.runtime import run_async

    actor, _, project = seed(isolated_db)
    key = uuid4()
    config = Settings(database_url=isolated_db)

    async def call():
        async with transaction(config) as conn:

            async def authorize():
                await require_project(conn, actor, project, "operate")

            async def mutate():
                await asyncio.sleep(0.05)
                row = await conn.execute(
                    "UPDATE public.projects SET version=version+1 "
                    "WHERE project_id=%s RETURNING version",
                    (project,),
                )
                return Change({"version": (await row.fetchone())[0]})

            return await execute(
                conn,
                actor,
                "projects.update",
                key,
                "PATCH",
                f"/api/projects/{project}",
                "project",
                project,
                {},
                authorize,
                mutate,
            )

    async def scenario():
        results = await asyncio.gather(call(), call(), call())
        assert results[0] == results[1] == results[2]
        assert results[0].body["data"]["version"] == 2
        async with transaction(config) as conn:
            await conn.execute(
                "UPDATE public.project_members SET role='VIEWER' WHERE user_id=%s", (actor,)
            )
        for action in (call,):
            with pytest.raises(DomainError) as denied:
                await action()
            assert denied.value.status == 403
        async with transaction(config) as conn:
            with pytest.raises(DomainError) as denied:
                await lookup(conn, actor, "projects.update", key)
            assert denied.value.status == 403
            await conn.execute(
                "UPDATE public.project_members SET active=false WHERE user_id=%s", (actor,)
            )
        with pytest.raises(DomainError) as missing:
            await call()
        assert missing.value.status == 404

    run_async(scenario())


def test_business_rejection_savepoint_and_async_expiry_guard(isolated_db):
    from marketory.config import Settings
    from marketory.db import transaction
    from marketory.errors import DomainError
    from marketory.idempotency import Change, execute, expire
    from marketory.permissions import require_project
    from marketory.runtime import run_async

    actor, _, project = seed(isolated_db)
    config = Settings(database_url=isolated_db)
    key, async_key = uuid4(), uuid4()

    async def scenario():
        async with transaction(config) as conn:

            async def authorize():
                await require_project(conn, actor, project, "operate")

            async def reject():
                await conn.execute(
                    "UPDATE public.projects SET name='Must rollback' WHERE project_id=%s",
                    (project,),
                )
                raise DomainError(409, "VERSION_CONFLICT", "Old version")

            failed = await execute(
                conn,
                actor,
                "projects.update",
                key,
                "PATCH",
                f"/api/projects/{project}",
                "project",
                project,
                {},
                authorize,
                reject,
            )
            assert failed.status == 409
            row = await conn.execute(
                "SELECT name FROM public.projects WHERE project_id=%s", (project,)
            )
            assert (await row.fetchone())[0] == "Original"

            async def should_not_run():
                pytest.fail("Stored failure must replay")

            assert (
                await execute(
                    conn,
                    actor,
                    "projects.update",
                    key,
                    "PATCH",
                    f"/api/projects/{project}",
                    "project",
                    project,
                    {},
                    authorize,
                    should_not_run,
                )
                == failed
            )

            async def accept_job():
                return Change(
                    {"queued": True}, status=202, resource_type="evaluation", resource_id=uuid4()
                )

            await execute(
                conn,
                actor,
                "ai.evaluate",
                async_key,
                "POST",
                "/api/evaluations",
                "project",
                project,
                {},
                authorize,
                accept_job,
            )
        async with transaction(config) as conn:
            with pytest.raises(DomainError) as guarded:
                await expire(conn, actor, "ai.evaluate", async_key, "2100-01-01T00:00:00Z")
            assert guarded.value.code == "RESOURCE_NOT_TERMINAL"
        with pytest.raises(psycopg.errors.CheckViolation):
            async with transaction(config) as conn:
                await conn.execute(
                    "UPDATE public.api_idempotency SET status='EXPIRED',request_hash=NULL,"
                    "response_json=NULL,http_status=NULL,resource_type=NULL,"
                    "resource_id=NULL,expired_at=now() "
                    "WHERE idempotency_key=%s",
                    (async_key,),
                )

    run_async(scenario())


@pytest.mark.parametrize(
    "role,action,allowed",
    [
        ("OPERATOR", "operate", True),
        ("REVIEWER", "review", True),
        ("REVIEWER", "operate", False),
        ("VIEWER", "summary", True),
        ("VIEWER", "review", False),
        ("VIEWER", "operate", False),
    ],
)
def test_project_capabilities(isolated_db, role, action, allowed):
    from marketory.config import Settings
    from marketory.db import transaction
    from marketory.errors import DomainError
    from marketory.permissions import require_project
    from marketory.runtime import run_async

    actor, _, project = seed(isolated_db)

    async def scenario():
        async with transaction(Settings(database_url=isolated_db)) as conn:
            await conn.execute(
                "UPDATE public.project_members SET role=%s WHERE user_id=%s", (role, actor)
            )
            if allowed:
                assert (await require_project(conn, actor, project, action))[
                    "project_id"
                ] == project
            else:
                with pytest.raises(DomainError) as error:
                    await require_project(conn, actor, project, action)
                assert error.value.status == 403

    run_async(scenario())


def test_key_lock_timeout_returns_retry_header(isolated_db):
    import asyncio

    import httpx

    from marketory.auth import Identity
    from marketory.config import Settings
    from marketory.db import transaction
    from marketory.idempotency import lock_key
    from marketory.main import create_app
    from marketory.runtime import run_async

    actor, _, _ = seed(isolated_db)
    key = uuid4()
    config = Settings(environment="test", database_url=isolated_db)

    async def verify(token):
        return Identity(actor, "test@test.invalid")

    async def scenario():
        async with transaction(config) as conn:
            await lock_key(conn, actor, "auth.bootstrap", key)
            app = create_app(config, authenticator=verify)
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await asyncio.wait_for(
                    client.get(
                        f"/api/me/requests/auth.bootstrap/{key}",
                        headers={"Authorization": "Bearer test"},
                    ),
                    timeout=8,
                )
                assert response.status_code == 409
                assert response.json()["code"] == "REQUEST_IN_PROGRESS"
                assert response.headers["Retry-After"] == "2"

    run_async(scenario())


def test_expiry_serializes_with_replay_and_clears_private_result(isolated_db):
    import asyncio

    from marketory.config import Settings
    from marketory.db import transaction
    from marketory.errors import DomainError
    from marketory.idempotency import Change, execute, expire, lookup
    from marketory.permissions import active_user
    from marketory.runtime import run_async

    actor, _, _ = seed(isolated_db)
    config = Settings(database_url=isolated_db)
    key = uuid4()

    async def scenario():
        async with transaction(config) as conn:

            async def authorize():
                await active_user(conn, actor)

            async def mutate():
                return Change({"private": "sensitive-result"})

            await execute(
                conn,
                actor,
                "auth.bootstrap",
                key,
                "POST",
                "/api/auth/bootstrap",
                "user",
                actor,
                {},
                authorize,
                mutate,
            )

        async def read():
            async with transaction(config) as conn:
                try:
                    return (await lookup(conn, actor, "auth.bootstrap", key)).status
                except DomainError as error:
                    return error.status

        async def expiration():
            async with transaction(config) as conn:
                return await expire(conn, actor, "auth.bootstrap", key, "2100-01-01T00:00:00Z")

        read_status, _ = await asyncio.gather(read(), expiration())
        assert read_status in (200, 410)
        assert await read() == 410
        async with transaction(config) as conn:
            row = await conn.execute(
                "SELECT status,request_hash,response_json,http_status,resource_type,"
                "resource_id,expired_at FROM public.api_idempotency WHERE idempotency_key=%s",
                (key,),
            )
            stored = await row.fetchone()
            assert stored[:6] == ("EXPIRED", None, None, None, None, None)
            assert stored[6] is not None

    run_async(scenario())


def test_seller_ownership_and_staff_membership_constraint(isolated_db):
    from marketory.config import Settings
    from marketory.db import transaction
    from marketory.errors import DomainError
    from marketory.permissions import require_seller
    from marketory.runtime import run_async

    actor, other, project = seed(isolated_db)
    seller = uuid4()
    with psycopg.connect(isolated_db) as conn:
        conn.execute("UPDATE public.users SET account_role='SELLER' WHERE user_id=%s", (other,))
        conn.execute(
            "INSERT INTO public.sellers(seller_id,user_id,shop_name,owner_name,phone) "
            "VALUES (%s,%s,'Test shop','Owner','01000000000')",
            (seller, other),
        )
    with pytest.raises(psycopg.errors.CheckViolation):
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "INSERT INTO public.project_members(project_id,user_id,role) "
                "VALUES (%s,%s,'OPERATOR')",
                (project, other),
            )

    async def scenario():
        async with transaction(Settings(database_url=isolated_db)) as conn:
            await require_seller(conn, other, seller)
            with pytest.raises(DomainError) as error:
                await require_seller(conn, actor, seller)
            assert error.value.status == 404

    run_async(scenario())
