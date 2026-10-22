"""Approved market announcements; never enqueue email."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from pydantic import Field

from marketory.announcement_domain import announcement_data, require_announcement
from marketory.application_domain import require_application
from marketory.booth_domain import rows
from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute
from marketory.permissions import one, require_project
from marketory.projects import Strict, Text, before_end, version_matches

Audience = Literal["ALL_APPLICANTS", "CONFIRMED"]


class AnnouncementInput(Strict):
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=50000)
    audience: Audience = "CONFIRMED"
    reason: Text


class Mutation(Strict):
    expected_version: int = Field(gt=0)
    reason: Text


class Revision(AnnouncementInput):
    expected_version: int = Field(gt=0)


class Approval(Mutation):
    content_version: int = Field(gt=0)


async def record(conn, actor, operation, before, msg, project, reason):
    after = announcement_data(msg, project)
    await conn.execute(
        "INSERT INTO "
        "public.audit_logs(project_id,actor_user_id,action,entity_type,entity_id,before_jso"
        "n,after_json,reason) "
        "VALUES(%s,%s,%s,'announcement',%s,%s,%s,%s)",
        (
            msg["project_id"],
            actor,
            operation.upper(),
            msg["announcement_id"],
            Jsonb(before),
            Jsonb(after),
            reason,
        ),
    )
    return after


def announcement_router(settings, identity):
    router = APIRouter()
    Actor = Annotated[object, Depends(identity)]
    Key = Annotated[UUID, Header(alias="Idempotency-Key")]

    @router.get("/projects/{project_id}/announcements", operation_id="list_announcements")
    async def listing(
        project_id: UUID,
        actor: Actor,
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        async with transaction(settings) as conn:
            project = await require_project(conn, actor.user_id, project_id, "operate")
            items = await rows(
                conn,
                "SELECT * FROM public.market_announcements WHERE project_id=%s ORDER BY "
                "created_at DESC,announcement_id LIMIT %s OFFSET %s",
                (project_id, limit, offset),
            )
            total = await one(
                conn,
                "SELECT count(*) AS total FROM public.market_announcements WHERE project_id=%s",
                (project_id,),
            )
            return {
                "data": dict(
                    items=[announcement_data(m, project) for m in items],
                    total=total["total"],
                    limit=limit,
                    offset=offset,
                    project=dict(project_id=str(project_id), name=project["name"]),
                )
            }

    @router.get("/announcements/{announcement_id}", operation_id="get_announcement")
    async def detail(announcement_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            msg, project = await require_announcement(conn, actor.user_id, announcement_id)
            return {"data": announcement_data(msg, project)}

    @router.get(
        "/applications/{application_id}/market-notices", operation_id="seller_market_notices"
    )
    async def notices(
        application_id: UUID,
        actor: Actor,
        limit: Annotated[int, Query(ge=1, le=20)] = 5,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        async with transaction(settings) as conn:
            app, project, _ = await require_application(conn, actor.user_id, application_id)
            if project["deleted_at"]:
                raise DomainError(404, "NOT_FOUND", "마켓을 찾을 수 없습니다.")
            items = []
            if app["submitted_at"] and app["status"] in (
                "SUBMITTED",
                "NEED_INFO",
                "REVIEWING",
                "APPROVED",
                "WAITING",
                "REJECTED",
                "CONFIRMED",
            ):
                items = await rows(
                    conn,
                    "SELECT announcement_id,published_subject AS subject,published_body AS "
                    "body,published_audience AS audience,published_content_version AS "
                    "content_version,published_at FROM public.market_announcements WHERE "
                    "project_id=%s AND published_at IS NOT NULL AND withdrawn_at IS NULL "
                    "AND (published_audience='ALL_APPLICANTS' OR %s='CONFIRMED') ORDER BY "
                    "published_at DESC,announcement_id LIMIT %s OFFSET %s",
                    (app["project_id"], app["status"], limit + 1, offset),
                )
            return {
                "data": jsonable_encoder(
                    dict(
                        items=items[:limit], has_more=len(items) > limit, limit=limit, offset=offset
                    )
                )
            }

    @router.post("/projects/{project_id}/announcements", operation_id="create_announcement")
    async def create(project_id: UUID, body: AnnouncementInput, actor: Actor, idempotency_key: Key):
        async with transaction(settings) as conn:
            project = None

            async def authorize():
                nonlocal project
                project = await require_project(conn, actor.user_id, project_id, "operate")

            async def mutate():
                before_end(project)
                msg = await one(
                    conn,
                    "INSERT INTO "
                    "public.market_announcements(project_id,subject,body,audience) "
                    "VALUES(%s,%s,%s,%s) RETURNING *",
                    (project_id, body.subject, body.body, body.audience),
                )
                value = await record(
                    conn, actor.user_id, "announcements.create", None, msg, project, body.reason
                )
                return Change(value, 201, "announcement", msg["announcement_id"])

            result = await execute(
                conn,
                actor.user_id,
                "announcements.create",
                idempotency_key,
                "POST",
                f"/api/projects/{project_id}/announcements",
                "project",
                project_id,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    async def change(aid, body, actor, key, action):
        operation = "announcements." + action
        async with transaction(settings) as conn:
            msg = project = None

            async def authorize():
                nonlocal msg, project
                msg, project = await require_announcement(conn, actor.user_id, aid)

            async def mutate():
                version_matches(msg, body.expected_version)
                if action != "unpublish":
                    before_end(project)
                before = announcement_data(msg, project)
                if action == "revise":
                    await conn.execute(
                        "UPDATE public.market_announcements SET "
                        "subject=%s,body=%s,audience=%s,content_version=content_version+1,a"
                        "pproved_version=NULL,approved_by=NULL,approved_at=NULL "
                        "WHERE announcement_id=%s",
                        (body.subject, body.body, body.audience, aid),
                    )
                elif action == "unpublish":
                    if not msg["published_at"] or msg["withdrawn_at"]:
                        raise DomainError(409, "NOT_PUBLISHED", "게시 중인 안내가 아닙니다.")
                    await conn.execute(
                        "UPDATE public.market_announcements SET withdrawn_at=now() WHERE "
                        "announcement_id=%s",
                        (aid,),
                    )
                else:
                    if body.content_version != msg["content_version"]:
                        raise DomainError(
                            409, "CONTENT_VERSION_CONFLICT", "현재 내용을 확인해 주세요."
                        )
                    if action == "approve":
                        if msg["approved_version"] == msg["content_version"]:
                            raise DomainError(409, "ALREADY_APPROVED", "이미 승인된 내용입니다.")
                        await conn.execute(
                            "UPDATE public.market_announcements SET "
                            "approved_version=content_version,approved_at=now(),approved_by=%s "
                            "WHERE announcement_id=%s",
                            (actor.user_id, aid),
                        )
                    else:
                        if msg["approved_version"] != msg["content_version"]:
                            raise DomainError(
                                409, "APPROVAL_REQUIRED", "현재 초안 승인이 필요합니다."
                            )
                        if (
                            not msg["withdrawn_at"]
                            and msg["published_content_version"] == msg["content_version"]
                        ):
                            raise DomainError(409, "ALREADY_PUBLISHED", "이미 게시된 내용입니다.")
                        await conn.execute(
                            "UPDATE public.market_announcements SET "
                            "published_subject=subject,published_body=body,published_audien"
                            "ce=audience,published_content_version=content_version,publishe"
                            "d_at=now(),published_by=%s,withdrawn_at=NULL "
                            "WHERE announcement_id=%s",
                            (actor.user_id, aid),
                        )
                updated = await one(
                    conn,
                    "UPDATE public.market_announcements SET "
                    "version=version+1,updated_at=now() WHERE announcement_id=%s RETURNING "
                    "*",
                    (aid,),
                )
                return Change(
                    await record(
                        conn, actor.user_id, operation, before, updated, project, body.reason
                    )
                )

            result = await execute(
                conn,
                actor.user_id,
                operation,
                key,
                "POST",
                f"/api/announcements/{aid}/{action}",
                "announcement",
                aid,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.post("/announcements/{announcement_id}/revise", operation_id="revise_announcement")
    async def revise(announcement_id: UUID, body: Revision, actor: Actor, idempotency_key: Key):
        return await change(announcement_id, body, actor, idempotency_key, "revise")

    @router.post("/announcements/{announcement_id}/approve", operation_id="approve_announcement")
    async def approve(announcement_id: UUID, body: Approval, actor: Actor, idempotency_key: Key):
        return await change(announcement_id, body, actor, idempotency_key, "approve")

    @router.post("/announcements/{announcement_id}/publish", operation_id="publish_announcement")
    async def publish(announcement_id: UUID, body: Approval, actor: Actor, idempotency_key: Key):
        return await change(announcement_id, body, actor, idempotency_key, "publish")

    @router.post(
        "/announcements/{announcement_id}/unpublish", operation_id="unpublish_announcement"
    )
    async def unpublish(announcement_id: UUID, body: Mutation, actor: Actor, idempotency_key: Key):
        return await change(announcement_id, body, actor, idempotency_key, "unpublish")

    return router
