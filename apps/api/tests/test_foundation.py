import asyncio

import pytest
from fastapi.testclient import TestClient

from marketory.config import Settings
from marketory.main import create_app
from marketory.worker import run_worker


def test_live_does_not_require_database():
    with TestClient(create_app(Settings(database_url=None))) as client:
        assert client.get("/health/live").json() == {"status": "ok"}
        assert client.get("/health/ready").status_code == 503


def test_ready_success_and_failure_do_not_leak_secrets():
    async def healthy():
        return True

    async def broken():
        raise RuntimeError("postgresql://secret:password@internal/db")

    for probe, status in [(healthy, 200), (broken, 503)]:
        with TestClient(create_app(Settings(database_url=None), probe=probe)) as client:
            response = client.get("/health/ready")
            assert response.status_code == status
            assert "password" not in response.text
            assert "internal" not in response.text


def test_cors_only_allows_configured_origin():
    with TestClient(create_app(Settings(database_url=None))) as client:
        for origin, allowed in [("http://localhost:3000", True), ("https://attacker.test", False)]:
            response = client.options(
                "/health/live",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "GET",
                },
            )
            assert ("access-control-allow-origin" in response.headers) == allowed


def test_production_requires_database_and_explicit_origins():
    with pytest.raises(ValueError):
        Settings(environment="production", database_url=None)
    with pytest.raises(ValueError):
        Settings(environment="production", database_url="postgresql://x", cors_origins=["*"])


def test_invalid_settings_do_not_expose_database_password():
    with pytest.raises(ValueError) as error:
        Settings(
            environment="production", database_url="postgresql://u:TESTSECRET@h/d", _env_file=None
        )
    assert "TESTSECRET" not in str(error.value)


def test_worker_recovers_after_probe_failure_and_stops():
    async def scenario():
        stop = asyncio.Event()
        attempts = []

        async def probe():
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("temporary failure")
            stop.set()
            return True

        await asyncio.wait_for(run_worker(stop, probe, interval=0.001), timeout=1)
        assert len(attempts) == 2

    asyncio.run(scenario())


def test_stopped_worker_does_not_probe():
    async def scenario():
        stop = asyncio.Event()
        stop.set()

        async def probe():
            pytest.fail("Stopped worker must not start work")

        await run_worker(stop, probe, interval=1)

    asyncio.run(scenario())
