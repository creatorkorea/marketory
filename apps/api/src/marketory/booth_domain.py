"""Minimal board projections and shared booth locking/compatibility rules."""

from datetime import datetime, timezone

from fastapi.encoders import jsonable_encoder
from psycopg.rows import dict_row

from marketory.errors import DomainError
from marketory.permissions import one

BOOTH_FIELDS = (
    "booth_id",
    "project_id",
    "booth_no",
    "zone",
    "electricity_available",
    "fire_allowed",
    "cold_storage_available",
    "vehicle_access",
    "table_capacity",
    "note",
    "status",
    "version",
)
APP_FIELDS = (
    "application_id",
    "version",
    "product_name",
    "category",
    "electricity_required",
    "fire_required",
    "cold_storage_required",
    "vehicle_entry_required",
    "table_count",
)
ASSIGNMENT_FIELDS = (
    "assignment_id",
    "application_id",
    "booth_id",
    "confirmed",
    "version",
    "input_application_version",
    "input_booth_version",
    "reason",
    "assigned_at",
    "confirmed_at",
    "released_at",
    "release_reason",
)


async def rows(conn, query, params=()):
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(query, params)
        return await cur.fetchall()


def project_fields(row, fields):
    return {key: row[key] for key in fields}


def conflicts(project, app, booth):
    result = []
    if booth["status"] != "AVAILABLE":
        result.append("사용 중지된 부스입니다.")
    for required, available, label in (
        ("electricity_required", "electricity_available", "전기"),
        ("fire_required", "fire_allowed", "화기"),
        ("cold_storage_required", "cold_storage_available", "냉장"),
        ("vehicle_entry_required", "vehicle_access", "차량"),
    ):
        if app[required] and not booth[available]:
            result.append(f"{label} 조건을 충족하지 않습니다.")
    if app["table_count"] > 0 and (
        booth["table_capacity"] is None or booth["table_capacity"] < app["table_count"]
    ):
        result.append("테이블 수용량이 부족하거나 확인되지 않았습니다.")
    if app["category"] not in project["policy_json"].get("allowed_categories", []):
        result.append("마켓 허용 품목이 아닙니다.")
    return result


async def board_data(conn, project, role):
    pid = project["project_id"]
    booths = await rows(
        conn, "SELECT * FROM public.booths WHERE project_id=%s ORDER BY booth_no", (pid,)
    )
    apps = await rows(
        conn,
        "SELECT * FROM public.applications WHERE project_id=%s "
        "AND status='CONFIRMED' AND deleted_at IS NULL ORDER BY application_id",
        (pid,),
    )
    current = await rows(
        conn,
        "SELECT * FROM public.booth_assignments WHERE project_id=%s "
        "AND released_at IS NULL ORDER BY assignment_id",
        (pid,),
    )
    history = await rows(
        conn,
        "SELECT * FROM public.booth_assignments WHERE project_id=%s "
        "AND released_at IS NOT NULL ORDER BY released_at DESC,assignment_id LIMIT 100",
        (pid,),
    )
    active = [r for r in current if r["confirmed"]]
    occupied = {r["booth_id"]: r["application_id"] for r in active}
    app_by_id = {a["application_id"]: a for a in apps}
    booth_by_id = {b["booth_id"]: b for b in booths}
    candidates = []
    for app in apps:
        for booth in booths:
            issues = conflicts(project, app, booth)
            warnings = []
            if occupied.get(booth["booth_id"]) not in (None, app["application_id"]):
                warnings.append("다른 셀러가 사용 중입니다. 함께 이동하는 배치가 필요합니다.")
            if booth["zone"] and any(
                row["application_id"] != app["application_id"]
                and app_by_id.get(row["application_id"], {}).get("category") == app["category"]
                and booth_by_id[row["booth_id"]]["zone"] == booth["zone"]
                for row in active
            ):
                warnings.append("같은 구역에 동일 품목 셀러가 있습니다.")
            candidates.append(
                dict(
                    application_id=app["application_id"],
                    booth_id=booth["booth_id"],
                    compatible=not issues,
                    conflicts=issues,
                    warnings=warnings,
                )
            )
    return jsonable_encoder(
        dict(
            project=project_fields(
                project, ("project_id", "name", "status", "event_end_at", "version")
            ),
            role=role,
            can_manage=(
                role == "OPERATOR"
                and project["status"] != "COMPLETED"
                and datetime.now(timezone.utc) < project["event_end_at"]
            ),
            booths=[project_fields(b, BOOTH_FIELDS) for b in booths],
            applications=[
                dict(
                    **project_fields(a, APP_FIELDS),
                    shop_name=(a["seller_snapshot_json"] or {}).get("shop_name", ""),
                )
                for a in apps
            ],
            assignments=[project_fields(a, ASSIGNMENT_FIELDS) for a in active],
            drafts=[project_fields(a, ASSIGNMENT_FIELDS) for a in current if not a["confirmed"]],
            history=[project_fields(a, ASSIGNMENT_FIELDS) for a in history],
            candidates=candidates,
            unassigned_count=len(apps)
            - len({a["application_id"] for a in active} & set(app_by_id)),
        )
    )


async def lock_board(conn, pid):
    # Project lock is already held. Every mutation observes the same global lock order.
    apps = await rows(
        conn,
        "SELECT * FROM public.applications WHERE project_id=%s "
        "AND deleted_at IS NULL ORDER BY application_id FOR UPDATE",
        (pid,),
    )
    booths = await rows(
        conn, "SELECT * FROM public.booths WHERE project_id=%s ORDER BY booth_id FOR UPDATE", (pid,)
    )
    assignments = await rows(
        conn,
        "SELECT * FROM public.booth_assignments WHERE project_id=%s "
        "AND released_at IS NULL ORDER BY assignment_id FOR UPDATE",
        (pid,),
    )
    return {a["application_id"]: a for a in apps}, {b["booth_id"]: b for b in booths}, assignments


async def release_rows(conn, ids, actor, reason):
    if ids:
        await conn.execute(
            "UPDATE public.booth_assignments SET released_at=now(),released_by=%s,"
            "release_reason=%s,version=version+1 WHERE assignment_id=ANY(%s)",
            (actor, reason, ids),
        )


async def increment_project(conn, pid):
    return await one(
        conn,
        "UPDATE public.projects SET version=version+1,updated_at=now() "
        "WHERE project_id=%s RETURNING *",
        (pid,),
    )


async def release_for_cancellation(conn, app, actor_id, reason):
    pending = await rows(
        conn,
        "SELECT * FROM public.booth_assignments WHERE application_id=%s AND released_at IS NULL",
        (app["application_id"],),
    )
    if not pending:
        return False
    await rows(
        conn,
        "SELECT booth_id FROM public.booths WHERE booth_id=ANY(%s) ORDER BY booth_id FOR UPDATE",
        ([r["booth_id"] for r in pending],),
    )
    pending = await rows(
        conn,
        "SELECT * FROM public.booth_assignments WHERE application_id=%s "
        "AND released_at IS NULL ORDER BY assignment_id FOR UPDATE",
        (app["application_id"],),
    )
    await release_rows(conn, [r["assignment_id"] for r in pending], actor_id, reason)
    await increment_project(conn, app["project_id"])
    return True


def require_target(apps, aid, expected=None):
    app = apps.get(aid)
    if not app:
        raise DomainError(404, "NOT_FOUND", "신청을 찾을 수 없습니다.")
    if app["status"] != "CONFIRMED":
        raise DomainError(409, "APPLICATION_NOT_CONFIRMED", "참가확정된 신청만 배치할 수 있습니다.")
    if expected is not None and app["version"] != expected:
        raise DomainError(409, "VERSION_CONFLICT", "신청 내용이 변경되었습니다.")
    return app


def require_booth(booths, bid):
    if bid not in booths:
        raise DomainError(404, "NOT_FOUND", "부스를 찾을 수 없습니다.")
    return booths[bid]


def compatible(project, app, booth):
    issues = conflicts(project, app, booth)
    if issues:
        raise DomainError(409, "BOOTH_CONFLICT", " ".join(issues))
