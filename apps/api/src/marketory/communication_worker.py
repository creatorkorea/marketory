"""Bounded queue claims with network calls outside transactions and fenced completion."""

import asyncio
from uuid import uuid4

from psycopg.types.json import Jsonb

from marketory.booth_domain import rows
from marketory.communication_domain import validate_context
from marketory.db import transaction
from marketory.email_provider import DeliveryResult, ResendProvider
from marketory.errors import DomainError
from marketory.permissions import active_user, one, require_project
from marketory.projects import before_end


async def _lock(conn, ref):
    project = await one(
        conn,
        "SELECT * FROM public.projects WHERE project_id=%s FOR UPDATE SKIP LOCKED",
        (ref["project_id"],),
    )
    if not project:
        return None
    app = await one(
        conn,
        "SELECT * FROM public.applications WHERE application_id=%s FOR UPDATE",
        (ref["application_id"],),
    )
    message = await one(
        conn,
        "SELECT * FROM public.communications WHERE communication_id=%s FOR UPDATE",
        (ref["communication_id"],),
    )
    return project, app, message


async def _audit(conn, message, status, reason):
    await conn.execute(
        "INSERT INTO public.audit_logs(project_id,actor_user_id,action,entity_type,entity_id,"
        "before_json,after_json,reason) VALUES(%s,NULL,'COMMUNICATIONS.WORKER','communication',"
        "%s,%s,%s,%s)",
        (
            message["project_id"],
            message["communication_id"],
            Jsonb({"send_status": message["send_status"]}),
            Jsonb({"send_status": status}),
            reason,
        ),
    )


async def _reject(conn, message, reason):
    await conn.execute(
        "UPDATE public.communications SET send_status='FAILED',failure_reason=%s,queued_at=NULL,"
        "queued_by=NULL,version=version+1,updated_at=now() WHERE communication_id=%s",
        (reason, message["communication_id"]),
    )
    await _audit(conn, message, "FAILED", reason)


async def _claim(settings):
    async with transaction(settings) as conn:
        candidates = await rows(
            conn,
            "SELECT communication_id,project_id,application_id,queued_by "
            "FROM public.communications WHERE send_status='QUEUED' "
            "ORDER BY queued_at,communication_id LIMIT 20",
        )
    for ref in candidates:
        async with transaction(settings) as conn:
            # Actor -> project -> application -> communication matches API lock order.
            actor_error = None
            try:
                await active_user(conn, ref["queued_by"])
            except DomainError as exc:
                actor_error = exc.code
            locked = await _lock(conn, ref)
            if not locked:
                continue
            project, app, message = locked
            if message["send_status"] != "QUEUED":
                continue
            # A revised/requeued candidate might carry a different actor. Revisit
            # next poll instead of locking a new actor after the project lock.
            if message["queued_by"] != ref["queued_by"]:
                continue
            try:
                if actor_error:
                    raise DomainError(403, actor_error, "Queue actor unavailable")
                await require_project(conn, message["queued_by"], message["project_id"], "operate")
                before_end(project)
                await validate_context(conn, message, app, project)
                if (
                    message["superseded_at"]
                    or message["approved_version"] != message["content_version"]
                ):
                    raise DomainError(409, "APPROVAL_INVALID", "Approval unavailable")
            except DomainError as exc:
                await _reject(conn, message, exc.code)
                return True, None
            history = await one(
                conn,
                "SELECT count(*) AS count,coalesce(max(attempt_no),0) AS last,"
                "min(started_at) <= now()-interval '23 hours' AS expired "
                "FROM public.communication_attempts WHERE communication_id=%s",
                (message["communication_id"],),
            )
            if history["expired"]:
                await _reject(conn, message, "PROVIDER_KEY_EXPIRED")
                return True, None
            if history["count"] and not message["sender_snapshot"]:
                await _reject(conn, message, "SENDER_SNAPSHOT_MISSING")
                return True, None
            token, attempt_id = uuid4(), uuid4()
            # Must initialize sender before the first attempt activates immutability.
            claimed = await one(
                conn,
                "UPDATE public.communications SET send_status='SENDING',claimed_at=now(),"
                "claim_token=%s,sender_snapshot=coalesce(sender_snapshot,%s),failure_reason=NULL,"
                "version=version+1,updated_at=now() WHERE communication_id=%s RETURNING *",
                (token, settings.email_from, message["communication_id"]),
            )
            await conn.execute(
                "INSERT INTO public.communication_attempts(attempt_id,communication_id,"
                "attempt_no,status) VALUES(%s,%s,%s,'SENDING')",
                (attempt_id, message["communication_id"], history["last"] + 1),
            )
            await _audit(conn, message, "SENDING", "Queue claimed")
            return True, (claimed, attempt_id)
    return False, None


async def _complete(settings, message, attempt_id, result):
    async with transaction(settings) as conn:
        # Completion must wait for the project lock; skipping would strand a live
        # accepted result until stale recovery. Lock order remains the same.
        await one(
            conn,
            "SELECT project_id FROM public.projects WHERE project_id=%s FOR UPDATE",
            (message["project_id"],),
        )
        locked = await _lock(conn, message)
        current = locked[2]
        if current["send_status"] != "SENDING" or current["claim_token"] != message["claim_token"]:
            return False
        await conn.execute(
            "UPDATE public.communication_attempts SET status=%s,provider_message_id=%s,"
            "error_code=%s,completed_at=now() WHERE attempt_id=%s AND status='SENDING'",
            (result.status, result.provider_message_id, result.error_code, attempt_id),
        )
        await conn.execute(
            "UPDATE public.communications SET send_status=%s,failure_reason=%s,"
            "sent_at=CASE WHEN %s='SENT' THEN now() ELSE sent_at END,"
            "claim_token=NULL,claimed_at=NULL,queued_by=NULL,queued_at=NULL,"
            "version=version+1,updated_at=now() WHERE communication_id=%s",
            (result.status, result.error_code, result.status, message["communication_id"]),
        )
        await _audit(conn, current, result.status, result.error_code or "Provider accepted")
        return True


async def process_one(settings, provider=None) -> bool:
    key = settings.resend_api_key
    if not settings.email_delivery_enabled or not key or not key.get_secret_value().strip():
        return False
    handled, claim = await _claim(settings)
    if claim is None:
        return handled
    message, attempt_id = claim
    try:
        result = await asyncio.wait_for(
            (provider or ResendProvider(settings)).send(message),
            timeout=settings.email_timeout_seconds,
        )
        if not isinstance(result, DeliveryResult) or result.status not in {
            "SENT",
            "FAILED",
            "UNKNOWN",
        }:
            result = DeliveryResult("UNKNOWN", error_code="PROVIDER_INVALID_RESPONSE")
        elif result.status == "SENT" and not result.provider_message_id:
            result = DeliveryResult("UNKNOWN", error_code="PROVIDER_INVALID_RESPONSE")
    except Exception:
        result = DeliveryResult("UNKNOWN", error_code="PROVIDER_CALL_ERROR")
    await _complete(settings, message, attempt_id, result)
    return True


async def recover_stale(settings) -> int:
    recovered = 0
    async with transaction(settings) as conn:
        candidates = await rows(
            conn,
            "SELECT communication_id,project_id,application_id "
            "FROM public.communications WHERE send_status='SENDING' AND "
            "claimed_at <= now()-(%s * interval '1 second') "
            "ORDER BY claimed_at,communication_id LIMIT 100",
            (settings.email_claim_timeout_seconds,),
        )
    for ref in candidates:
        async with transaction(settings) as conn:
            locked = await _lock(conn, ref)
            if not locked:
                continue
            message = locked[2]
            stale = await one(
                conn,
                "SELECT send_status='SENDING' AND claimed_at <= "
                "now()-(%s * interval '1 second') AS stale FROM public.communications "
                "WHERE communication_id=%s",
                (settings.email_claim_timeout_seconds, message["communication_id"]),
            )
            if not stale["stale"]:
                continue
            await conn.execute(
                "UPDATE public.communication_attempts SET status='UNKNOWN',"
                "error_code='STALE_CLAIM',completed_at=now() WHERE communication_id=%s "
                "AND status='SENDING'",
                (message["communication_id"],),
            )
            await conn.execute(
                "UPDATE public.communications SET send_status='UNKNOWN',"
                "failure_reason='STALE_CLAIM',claim_token=NULL,claimed_at=NULL,"
                "queued_by=NULL,queued_at=NULL,version=version+1,updated_at=now() "
                "WHERE communication_id=%s",
                (message["communication_id"],),
            )
            await _audit(conn, message, "UNKNOWN", "STALE_CLAIM")
            recovered += 1
    return recovered
