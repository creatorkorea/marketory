# ruff: noqa: F811
import asyncio
from uuid import UUID, uuid4

import psycopg
import pytest
from marketory.communication_worker import process_one, recover_stale
from marketory.config import Settings
from marketory.email_provider import DeliveryResult
from marketory.runtime import run_async
from psycopg.rows import dict_row
from pydantic import SecretStr
from test_communications import action, client_for, data, queued
from test_p1_p3 import isolated_db  # noqa: F401
from test_reviews import fixture


def settings(dsn, **kwargs):
    return Settings(
        _env_file=None,
        environment="test",
        database_url=dsn,
        email_delivery_enabled=True,
        resend_api_key="fake-test-key",
        **kwargs,
    )


class FakeProvider:
    def __init__(self, result=None):
        self.calls = []
        self.result = result or DeliveryResult("SENT", "mock-id")

    async def send(self, message):
        self.calls.append(message.copy())
        return self.result


def snapshot(dsn, cid):
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        msg = conn.execute(
            "SELECT * FROM public.communications WHERE communication_id=%s", (cid,)
        ).fetchone()
        attempts = conn.execute(
            "SELECT * FROM public.communication_attempts WHERE "
            "communication_id=%s ORDER BY attempt_no",
            (cid,),
        ).fetchall()
        return msg, attempts


def setup_queue(dsn):
    op, _, _, _, pid, aid = fixture(dsn)
    with client_for(dsn) as c:
        msg = queued(c, op, pid, aid)
    return op, pid, aid, msg


def test_targeted_delivery_never_falls_back_to_other_queue(isolated_db):
    _, _, _, first = setup_queue(isolated_db)
    _, _, _, target = setup_queue(isolated_db)
    first_before = snapshot(isolated_db, first["communication_id"])
    fake = FakeProvider()
    cid = UUID(target["communication_id"])
    assert run_async(process_one(settings(isolated_db), fake, communication_id=cid))
    assert [str(m["communication_id"]) for m in fake.calls] == [str(cid)]
    assert snapshot(isolated_db, first["communication_id"]) == first_before
    assert snapshot(isolated_db, cid)[0]["send_status"] == "SENT"
    assert not run_async(process_one(settings(isolated_db), fake, communication_id=cid))
    assert not run_async(process_one(settings(isolated_db), fake, communication_id=uuid4()))
    assert len(fake.calls) == 1
    assert snapshot(isolated_db, first["communication_id"]) == first_before


def test_disabled_or_missing_key_never_claims(isolated_db):
    _, _, _, msg = setup_queue(isolated_db)
    fake = FakeProvider()
    for changes in (
        {"email_delivery_enabled": False},
        {"resend_api_key": None},
        {"resend_api_key": SecretStr(" ")},
    ):
        config = settings(isolated_db).model_copy(update=changes)
        assert run_async(process_one(config, fake)) is False
    current, attempts = snapshot(isolated_db, msg["communication_id"])
    assert current["send_status"] == "QUEUED" and attempts == [] and fake.calls == []


@pytest.mark.parametrize("targeted", [False, True])
def test_concurrent_claim_single_attempt_network_outside_transaction(isolated_db, targeted):
    _, _, _, msg = setup_queue(isolated_db)

    class WaitingProvider(FakeProvider):
        async def send(self, message):
            self.calls.append(message.copy())
            # A separate transaction can acquire these locks during network work.
            with psycopg.connect(isolated_db) as conn:
                conn.execute("SET LOCAL lock_timeout='200ms'")
                conn.execute(
                    "SELECT 1 FROM public.projects WHERE project_id=%s FOR UPDATE",
                    (message["project_id"],),
                )
                conn.execute(
                    "SELECT 1 FROM public.communications WHERE communication_id=%s FOR UPDATE",
                    (message["communication_id"],),
                )
            await asyncio.sleep(0.05)
            return self.result

    fake = WaitingProvider()
    target = UUID(msg["communication_id"]) if targeted else None

    async def race():
        return await asyncio.wait_for(
            asyncio.gather(
                process_one(settings(isolated_db), fake, communication_id=target),
                process_one(settings(isolated_db), fake, communication_id=target),
            ),
            timeout=5,
        )

    assert sorted(run_async(race())) == [False, True]
    current, attempts = snapshot(isolated_db, msg["communication_id"])
    assert current["send_status"] == "SENT" and current["sent_at"]
    assert len(attempts) == len(fake.calls) == 1
    assert attempts[0]["status"] == "SENT" and attempts[0]["provider_message_id"] == "mock-id"


def test_retry_preserves_key_payload_and_sender(isolated_db):
    op, _, _, msg = setup_queue(isolated_db)
    fake = FakeProvider(DeliveryResult("FAILED", error_code="PROVIDER_HTTP_422"))
    assert run_async(process_one(settings(isolated_db), fake))
    with client_for(isolated_db) as c:
        current, _ = snapshot(isolated_db, msg["communication_id"])
        data(action(c, op, current, "retry"), 202)
        assert run_async(
            process_one(settings(isolated_db, email_from="changed@test.invalid"), fake)
        )
        assert fake.calls[0]["idempotency_key"] == fake.calls[1]["idempotency_key"]
        for field in ("recipient_snapshot", "sender_snapshot", "subject", "body"):
            assert fake.calls[0][field] == fake.calls[1][field]
        current, attempts = snapshot(isolated_db, msg["communication_id"])
        assert len(attempts) == 2


def test_retry_rejects_expired_provider_key_without_new_attempt(isolated_db):
    op, _, _, msg = setup_queue(isolated_db)
    with psycopg.connect(isolated_db) as conn:
        conn.execute(
            "UPDATE public.communications SET send_status='FAILED',sender_snapshot=%s "
            "WHERE communication_id=%s",
            (settings(isolated_db).email_from, msg["communication_id"]),
        )
        conn.execute(
            "INSERT INTO public.communication_attempts(communication_id,attempt_no,status,"
            "started_at,completed_at) VALUES(%s,1,'FAILED',now()-interval '23 hours 1 minute',"
            "now()-interval '23 hours')",
            (msg["communication_id"],),
        )
    with client_for(isolated_db) as c:
        current, _ = snapshot(isolated_db, msg["communication_id"])
        data(action(c, op, current, "retry"), 202)
    fake = FakeProvider()
    assert run_async(process_one(settings(isolated_db), fake))
    current, attempts = snapshot(isolated_db, msg["communication_id"])
    assert current["failure_reason"] == "PROVIDER_KEY_EXPIRED" and fake.calls == []
    assert len(attempts) == 1


@pytest.mark.parametrize("change", ["rights", "inactive", "context", "ended"])
def test_claim_revalidates_current_authorization_and_context(isolated_db, change):
    op, pid, aid, msg = setup_queue(isolated_db)
    with psycopg.connect(isolated_db) as conn:
        if change == "rights":
            conn.execute("UPDATE public.project_members SET role='VIEWER' WHERE user_id=%s", (op,))
        elif change == "inactive":
            conn.execute("UPDATE public.users SET status='INACTIVE' WHERE user_id=%s", (op,))
        elif change == "context":
            # A stale imported snapshot bypasses context invalidation triggers;
            # worker must independently compare the application context at claim.
            conn.execute(
                "UPDATE public.communications SET context_snapshot_json=jsonb_set("
                "context_snapshot_json,'{application_version}','999') WHERE communication_id=%s",
                (msg["communication_id"],),
            )
        else:
            conn.execute(
                "UPDATE public.projects SET status='COMPLETED' WHERE project_id=%s", (pid,)
            )
    fake = FakeProvider()
    run_async(process_one(settings(isolated_db), fake))
    current, attempts = snapshot(isolated_db, msg["communication_id"])
    assert current["send_status"] in ("DRAFT", "FAILED") and attempts == [] and fake.calls == []
    if change == "context":
        assert current["failure_reason"] == "CONTEXT_CHANGED"


def test_stale_recovery_fences_late_success_and_never_requeues(isolated_db):
    _, _, _, msg = setup_queue(isolated_db)

    class StaleProvider(FakeProvider):
        async def send(self, message):
            with psycopg.connect(isolated_db) as conn:
                conn.execute(
                    "UPDATE public.communications SET claimed_at=now()-interval '5 minutes' "
                    "WHERE communication_id=%s",
                    (message["communication_id"],),
                )
            assert await recover_stale(settings(isolated_db)) == 1
            return DeliveryResult("SENT", "late-id")

    assert run_async(process_one(settings(isolated_db), StaleProvider()))
    current, attempts = snapshot(isolated_db, msg["communication_id"])
    assert current["send_status"] == "UNKNOWN" and current["claim_token"] is None
    assert attempts[0]["status"] == "UNKNOWN" and attempts[0]["provider_message_id"] is None
    assert run_async(recover_stale(settings(isolated_db))) == 0
    fake = FakeProvider()
    assert run_async(process_one(settings(isolated_db), fake)) is False and fake.calls == []


def test_provider_timeout_is_unknown_with_completed_evidence(isolated_db):
    _, _, _, msg = setup_queue(isolated_db)

    class SlowProvider:
        async def send(self, message):
            await asyncio.sleep(1)
            return DeliveryResult("SENT", "too-late")

    assert run_async(process_one(settings(isolated_db, email_timeout_seconds=0.01), SlowProvider()))
    current, attempts = snapshot(isolated_db, msg["communication_id"])
    assert current["send_status"] == "UNKNOWN"
    assert attempts[0]["status"] == "UNKNOWN" and attempts[0]["completed_at"]
    assert current["failure_reason"] == "PROVIDER_CALL_ERROR"
