from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_p1_p3 import isolated_db, seed  # noqa: F401

from marketory.auth import Identity
from marketory.config import Settings
from marketory.main import create_app


def test_bootstrap_project_isolation_and_result_access(isolated_db):  # noqa: F811
    import psycopg

    actor, other, project = seed(isolated_db)
    seller = uuid4()
    with psycopg.connect(isolated_db) as conn:
        conn.execute("INSERT INTO auth.users VALUES (%s)", (seller,))
    identities = {str(uid): Identity(uid, f"{uid}@test.invalid") for uid in (actor, other, seller)}

    async def verify(token):
        return identities[token]

    app = create_app(Settings(environment="test", database_url=isolated_db), authenticator=verify)
    with TestClient(
        app, backend_options={"loop_factory": __import__("asyncio").SelectorEventLoop}
    ) as client:
        assert client.get("/api/me").status_code == 401
        headers = {"Authorization": f"Bearer {seller}", "Idempotency-Key": str(uuid4())}
        assert (
            client.get(
                f"/api/me/requests/auth.bootstrap/{headers['Idempotency-Key']}", headers=headers
            ).status_code
            == 202
        )
        first = client.post("/api/auth/bootstrap", headers=headers, json={})
        assert first.status_code == 200
        assert first.json()["data"]["account_role"] == "SELLER"
        assert first.json()["data"]["profile_required"] is True
        assert client.post("/api/auth/bootstrap", headers=headers, json={}).json() == first.json()
        assert (
            client.post(
                "/api/auth/bootstrap",
                headers={**headers, "Idempotency-Key": str(uuid4())},
                json={"global_role": "PLATFORM_ADMIN"},
            ).status_code
            == 422
        )
        assert client.get("/api/projects", headers=headers).status_code == 403
        operator_headers = {"Authorization": f"Bearer {actor}"}
        assert len(client.get("/api/projects", headers=operator_headers).json()["data"]) == 1
        assert (
            client.get(
                f"/api/projects/{project}", headers={"Authorization": f"Bearer {other}"}
            ).status_code
            == 404
        )
        key = headers["Idempotency-Key"]
        assert (
            client.get(f"/api/me/requests/auth.bootstrap/{key}", headers=headers).status_code == 200
        )
        assert (
            client.get(
                f"/api/me/requests/auth.bootstrap/{key}", headers=operator_headers
            ).status_code
            == 202
        )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.api_idempotency SET status='EXPIRED',request_hash=NULL,"
                "response_json=NULL,http_status=NULL,resource_type=NULL,resource_id=NULL,"
                "expired_at=now() WHERE idempotency_key=%s",
                (key,),
            )
        assert (
            client.post(
                "/api/auth/bootstrap", headers=headers, json={"global_role": "BAD"}
            ).status_code
            == 410
        )
        staff = client.post(
            "/api/auth/bootstrap",
            headers={**operator_headers, "Idempotency-Key": str(uuid4())},
            json={},
        )
        assert staff.json()["data"]["account_role"] == "STAFF"
        identities[str(actor)] = Identity(actor, "updated@test.invalid")
        client.post(
            "/api/auth/bootstrap",
            headers={**operator_headers, "Idempotency-Key": str(uuid4())},
            json={},
        )
        with psycopg.connect(isolated_db) as conn:
            assert (
                conn.execute(
                    "SELECT email FROM public.users WHERE user_id=%s", (actor,)
                ).fetchone()[0]
                == "updated@test.invalid"
            )
        new_actor = uuid4()
        identities[str(new_actor)] = Identity(new_actor, f"{actor}@test.invalid")
        with psycopg.connect(isolated_db) as conn:
            conn.execute("INSERT INTO auth.users VALUES (%s)", (new_actor,))
        new_headers = {"Authorization": f"Bearer {new_actor}", "Idempotency-Key": str(uuid4())}
        rejected = client.post(
            "/api/auth/bootstrap", headers=new_headers, json={"status": "ACTIVE"}
        )
        assert rejected.status_code == 422
        with psycopg.connect(isolated_db) as conn:
            assert (
                conn.execute(
                    "SELECT count(*) FROM public.users WHERE user_id=%s", (new_actor,)
                ).fetchone()[0]
                == 0
            )
        assert (
            client.get(
                f"/api/me/requests/auth.bootstrap/{new_headers['Idempotency-Key']}",
                headers=new_headers,
            ).status_code
            == 202
        )
        assert client.post("/api/auth/bootstrap", headers=new_headers, json={}).status_code == 200
        with psycopg.connect(isolated_db) as conn:
            conn.execute("UPDATE public.users SET status='INACTIVE' WHERE user_id=%s", (seller,))
        assert client.post("/api/auth/bootstrap", headers=headers, json={}).status_code == 403


def test_auth_injection_is_test_only():
    with pytest.raises(ValueError):
        create_app(Settings(environment="local"), authenticator=lambda token: None)
