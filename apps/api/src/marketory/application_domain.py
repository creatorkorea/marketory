"""Shared owner authorization, edit rules and safe application projection."""

from datetime import datetime, timezone

from fastapi.encoders import jsonable_encoder
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from marketory.errors import DomainError
from marketory.permissions import active_user, one

CONTENT_FIELDS = {
    "product_name",
    "product_desc",
    "price_range",
    "category",
    "electricity_required",
    "table_count",
    "fire_required",
    "cold_storage_required",
    "vehicle_entry_required",
    "request_note",
}
CANCEL_STATES = {"DRAFT", "SUBMITTED", "NEED_INFO", "REVIEWING", "APPROVED", "WAITING", "CONFIRMED"}
PUBLIC_PROJECT_FIELDS = (
    "project_id",
    "name",
    "venue",
    "event_date",
    "event_end_at",
    "recruit_start_at",
    "recruit_end_at",
    "target_team_count",
    "status",
    "policy_json",
    "booth_policy_json",
    "policy_version",
)
APPLICATION_FIELDS = (
    "application_id",
    "project_id",
    "seller_id",
    "status",
    *sorted(CONTENT_FIELDS),
    "submitted_at",
    "last_submitted_at",
    "confirmed_at",
    "cancel_reason",
    "revision_no",
    "version",
    "seller_snapshot_json",
    "policy_version",
    "consent_json",
    "info_requests_json",
    "info_due_at",
    "confirm_due_at",
    "notification_email",
    "notification_email_verified_at",
    "created_at",
    "updated_at",
)


async def require_application(conn, actor_id, application_id, action="read"):
    await active_user(conn, actor_id)
    found = await one(
        conn,
        "SELECT a.project_id FROM public.applications a "
        "JOIN public.sellers s USING(seller_id) WHERE a.application_id=%s AND s.user_id=%s "
        "AND a.deleted_at IS NULL",
        (application_id, actor_id),
    )
    if not found:
        raise DomainError(404, "NOT_FOUND", "신청을 찾을 수 없습니다.")
    lock = "FOR SHARE" if action == "read" else "FOR UPDATE"
    project = await one(
        conn, "SELECT * FROM public.projects WHERE project_id=%s " + lock, (found["project_id"],)
    )
    app = await one(
        conn,
        "SELECT * FROM public.applications WHERE application_id=%s AND deleted_at IS NULL " + lock,
        (application_id,),
    )
    seller = (
        await one(
            conn,
            "SELECT * FROM public.sellers WHERE seller_id=%s AND user_id=%s FOR SHARE",
            (app["seller_id"], actor_id),
        )
        if app
        else None
    )
    if not project or not app or not seller:
        raise DomainError(404, "NOT_FOUND", "신청을 찾을 수 없습니다.")
    return app, project, seller


def before_event_end(project):
    if (
        project["deleted_at"] is not None
        or project["status"] == "COMPLETED"
        or datetime.now(timezone.utc) >= project["event_end_at"]
    ):
        raise DomainError(409, "EVENT_ENDED", "행사가 종료되어 변경할 수 없습니다.")


def recruiting(project):
    before_event_end(project)
    now = datetime.now(timezone.utc)
    if project["status"] != "RECRUITING" or not (
        project["recruit_start_at"] <= now < project["recruit_end_at"]
    ):
        raise DomainError(409, "RECRUITMENT_CLOSED", "현재 모집 기간이 아닙니다.")


def editable_application(app, project, fields: set[str]):
    before_event_end(project)
    if app["status"] == "DRAFT":
        recruiting(project)
        return
    if app["status"] != "NEED_INFO":
        raise DomainError(
            409, "APPLICATION_NOT_EDITABLE", "현재 상태에서는 신청을 수정할 수 없습니다."
        )
    if project["status"] not in {"RECRUITING", "REVIEWING"}:
        raise DomainError(409, "PROJECT_CLOSED", "보완 가능한 마켓 상태가 아닙니다.")
    due = app.get("info_due_at")
    if not due or datetime.now(timezone.utc) >= due:
        raise DomainError(409, "INFO_DEADLINE_PASSED", "보완 기한이 지났습니다.")
    requested = {r.get("field") for r in app.get("info_requests_json") or []}
    if not requested or not fields.issubset(requested):
        raise DomainError(403, "FIELD_NOT_REQUESTED", "요청된 항목만 수정할 수 있습니다.")


async def application_data(conn, app, project, seller):
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT attachment_id,file_type,original_name,mime_type,size_bytes "
            "FROM public.attachments WHERE application_id=%s AND deleted_at IS NULL "
            "ORDER BY created_at,attachment_id",
            (app["application_id"],),
        )
        attachments = await cur.fetchall()
        await cur.execute(
            "SELECT upload_intent_id,expected_application_version AS application_version,"
            "expected_revision_no AS revision_no,original_name,field_code,expires_at "
            "FROM public.upload_intents WHERE application_id=%s AND status='ISSUED' "
            "ORDER BY created_at,upload_intent_id",
            (app["application_id"],),
        )
        pending_uploads = await cur.fetchall()
    actions = []
    try:
        editable_application(app, project, set())
        actions.extend(["update", "submit" if app["status"] == "DRAFT" else "resubmit"])
    except DomainError:
        pass
    for field in ("product_images", "business_document"):
        try:
            editable_application(app, project, {field})
            actions.extend(["upload", "detach"])
            break
        except DomainError:
            pass
    try:
        before_event_end(project)
        if app["status"] in CANCEL_STATES:
            actions.append("cancel")
    except DomainError:
        pass
    return jsonable_encoder(
        {
            **{k: app.get(k) for k in APPLICATION_FIELDS},
            "project": {k: project.get(k) for k in PUBLIC_PROJECT_FIELDS},
            "attachments": attachments,
            "pending_uploads": pending_uploads,
            "allowed_actions": actions,
        }
    )


async def application_audit(conn, actor_id, app, action, before, after, reason):
    await conn.execute(
        "INSERT INTO public.audit_logs(project_id,actor_user_id,action,entity_type,"
        "entity_id,before_json,after_json,reason) VALUES(%s,%s,%s,'application',%s,%s,%s,%s)",
        (
            app["project_id"],
            actor_id,
            action,
            app["application_id"],
            Jsonb(jsonable_encoder(before)),
            Jsonb(jsonable_encoder(after)),
            reason,
        ),
    )
