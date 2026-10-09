"""Manual staff review; all state, audit and saved results commit together."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import AwareDatetime, Field, field_validator, model_validator

from marketory.application_domain import CONTENT_FIELDS, application_audit, before_event_end
from marketory.applications import status_history
from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute, get_row
from marketory.permissions import one
from marketory.projects import Strict, version_matches
from marketory.review_domain import (
    capacity,
    record_notice_draft,
    require_review,
    review_data,
    review_open,
    review_project,
    valid_deadline,
)


class ReviewReason(Strict):
    expected_version: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("사유를 입력해 주세요.")
        return value.strip()


class RequestInfo(ReviewReason):
    fields: list[str] = Field(min_length=1, max_length=12)
    info_due_at: AwareDatetime

    @field_validator("fields")
    @classmethod
    def requested_fields(cls, values):
        if len(set(values)) != len(values) or not set(values) <= (
            CONTENT_FIELDS | {"product_images", "business_document"}
        ):
            raise ValueError("보완 항목을 확인해 주세요.")
        return values


class ExtendInfo(ReviewReason):
    info_due_at: AwareDatetime


class ExtendConfirmation(ReviewReason):
    confirm_due_at: AwareDatetime


class ReviewDecision(ReviewReason):
    decision: Literal["APPROVED", "WAITING", "REJECTED"]
    confirm_due_at: AwareDatetime | None = None
    waiting_rank: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def decision_fields(self):
        if self.decision == "APPROVED":
            valid = self.confirm_due_at is not None and "waiting_rank" not in self.model_fields_set
        elif self.decision == "WAITING":
            valid = self.waiting_rank is not None and "confirm_due_at" not in self.model_fields_set
        else:
            valid = not {"confirm_due_at", "waiting_rank"} & self.model_fields_set
        if not valid:
            raise ValueError("결정에 필요한 기한 또는 대기 순위만 입력해 주세요.")
        return self


class ReviewNote(Strict):
    expected_version: int = Field(gt=0)
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("메모를 입력해 주세요.")
        return value.strip()


def require_state(app, states):
    if app["status"] not in states:
        raise DomainError(409, "INVALID_TRANSITION", "현재 신청 상태에서는 처리할 수 없습니다.")


async def update_application(conn, aid, **values):
    await conn.execute(
        "UPDATE public.applications SET "
        + ",".join(f"{key}=%s" for key in values)
        + ("," if values else "")
        + "version=version+1,updated_at=now() WHERE application_id=%s",
        (*values.values(), aid),
    )


def review_router(settings, identity):
    router = APIRouter()
    Actor = Annotated[object, Depends(identity)]
    Key = Annotated[UUID, Header(alias="Idempotency-Key")]

    @router.get("/projects/{project_id}/application-summary", operation_id="review_summary")
    async def summary(project_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            project, _ = await review_project(conn, actor.user_id, project_id, "summary")
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    "SELECT status,count(*) AS n FROM public.applications WHERE project_id=%s "
                    "AND deleted_at IS NULL AND status<>'DRAFT' GROUP BY status",
                    (project_id,),
                )
                counts = {row["status"]: row["n"] for row in await cur.fetchall()}
            return {"data": {"counts": counts, **await capacity(conn, project)}}

    @router.get("/projects/{project_id}/applications", operation_id="review_applications")
    async def listing(
        project_id: UUID,
        actor: Actor,
        status: Literal[
            "SUBMITTED",
            "NEED_INFO",
            "REVIEWING",
            "APPROVED",
            "WAITING",
            "REJECTED",
            "CONFIRMED",
            "CANCELLED",
        ]
        | None = None,
        category: str | None = Query(default=None, max_length=50),
        limit: int = Query(default=20, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
    ):
        async with transaction(settings) as conn:
            project, role = await review_project(conn, actor.user_id, project_id)
            where = "project_id=%s AND deleted_at IS NULL AND status<>'DRAFT'"
            params = [project_id]
            for field, value in (("status", status), ("category", category)):
                if value is not None:
                    where += f" AND {field}=%s"
                    params.append(value)
            total = await one(
                conn, "SELECT count(*) AS n FROM public.applications WHERE " + where, params
            )
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    "SELECT application_id,status,version,product_name,category,"
                    "seller_snapshot_json->>'shop_name' AS shop_name,submitted_at,confirm_due_at,"
                    "info_due_at FROM public.applications WHERE "
                    + where
                    + " ORDER BY "
                    + ("waiting_rank," if status == "WAITING" else "")
                    + "submitted_at,application_id LIMIT %s OFFSET %s",
                    (*params, limit, offset),
                )
                items = await cur.fetchall()
            return {
                "data": {
                    "items": items,
                    "total": total["n"],
                    "limit": limit,
                    "offset": offset,
                    "project": {"project_id": project_id, "name": project["name"]},
                    "role": role,
                }
            }

    @router.get("/review/applications/{application_id}", operation_id="review_application_detail")
    async def detail(application_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            app, project, role = await require_review(conn, actor.user_id, application_id)
            return {"data": await review_data(conn, actor.user_id, app, project, role)}

    async def change(application_id, body, actor, key, operation, suffix, mutate_fn):
        async with transaction(settings) as conn:
            app = project = role = None

            async def authorize():
                nonlocal app, project, role
                app, project, role = await require_review(
                    conn,
                    actor.user_id,
                    application_id,
                    "note" if operation == "reviews.note" else "operate",
                )
                saved = await get_row(conn, actor.user_id, operation, key)
                if (
                    saved
                    and saved["resource_type"] == "review_application_operator"
                    and role != "OPERATOR"
                ):
                    raise DomainError(403, "FORBIDDEN", "이 요청 결과를 조회할 권한이 없습니다.")

            async def mutate():
                version_matches(app, body.expected_version)
                await mutate_fn(conn, app, project)
                after = await one(
                    conn,
                    "SELECT * FROM public.applications WHERE application_id=%s",
                    (application_id,),
                )
                await application_audit(
                    conn,
                    actor.user_id,
                    app,
                    operation.upper(),
                    app,
                    after,
                    getattr(body, "reason", None),
                )
                return Change(
                    await review_data(conn, actor.user_id, after, project, role),
                    resource_type="review_application_" + role.lower(),
                    resource_id=application_id,
                )

            result = await execute(
                conn,
                actor.user_id,
                operation,
                key,
                "POST",
                f"/api/applications/{application_id}/{suffix}",
                "review_application_reviewer"
                if operation == "reviews.note"
                else "review_application_operator",
                application_id,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.post("/applications/{application_id}/start-review", operation_id="start_review")
    async def start(application_id: UUID, body: ReviewReason, actor: Actor, idempotency_key: Key):
        async def mutate(conn, app, project):
            review_open(project)
            require_state(app, {"SUBMITTED"})
            await update_application(conn, application_id, status="REVIEWING")
            await status_history(conn, app, actor.user_id, "REVIEWING", body.reason)

        return await change(
            application_id, body, actor, idempotency_key, "reviews.start", "start-review", mutate
        )

    @router.post("/applications/{application_id}/request-info", operation_id="request_review_info")
    async def request_info(
        application_id: UUID, body: RequestInfo, actor: Actor, idempotency_key: Key
    ):
        async def mutate(conn, app, project):
            review_open(project)
            require_state(app, {"SUBMITTED", "REVIEWING"})
            valid_deadline(body.info_due_at, project)
            await update_application(
                conn,
                application_id,
                status="NEED_INFO",
                info_due_at=body.info_due_at,
                info_requests_json=Jsonb(
                    [{"field": f, "reason": body.reason} for f in body.fields]
                ),
            )
            await status_history(conn, app, actor.user_id, "NEED_INFO", body.reason)
            await record_notice_draft(
                conn,
                actor.user_id,
                app,
                "REQUEST_INFO",
                f"보완 요청: {', '.join(body.fields)} / {body.reason} / "
                f"기한 {body.info_due_at.isoformat()}",
            )

        return await change(
            application_id,
            body,
            actor,
            idempotency_key,
            "reviews.request_info",
            "request-info",
            mutate,
        )

    @router.post("/applications/{application_id}/extend-info", operation_id="extend_review_info")
    async def extend_info(
        application_id: UUID, body: ExtendInfo, actor: Actor, idempotency_key: Key
    ):
        async def mutate(conn, app, project):
            review_open(project)
            require_state(app, {"NEED_INFO"})
            valid_deadline(body.info_due_at, project, app["info_due_at"])
            await update_application(conn, application_id, info_due_at=body.info_due_at)
            await status_history(conn, app, actor.user_id, "NEED_INFO", body.reason)
            await record_notice_draft(
                conn,
                actor.user_id,
                app,
                "EXTEND_INFO",
                f"보완 기한 변경: {body.info_due_at.isoformat()} / {body.reason}",
            )

        return await change(
            application_id,
            body,
            actor,
            idempotency_key,
            "reviews.extend_info",
            "extend-info",
            mutate,
        )

    @router.post("/applications/{application_id}/decision", operation_id="review_decision")
    async def decision(
        application_id: UUID, body: ReviewDecision, actor: Actor, idempotency_key: Key
    ):
        async def mutate(conn, app, project):
            review_open(project)
            require_state(
                app, {"REVIEWING", "WAITING"} if body.decision != "WAITING" else {"REVIEWING"}
            )
            if body.decision == "APPROVED":
                valid_deadline(body.confirm_due_at, project)
                occupied = await capacity(conn, project)
                if occupied["occupied"] >= occupied["target"]:
                    raise DomainError(409, "CAPACITY_FULL", "선정 정원이 가득 찼습니다.")
            await update_application(
                conn,
                application_id,
                status=body.decision,
                confirm_due_at=body.confirm_due_at,
                waiting_rank=body.waiting_rank,
            )
            await status_history(conn, app, actor.user_id, body.decision, body.reason)
            deadline = (
                f" / 참가 확정 기한 {body.confirm_due_at.isoformat()}"
                if body.confirm_due_at
                else ""
            )
            await record_notice_draft(
                conn, actor.user_id, app, body.decision, f"선정 결과: {body.decision}{deadline}"
            )

        return await change(
            application_id, body, actor, idempotency_key, "reviews.decision", "decision", mutate
        )

    @router.post(
        "/applications/{application_id}/extend-confirmation",
        operation_id="extend_review_confirmation",
    )
    async def extend_confirmation(
        application_id: UUID, body: ExtendConfirmation, actor: Actor, idempotency_key: Key
    ):
        async def mutate(conn, app, project):
            before_event_end(project)
            require_state(app, {"APPROVED"})
            valid_deadline(body.confirm_due_at, project, app["confirm_due_at"])
            await update_application(conn, application_id, confirm_due_at=body.confirm_due_at)
            await status_history(conn, app, actor.user_id, "APPROVED", body.reason)
            await record_notice_draft(
                conn,
                actor.user_id,
                app,
                "EXTEND_CONFIRMATION",
                f"참가 확정 기한 변경: {body.confirm_due_at.isoformat()} / {body.reason}",
            )

        return await change(
            application_id,
            body,
            actor,
            idempotency_key,
            "reviews.extend_confirmation",
            "extend-confirmation",
            mutate,
        )

    @router.post("/applications/{application_id}/notes", operation_id="review_note")
    async def note(application_id: UUID, body: ReviewNote, actor: Actor, idempotency_key: Key):
        async def mutate(conn, app, project):
            before_event_end(project)
            await application_audit(
                conn, actor.user_id, app, "REVIEW.NOTE", None, {"body": body.body}, None
            )
            await update_application(conn, application_id)

        return await change(
            application_id, body, actor, idempotency_key, "reviews.note", "notes", mutate
        )

    return router
