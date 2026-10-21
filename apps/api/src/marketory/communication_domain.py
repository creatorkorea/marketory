"""Communication access, immutable context and public projections shared with the worker."""

from fastapi.encoders import jsonable_encoder

from marketory.booth_domain import rows
from marketory.errors import DomainError
from marketory.permissions import one, require_project
from marketory.projects import before_end


async def require_communication(conn, actor, cid):
    reference = await one(
        conn,
        "SELECT project_id,application_id FROM public.communications WHERE communication_id=%s",
        (cid,),
    )
    if not reference:
        raise DomainError(404, "NOT_FOUND", "메시지를 찾을 수 없습니다.")
    project = await require_project(conn, actor, reference["project_id"], "operate")
    app = await one(
        conn,
        "SELECT * FROM public.applications WHERE application_id=%s FOR UPDATE",
        (reference["application_id"],),
    )
    message = await one(
        conn, "SELECT * FROM public.communications WHERE communication_id=%s FOR UPDATE", (cid,)
    )
    return message, app, project


async def communication_context(conn, app, project):
    booth = await one(
        conn,
        "SELECT assignment_id,version FROM public.booth_assignments "
        "WHERE application_id=%s AND confirmed AND released_at IS NULL",
        (app["application_id"],),
    )
    return jsonable_encoder(
        dict(
            application_version=app["version"],
            status=app["status"],
            notification_email=app["notification_email"],
            policy_version=project["policy_version"],
            booth_assignment_id=booth["assignment_id"] if booth else None,
            booth_assignment_version=booth["version"] if booth else None,
        )
    )


def eligible(kind, app, context):
    if app["deleted_at"] or not app["submitted_at"] or not app["notification_email"]:
        return False
    expected = dict(
        SELECTION="APPROVED",
        WAITING="WAITING",
        REJECTION="REJECTED",
        CONFIRM="CONFIRMED",
        BOOTH="CONFIRMED",
        NEED_INFO="NEED_INFO",
    )
    if kind == "NOTICE":
        return app["status"] not in ("DRAFT", "CANCELLED")
    return app["status"] == expected.get(kind) and (
        kind != "BOOTH" or context["booth_assignment_id"] is not None
    )


async def validate_context(conn, message, app, project):
    context = await communication_context(conn, app, project)
    if context != message["context_snapshot_json"] or not eligible(message["type"], app, context):
        raise DomainError(
            409, "CONTEXT_CHANGED", "신청 또는 운영 정보가 변경되었습니다. 초안을 수정해 주세요."
        )


async def communication_data(conn, message):
    result = {
        k: v
        for k, v in message.items()
        if k not in ("idempotency_key", "claim_token", "context_snapshot_json", "sender_snapshot")
        and not k.startswith("published_")
        and k != "withdrawn_at"
    }
    result["publication"] = (
        dict(
            subject=message["published_subject"],
            body=message["published_body"],
            content_version=message["published_content_version"],
            published_at=message["published_at"],
            withdrawn_at=message["withdrawn_at"],
        )
        if message["published_at"]
        else None
    )
    result["attempts"] = await rows(
        conn,
        "SELECT * FROM public.communication_attempts WHERE communication_id=%s ORDER BY attempt_no",
        (message["communication_id"],),
    )
    result["resolutions"] = await rows(
        conn,
        "SELECT * FROM public.communication_resolutions "
        "WHERE communication_id=%s ORDER BY resolved_at,resolution_id",
        (message["communication_id"],),
    )
    actions = []
    if message["published_at"] and not message["withdrawn_at"]:
        actions.append("unpublish")
    if not message["superseded_at"]:
        status = message["send_status"]
        if status == "UNKNOWN":
            actions.append("resolve")
        project = await one(
            conn, "SELECT * FROM public.projects WHERE project_id=%s", (message["project_id"],)
        )
        app = await one(
            conn,
            "SELECT * FROM public.applications WHERE application_id=%s",
            (message["application_id"],),
        )
        try:
            before_end(project)
        except DomainError:
            pass
        else:
            current_context = await communication_context(conn, app, project)
            if status in ("DRAFT", "READY", "QUEUED", "FAILED", "SENT") and eligible(
                message["type"], app, current_context
            ):
                actions.append("revise")
            try:
                await validate_context(conn, message, app, project)
            except DomainError:
                pass
            else:
                if status == "DRAFT":
                    actions.append("approve")
                if message["approved_version"] == message["content_version"]:
                    if (
                        message["withdrawn_at"]
                        or message["published_content_version"] != message["content_version"]
                    ):
                        actions.append("publish")
                    if status == "READY":
                        actions.append("send")
                    if status == "FAILED" and message["failure_reason"] != "PROVIDER_KEY_EXPIRED":
                        actions.append("retry")
    result["allowed_actions"] = actions
    return jsonable_encoder(result)
