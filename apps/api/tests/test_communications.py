from datetime import datetime, timezone
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers
from test_reviews import fixture

from marketory.auth import Identity
from marketory.config import Settings
from marketory.main import create_app


def client_for(dsn):
    async def verify(token):
        return Identity(UUID(token), f"{token}@test.invalid", datetime.now(timezone.utc))

    return TestClient(
        create_app(
            Settings(_env_file=None, environment="test", database_url=dsn), authenticator=verify
        ),
        backend_options={"loop_factory": __import__("asyncio").SelectorEventLoop},
    )


def generate(c, actor, pid, aid, kind="NOTICE", **changes):
    return c.post(
        "/api/communications/generate",
        headers=headers(actor),
        json=dict(
            project_id=str(pid),
            application_id=str(aid),
            type=kind,
            reason="운영 안내",
            **changes,
        ),
    )


def action(c, actor, message, suffix, **changes):
    return c.post(
        f"/api/communications/{message['communication_id']}/{suffix}",
        headers=headers(actor),
        json=dict(expected_version=message["version"], reason="확인 완료", **changes),
    )


def data(response, status=200):
    assert response.status_code == status, response.text
    return response.json()["data"]


def queued(c, op, pid, aid):
    msg = data(generate(c, op, pid, aid), 201)
    msg = data(action(c, op, msg, "approve", content_version=1))
    return data(action(c, op, msg, "send"), 202)


def attempt(dsn, msg, status="UNKNOWN"):
    tid = uuid4()
    with psycopg.connect(dsn) as conn:
        conn.execute(
            "UPDATE public.communications SET send_status=%s,version=version+1 "
            "WHERE communication_id=%s",
            (status, msg["communication_id"]),
        )
        conn.execute(
            "INSERT INTO public.communication_attempts(attempt_id,communication_id,"
            "attempt_no,status,completed_at) VALUES(%s,%s,1,%s,now())",
            (tid, msg["communication_id"], status),
        )
    msg = dict(msg, version=msg["version"] + 1)
    return msg, tid


def test_draft_approval_queue_replay_and_revoked_rights(isolated_db):  # noqa: F811
    op, rev, viewer, seller, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg = data(generate(c, op, pid, aid), 201)
        assert msg["send_status"] == "DRAFT" and msg["drafted_by_ai"] is False
        assert msg["recipient_snapshot"] == "private@test.invalid"
        assert "idempotency_key" not in msg and "claim_token" not in msg
        assert action(c, op, msg, "send").status_code == 409
        assert action(c, op, msg, "approve", content_version=2).status_code == 409
        msg = data(action(c, op, msg, "approve", content_version=1))
        h = headers(op)
        path = f"/api/communications/{msg['communication_id']}/send"
        body = dict(expected_version=msg["version"], reason="발송 요청")
        response = c.post(path, headers=h, json=body)
        msg = data(response, 202)
        assert msg["send_status"] == "QUEUED" and msg["attempts"] == []
        assert c.post(path, headers=h, json=body).json() == response.json()
        listing = data(c.get(f"/api/projects/{pid}/communications", headers=headers(op)))
        assert listing["total"] == 1 and listing["delivery_enabled"] is False
        for actor in (rev, viewer, seller):
            assert c.get(
                f"/api/communications/{msg['communication_id']}", headers=headers(actor)
            ).status_code in (403, 404)
            assert generate(c, actor, pid, aid).status_code in (403, 404)
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.project_members SET role='REVIEWER' WHERE user_id=%s", (op,)
            )
        assert c.post(path, headers=h, json=body).status_code == 403
        assert (
            c.get(
                f"/api/me/requests/communications.send/{h['Idempotency-Key']}", headers=headers(op)
            ).status_code
            == 403
        )


def test_context_invalidates_queue_and_revise_refreshes_recipient(isolated_db):  # noqa: F811
    op, _, _, _, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg = queued(c, op, pid, aid)
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET notification_email='new@test.invalid',"
                "version=version+1 WHERE application_id=%s",
                (aid,),
            )
        msg = data(c.get(f"/api/communications/{msg['communication_id']}", headers=headers(op)))
        assert msg["send_status"] == "DRAFT" and msg["approved_version"] is None
        assert msg["allowed_actions"] == ["revise"]
        assert action(c, op, msg, "approve", content_version=1).status_code == 409
        revised = data(action(c, op, msg, "revise", subject="새 안내", body="새 본문"))
        assert revised["communication_id"] == msg["communication_id"]
        assert (
            revised["content_version"] == 2 and revised["recipient_snapshot"] == "new@test.invalid"
        )
        revised = data(action(c, op, revised, "approve", content_version=2))
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET policy_version=policy_version+1 WHERE project_id=%s",
                (pid,),
            )
        assert (
            data(c.get(f"/api/communications/{msg['communication_id']}", headers=headers(op)))[
                "send_status"
            ]
            == "DRAFT"
        )


@pytest.mark.parametrize(
    ("kind", "initial_status", "current_status"),
    [("NOTICE", "SUBMITTED", "CANCELLED"), ("SELECTION", "APPROVED", "REJECTED")],
)
def test_ineligible_current_recipient_has_no_revise_action(
    isolated_db,  # noqa: F811
    kind,
    initial_status,
    current_status,
):
    op, _, _, _, pid, aid = fixture(isolated_db, status=initial_status)
    with client_for(isolated_db) as c:
        msg = data(generate(c, op, pid, aid, kind=kind), 201)
        msg = data(action(c, op, msg, "approve", content_version=1))
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET status=%s,version=version+1,cancel_reason='취소' "
                "WHERE application_id=%s",
                (current_status, aid),
            )
        msg = data(c.get(f"/api/communications/{msg['communication_id']}", headers=headers(op)))
        assert msg["send_status"] == "DRAFT"
        assert msg["allowed_actions"] == []
        response = action(c, op, msg, "revise", subject="수정 안내", body="수정 본문")
        assert response.status_code == 409
        assert response.json()["code"] == "INELIGIBLE_RECIPIENT"


def test_unknown_evidence_resolution_and_attempt_preserving_revision(isolated_db):  # noqa: F811
    op, _, _, _, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg, tid = attempt(isolated_db, queued(c, op, pid, aid))
        assert action(c, op, msg, "retry").status_code == 409
        assert action(c, op, msg, "revise", subject="수정", body="본문").status_code == 409
        fields = dict(
            attempt_id=str(tid),
            method="MANUAL_EVIDENCE",
            outcome="INCONCLUSIVE",
            evidence_ref="provider ticket 1",
        )
        msg = data(action(c, op, msg, "resolve", **fields))
        assert msg["send_status"] == "UNKNOWN"
        fields["outcome"] = "NOT_ACCEPTED"
        msg = data(action(c, op, msg, "resolve", **fields))
        assert msg["send_status"] == "FAILED" and len(msg["resolutions"]) == 2
        retry = data(action(c, op, msg, "retry"), 202)
        new = data(action(c, op, retry, "revise", subject="추가 안내", body="추가 본문"))
        assert new["communication_id"] != msg["communication_id"]
        assert new["supersedes_id"] == msg["communication_id"] and new["send_status"] == "DRAFT"
        old = data(c.get(f"/api/communications/{msg['communication_id']}", headers=headers(op)))
        assert old["superseded_at"] and old["subject"] == msg["subject"]
        assert old["send_status"] == "FAILED" and "retry" not in old["allowed_actions"]


def test_schema_private_and_attempt_content_immutable(isolated_db):  # noqa: F811
    op, _, _, _, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg, _ = attempt(isolated_db, queued(c, op, pid, aid), "FAILED")
        for assignment in (
            "body='changed'",
            "sender_snapshot='other@test.invalid'",
            "approved_at=now()",
            "context_snapshot_json='{}'",
        ):
            with pytest.raises(psycopg.errors.CheckViolation):
                with psycopg.connect(isolated_db) as conn:
                    conn.execute(
                        "UPDATE public.communications SET "
                        + assignment
                        + " WHERE communication_id=%s",
                        (msg["communication_id"],),
                    )
        for role in ("anon", "authenticated"):
            for table in ("communications", "communication_attempts", "communication_resolutions"):
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    with psycopg.connect(isolated_db) as conn:
                        conn.execute("SET LOCAL ROLE " + role)
                        conn.execute("SELECT * FROM public." + table)


def test_terminal_expiry_preserves_unknown_and_queue(isolated_db):  # noqa: F811
    from marketory.errors import DomainError
    from marketory.idempotency import expire
    from marketory.runtime import run_async

    op, _, _, _, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg = queued(c, op, pid, aid)
        with psycopg.connect(isolated_db) as conn:
            key = conn.execute(
                "SELECT idempotency_key FROM public.api_idempotency WHERE "
                "operation='communications.send'"
            ).fetchone()[0]

        async def expiration():
            async with await psycopg.AsyncConnection.connect(isolated_db) as conn:
                return await expire(conn, op, "communications.send", key, "2099-01-01")

        with pytest.raises(DomainError) as error:
            run_async(expiration())
        assert error.value.code == "RESOURCE_NOT_TERMINAL"
        with pytest.raises(psycopg.errors.CheckViolation):
            with psycopg.connect(isolated_db) as conn:
                conn.execute(
                    "UPDATE public.api_idempotency SET status='EXPIRED',"
                    "response_json=NULL,request_hash=NULL,resource_type=NULL,"
                    "resource_id=NULL,http_status=NULL,expired_at=now() "
                    "WHERE idempotency_key=%s",
                    (key,),
                )
        msg, tid = attempt(isolated_db, msg)
        with pytest.raises(DomainError):
            run_async(expiration())
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET status='COMPLETED' WHERE project_id=%s", (pid,)
            )
        msg = data(
            action(
                c,
                op,
                msg,
                "resolve",
                attempt_id=str(tid),
                method="MANUAL_EVIDENCE",
                outcome="ACCEPTED",
                evidence_ref="provider accepted record",
            )
        )
        assert msg["send_status"] == "SENT" and msg["sent_at"]
        assert run_async(expiration())


def test_eligibility_cross_project_stale_versions_and_event_end(isolated_db):  # noqa: F811
    op, _, _, _, pid, aid = fixture(isolated_db)
    _, _, _, _, _, foreign_aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        assert generate(c, op, pid, foreign_aid).status_code == 404
        assert generate(c, op, pid, aid, subject=" ").status_code == 422
        assert generate(c, op, pid, aid, recipient="evil@test.invalid").status_code == 422
        for kind, state in (
            ("SELECTION", "APPROVED"),
            ("WAITING", "WAITING"),
            ("REJECTION", "REJECTED"),
            ("CONFIRM", "CONFIRMED"),
            ("NEED_INFO", "NEED_INFO"),
        ):
            with psycopg.connect(isolated_db) as conn:
                conn.execute(
                    "UPDATE public.applications SET status='SUBMITTED',version=version+1 "
                    "WHERE application_id=%s",
                    (aid,),
                )
            assert generate(c, op, pid, aid, kind=kind).status_code == 409
            with psycopg.connect(isolated_db) as conn:
                conn.execute(
                    "UPDATE public.applications SET status=%s,version=version+1,"
                    "info_due_at=now()+interval '1 day',info_requests_json='[]' "
                    "WHERE application_id=%s",
                    (state, aid),
                )
            assert generate(c, op, pid, aid, kind=kind).status_code == 201
        targets = data(c.get(f"/api/projects/{pid}/communication-targets", headers=headers(op)))
        assert len(targets["items"]) == 1 and targets["items"][0]["has_booth"] is False
        msg = data(generate(c, op, pid, aid), 201)
        ready = data(action(c, op, msg, "approve", content_version=1))
        assert action(c, op, msg, "send").status_code == 409
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.projects SET status='COMPLETED' WHERE project_id=%s", (pid,)
            )
        assert action(c, op, ready, "send").status_code == 409
        assert action(c, op, ready, "revise", subject="수정", body="내용").status_code == 409
        assert generate(c, op, pid, aid).status_code == 409


def test_booth_change_invalidates_approval_and_attempted_retry(isolated_db):  # noqa: F811
    op, _, _, _, pid, aid = fixture(isolated_db, status="CONFIRMED")
    with client_for(isolated_db) as c:
        assert generate(c, op, pid, aid, kind="BOOTH").status_code == 409
        with psycopg.connect(isolated_db) as conn:
            bid = conn.execute(
                "INSERT INTO public.booths(project_id,booth_no) VALUES(%s,'A1') RETURNING booth_id",
                (pid,),
            ).fetchone()[0]
            assignment = conn.execute(
                "INSERT INTO public.booth_assignments(project_id,application_id,booth_id,source,"
                "assigned_by,confirmed,confirmed_at,input_application_version,input_booth_version,"
                "operation_id) VALUES(%s,%s,%s,'MANUAL',%s,true,now(),1,1,%s) "
                "RETURNING assignment_id",
                (pid, aid, bid, op, uuid4()),
            ).fetchone()[0]
        msg = data(generate(c, op, pid, aid, kind="BOOTH"), 201)
        msg = data(action(c, op, msg, "approve", content_version=1))
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.booth_assignments SET version=version+1 WHERE assignment_id=%s",
                (assignment,),
            )
        msg = data(c.get(f"/api/communications/{msg['communication_id']}", headers=headers(op)))
        assert msg["send_status"] == "DRAFT" and msg["approved_version"] is None
        msg = data(action(c, op, msg, "revise", subject="배치 안내", body="A1 부스"))
        msg = data(action(c, op, msg, "approve", content_version=2))
        msg = data(action(c, op, msg, "send"), 202)
        msg, _ = attempt(isolated_db, msg, "FAILED")
        msg = data(action(c, op, msg, "retry"), 202)
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.booth_assignments SET released_at=now(),released_by=%s,"
                "release_reason='해제',version=version+1 WHERE assignment_id=%s",
                (op, assignment),
            )
        failed = data(c.get(f"/api/communications/{msg['communication_id']}", headers=headers(op)))
        assert failed["send_status"] == "FAILED" and failed["failure_reason"] == "CONTEXT_CHANGED"
        assert failed["approved_version"] == 2 and failed["approved_at"] == msg["approved_at"]
        assert failed["allowed_actions"] == []
        assert action(c, op, failed, "retry").status_code == 409


def test_concurrent_send_one_queue_transition_and_resolution_validation(isolated_db):  # noqa: F811
    from concurrent.futures import ThreadPoolExecutor

    op, _, _, _, pid, aid = fixture(isolated_db)
    with client_for(isolated_db) as c:
        msg = data(generate(c, op, pid, aid), 201)
        msg = data(action(c, op, msg, "approve", content_version=1))
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: action(c, op, msg, "send"), range(2)))
        assert sorted(r.status_code for r in results) == [202, 409]
        queued_msg = next(r.json()["data"] for r in results if r.status_code == 202)
        with psycopg.connect(isolated_db) as conn:
            assert (
                conn.execute("SELECT count(*) FROM public.communication_attempts").fetchone()[0]
                == 0
            )
            assert (
                conn.execute(
                    "SELECT count(*) FROM public.audit_logs WHERE action='COMMUNICATIONS.SEND'"
                ).fetchone()[0]
                == 1
            )
        msg, tid = attempt(isolated_db, queued_msg)
        fields = dict(attempt_id=str(tid), outcome="ACCEPTED", evidence_ref="provider log")
        assert action(c, op, msg, "resolve", method="PROVIDER_QUERY", **fields).status_code == 422
        fields["attempt_id"] = str(uuid4())
        assert action(c, op, msg, "resolve", method="MANUAL_EVIDENCE", **fields).status_code == 409
