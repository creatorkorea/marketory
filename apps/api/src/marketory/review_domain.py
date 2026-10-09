"""Project-scoped staff authorization and deliberately narrow review projections."""

from datetime import datetime, timezone

from fastapi.encoders import jsonable_encoder
from psycopg.rows import dict_row

from marketory.application_domain import CONTENT_FIELDS, application_audit, before_event_end
from marketory.errors import DomainError
from marketory.permissions import active_user, one


async def review_project(conn, actor_id, project_id, action="read"):
    user = await active_user(conn, actor_id)
    project = await one(
        conn,
        "SELECT * FROM public.projects WHERE project_id=%s AND deleted_at IS NULL "
        + ("FOR SHARE" if action in {"read", "summary"} else "FOR UPDATE"),
        (project_id,),
    )
    if not project:
        raise DomainError(404, "NOT_FOUND", "마켓을 찾을 수 없습니다.")
    if user["global_role"] == "PLATFORM_ADMIN":
        return project, "OPERATOR"
    member = await one(
        conn,
        "SELECT role FROM public.project_members WHERE project_id=%s AND user_id=%s "
        "AND active FOR SHARE",
        (project_id, actor_id),
    )
    if user["account_role"] != "STAFF" or not member:
        raise DomainError(404, "NOT_FOUND", "마켓을 찾을 수 없습니다.")
    allowed = {"OPERATOR"} if action == "operate" else {"OPERATOR", "REVIEWER"}
    if action == "summary":
        allowed.add("VIEWER")
    if member["role"] not in allowed:
        raise DomainError(403, "FORBIDDEN", "이 작업에 필요한 권한이 없습니다.")
    return project, member["role"]


async def require_review(conn, actor_id, application_id, action="read"):
    await active_user(conn, actor_id)
    found = await one(
        conn,
        "SELECT project_id FROM public.applications WHERE application_id=%s "
        "AND deleted_at IS NULL AND status<>'DRAFT'",
        (application_id,),
    )
    if not found:
        raise DomainError(404, "NOT_FOUND", "심사할 신청을 찾을 수 없습니다.")
    project, role = await review_project(conn, actor_id, found["project_id"], action)
    app = await one(
        conn,
        "SELECT * FROM public.applications WHERE application_id=%s AND deleted_at IS NULL "
        "AND status<>'DRAFT' " + ("FOR SHARE" if action == "read" else "FOR UPDATE"),
        (application_id,),
    )
    if not app:
        raise DomainError(404, "NOT_FOUND", "심사할 신청을 찾을 수 없습니다.")
    return app, project, role


def review_open(project):
    before_event_end(project)
    if project["status"] not in {"RECRUITING", "REVIEWING"}:
        raise DomainError(409, "PROJECT_CLOSED", "심사 가능한 마켓 상태가 아닙니다.")


def valid_deadline(deadline, project, previous=None):
    if not datetime.now(timezone.utc) < deadline < project["event_end_at"]:
        raise DomainError(422, "INVALID_DEADLINE", "기한은 현재 이후, 행사 종료 이전이어야 합니다.")
    if previous is not None and deadline <= previous:
        raise DomainError(422, "INVALID_DEADLINE", "기존 기한보다 늦은 시각을 입력해 주세요.")


async def capacity(conn, project):
    occupied = await one(
        conn,
        "SELECT count(*) AS n FROM public.applications WHERE project_id=%s "
        "AND deleted_at IS NULL AND status IN ('APPROVED','CONFIRMED')",
        (project["project_id"],),
    )
    return {"occupied": occupied["n"], "target": project["target_team_count"]}


async def record_notice_draft(conn, actor, app, kind, body):
    # Audit snapshots only: these records are never a delivery queue.
    await application_audit(
        conn, actor, app, "REVIEW.NOTICE_DRAFT", None, {"kind": kind, "body": body}, None
    )


async def review_data(conn, actor_id, app, project, role):
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT attachment_id,file_type,original_name,mime_type,size_bytes "
            "FROM public.attachments WHERE application_id=%s AND deleted_at IS NULL "
            + ("AND file_type='PRODUCT_IMAGE' " if role == "REVIEWER" else "")
            + "ORDER BY created_at,attachment_id",
            (app["application_id"],),
        )
        attachments = await cur.fetchall()
        await cur.execute(
            "SELECT history_id,from_status,to_status,reason,created_at "
            "FROM public.application_status_history WHERE application_id=%s "
            "ORDER BY created_at,history_id",
            (app["application_id"],),
        )
        history = await cur.fetchall()
        await cur.execute(
            "SELECT audit_id AS note_id,after_json->>'body' AS body,created_at,"
            "actor_user_id AS author_id FROM public.audit_logs WHERE project_id=%s "
            "AND entity_type='application' AND entity_id=%s AND action='REVIEW.NOTE' "
            "ORDER BY created_at,audit_id",
            (app["project_id"], app["application_id"]),
        )
        notes = await cur.fetchall()
        notices = []
        if role == "OPERATOR":
            await cur.execute(
                "SELECT after_json->>'kind' AS kind,after_json->>'body' AS body,created_at "
                "FROM public.audit_logs WHERE project_id=%s AND entity_type='application' "
                "AND entity_id=%s AND action='REVIEW.NOTICE_DRAFT' ORDER BY created_at,audit_id",
                (app["project_id"], app["application_id"]),
            )
            notices = await cur.fetchall()
    snapshot = app.get("seller_snapshot_json") or {}
    seller = {k: snapshot.get(k) for k in ("shop_name", "owner_name", "phone")}
    seller["email"] = app.get("notification_email")
    if role == "REVIEWER":
        seller["phone"] = "***" if seller["phone"] else None
        seller["email"] = "***" if seller["email"] else None
    occupied = await capacity(conn, project)
    actions = []
    try:
        before_event_end(project)
        actions.append("note")
        if role == "OPERATOR":
            if app["status"] == "APPROVED":
                actions.append("extend_confirmation")
                due = app.get("confirm_due_at")
                if due and datetime.now(timezone.utc) < due < project["event_end_at"]:
                    actions.append("confirm")
            review_open(project)
            if app["status"] == "SUBMITTED":
                actions.append("start_review")
            if app["status"] in {"SUBMITTED", "REVIEWING"}:
                actions.append("request_info")
            if app["status"] == "NEED_INFO":
                actions.append("extend_info")
            if app["status"] in {"REVIEWING", "WAITING"}:
                if occupied["occupied"] < occupied["target"]:
                    actions.append("promote" if app["status"] == "WAITING" else "approve")
                actions.append("reject")
                if app["status"] == "REVIEWING":
                    actions.append("wait")
    except DomainError:
        pass
    fields = (
        "application_id",
        "project_id",
        "status",
        *sorted(CONTENT_FIELDS),
        "version",
        "revision_no",
        "submitted_at",
        "last_submitted_at",
        "confirmed_at",
        "info_requests_json",
        "info_due_at",
        "confirm_due_at",
        "waiting_rank",
        "created_at",
        "updated_at",
    )
    data = {
        **{k: app.get(k) for k in fields},
        "project": {
            k: project[k]
            for k in (
                "project_id",
                "name",
                "status",
                "event_end_at",
                "target_team_count",
                "policy_json",
            )
        },
        "seller": seller,
        "attachments": attachments,
        "notes": notes,
        "history": history,
        "allowed_actions": actions,
        "role": role,
        "capacity": occupied,
    }
    if role == "OPERATOR":
        data["notice_drafts"] = notices
    return jsonable_encoder(data)
