"""Human approved email drafts. API transactions enqueue only; delivery belongs to the worker."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from pydantic import Field

from marketory.application_domain import require_application
from marketory.booth_domain import rows
from marketory.communication_domain import (
    communication_context,
    communication_data,
    eligible,
    require_communication,
    validate_context,
)
from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute
from marketory.permissions import one, require_project
from marketory.projects import Strict, Text, before_end, version_matches

Kind = Literal["SELECTION", "WAITING", "REJECTION", "CONFIRM", "BOOTH", "NEED_INFO", "NOTICE"]
Subject = Annotated[str, Field(min_length=1, max_length=200)]
Body = Annotated[str, Field(min_length=1, max_length=50000)]


class Generate(Strict):
    project_id: UUID
    application_id: UUID
    type: Kind
    subject: Subject | None = None
    body: Body | None = None
    reason: Text


class Mutation(Strict):
    expected_version: int = Field(gt=0)
    reason: Text


class Approve(Mutation):
    content_version: int = Field(gt=0)


class Revise(Mutation):
    subject: Subject
    body: Body


class Resolve(Mutation):
    attempt_id: UUID
    method: Literal["MANUAL_EVIDENCE"]
    outcome: Literal["ACCEPTED", "NOT_ACCEPTED", "INCONCLUSIVE"]
    evidence_ref: Text


async def insert_draft(conn, app, project, kind, subject, body, supersedes=None):
    context = await communication_context(conn, app, project)
    if not eligible(kind, app, context):
        raise DomainError(
            409, "INELIGIBLE_RECIPIENT", "현재 신청 상태에 사용할 수 없는 안내입니다."
        )
    label = dict(
        SELECTION="선정 안내",
        WAITING="대기 안내",
        REJECTION="미선정 안내",
        CONFIRM="참가 확정 안내",
        BOOTH="부스 배치 안내",
        NEED_INFO="보완 요청",
        NOTICE="운영 안내",
    )[kind]
    title = subject if subject is not None else f"[{project['name']}] {label}"[:200]
    text = (
        body
        if body is not None
        else (
            f"{(app['seller_snapshot_json'] or {}).get('shop_name', '셀러')}님, 안녕하세요.\n"
            f"{project['name']} {label}입니다.\n신청 상태: {app['status']}\n"
            "자세한 신청 내용은 마켓토리에서 확인해 주세요."
        )
    )
    return await one(
        conn,
        "INSERT INTO public.communications(project_id,application_id,type,"
        "subject,body,recipient_snapshot,context_snapshot_json,supersedes_id) "
        "VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (
            project["project_id"],
            app["application_id"],
            kind,
            title,
            text,
            app["notification_email"],
            Jsonb(context),
            supersedes,
        ),
    )


async def record(conn, actor, operation, before, message, reason):
    after = await communication_data(conn, message)
    await conn.execute(
        "INSERT INTO public.audit_logs(project_id,actor_user_id,action,entity_type,"
        "entity_id,before_json,after_json,reason) VALUES(%s,%s,%s,'communication',"
        "%s,%s,%s,%s)",
        (
            message["project_id"],
            actor,
            operation.upper(),
            message["communication_id"],
            Jsonb(jsonable_encoder(before)),
            Jsonb(after),
            reason,
        ),
    )
    return after


def communication_router(settings, identity):
    router = APIRouter()
    Actor = Annotated[object, Depends(identity)]
    Key = Annotated[UUID, Header(alias="Idempotency-Key")]

    @router.get("/applications/{application_id}/notices", operation_id="seller_notices")
    async def seller_notices(
        application_id: UUID,
        actor: Actor,
        limit: Annotated[int, Query(ge=1, le=20)] = 5,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        async with transaction(settings) as conn:
            await require_application(conn, actor.user_id, application_id)
            items = await rows(
                conn,
                "SELECT communication_id,published_subject AS subject,published_body AS body,"
                "published_content_version AS content_version,published_at "
                "FROM public.communications WHERE application_id=%s "
                "AND published_at IS NOT NULL AND withdrawn_at IS NULL "
                "ORDER BY published_at DESC,communication_id LIMIT %s OFFSET %s",
                (application_id, limit + 1, offset),
            )
            return {
                "data": jsonable_encoder(
                    dict(
                        items=items[:limit], has_more=len(items) > limit, limit=limit, offset=offset
                    )
                )
            }

    @router.get("/projects/{project_id}/communications", operation_id="list_communications")
    async def listing(
        project_id: UUID,
        actor: Actor,
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        async with transaction(settings) as conn:
            project = await require_project(conn, actor.user_id, project_id, "operate")
            messages = await rows(
                conn,
                "SELECT * FROM public.communications WHERE project_id=%s "
                "ORDER BY created_at DESC,communication_id LIMIT %s OFFSET %s",
                (project_id, limit, offset),
            )
            total = await one(
                conn,
                "SELECT count(*) AS total FROM public.communications WHERE project_id=%s",
                (project_id,),
            )
            return {
                "data": dict(
                    items=[await communication_data(conn, m) for m in messages],
                    total=total["total"],
                    limit=limit,
                    offset=offset,
                    project=dict(project_id=str(project_id), name=project["name"]),
                    delivery_enabled=getattr(settings, "email_delivery_enabled", False),
                )
            }

    @router.get(
        "/projects/{project_id}/communication-targets", operation_id="communication_targets"
    )
    async def targets(project_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            project = await require_project(conn, actor.user_id, project_id, "operate")
            items = await rows(
                conn,
                "SELECT a.application_id,a.seller_snapshot_json->>'shop_name' AS shop_name,"
                "a.status,a.notification_email,EXISTS(SELECT FROM public.booth_assignments b "
                "WHERE b.application_id=a.application_id AND b.confirmed AND "
                "b.released_at IS NULL) AS has_booth "
                "FROM public.applications a WHERE a.project_id=%s AND a.deleted_at IS NULL "
                "AND a.submitted_at IS NOT NULL AND a.status NOT IN ('DRAFT','CANCELLED') "
                "ORDER BY a.application_id",
                (project_id,),
            )
            return {
                "data": jsonable_encoder(
                    dict(items=items, project=dict(project_id=project_id, name=project["name"]))
                )
            }

    @router.get("/communications/{communication_id}", operation_id="get_communication")
    async def detail(communication_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            message, _, _ = await require_communication(conn, actor.user_id, communication_id)
            return {"data": await communication_data(conn, message)}

    @router.post("/communications/generate", operation_id="generate_communication", status_code=201)
    async def generate(body: Generate, actor: Actor, idempotency_key: Key):
        async with transaction(settings) as conn:
            project = None

            async def authorize():
                nonlocal project
                project = await require_project(conn, actor.user_id, body.project_id, "operate")

            async def mutate():
                before_end(project)
                app = await one(
                    conn,
                    "SELECT * FROM public.applications WHERE project_id=%s "
                    "AND application_id=%s AND deleted_at IS NULL FOR UPDATE",
                    (body.project_id, body.application_id),
                )
                if not app:
                    raise DomainError(404, "NOT_FOUND", "신청서를 찾을 수 없습니다.")
                message = await insert_draft(conn, app, project, body.type, body.subject, body.body)
                value = await record(
                    conn, actor.user_id, "communications.generate", None, message, body.reason
                )
                return Change(value, 201, "communication", message["communication_id"])

            result = await execute(
                conn,
                actor.user_id,
                "communications.generate",
                idempotency_key,
                "POST",
                "/api/communications/generate",
                "project",
                body.project_id,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    async def change(cid, body, actor, key, action):
        operation = "communications." + action
        async with transaction(settings) as conn:
            message = app = project = None

            async def authorize():
                nonlocal message, app, project
                message, app, project = await require_communication(conn, actor.user_id, cid)

            async def mutate():
                version_matches(message, body.expected_version)
                if action not in ("resolve", "unpublish"):
                    before_end(project)
                if message["superseded_at"] and action != "unpublish":
                    raise DomainError(409, "SUPERSEDED", "새 초안으로 대체된 메시지입니다.")
                status = message["send_status"]
                attempts = await rows(
                    conn,
                    "SELECT * FROM public.communication_attempts WHERE "
                    "communication_id=%s ORDER BY attempt_no DESC",
                    (cid,),
                )
                before = await communication_data(conn, message)
                target = cid
                response_status = 200
                if action == "unpublish":
                    if not message["published_at"] or message["withdrawn_at"]:
                        raise DomainError(409, "NOT_PUBLISHED", "게시 중인 안내가 아닙니다.")
                    await conn.execute(
                        "UPDATE public.communications SET withdrawn_at=now(),"
                        "version=version+1,updated_at=now() WHERE communication_id=%s",
                        (cid,),
                    )
                elif action == "publish":
                    await validate_context(conn, message, app, project)
                    if message["approved_version"] != message["content_version"]:
                        raise DomainError(409, "APPROVAL_REQUIRED", "현재 초안 승인이 필요합니다.")
                    if body.content_version != message["content_version"]:
                        raise DomainError(
                            409, "CONTENT_VERSION_CONFLICT", "현재 내용을 확인해 주세요."
                        )
                    if (
                        not message["withdrawn_at"]
                        and message["published_content_version"] == message["content_version"]
                    ):
                        raise DomainError(409, "ALREADY_PUBLISHED", "이미 게시된 내용입니다.")
                    await conn.execute(
                        "UPDATE public.communications SET published_subject=subject,"
                        "published_body=body,published_content_version=content_version,"
                        "published_at=now(),published_by=%s,withdrawn_at=NULL,"
                        "version=version+1,updated_at=now() WHERE communication_id=%s",
                        (actor.user_id, cid),
                    )
                elif action == "revise":
                    if status in ("SENDING", "UNKNOWN"):
                        raise DomainError(409, "INVALID_STATUS", "발송 결과를 먼저 확인해 주세요.")
                    context = await communication_context(conn, app, project)
                    if not eligible(message["type"], app, context):
                        raise DomainError(
                            409,
                            "INELIGIBLE_RECIPIENT",
                            "현재 신청 상태에 사용할 수 없는 안내입니다.",
                        )
                    if attempts:
                        fresh = await insert_draft(
                            conn, app, project, message["type"], body.subject, body.body, cid
                        )
                        target = fresh["communication_id"]
                        await conn.execute(
                            "UPDATE public.communications SET "
                            "superseded_at=now(),version=version+1,"
                            "updated_at=now(),send_status=CASE WHEN send_status='QUEUED' THEN "
                            "'FAILED' ELSE send_status END,"
                            "failure_reason=CASE WHEN send_status='QUEUED' THEN "
                            "'CONTEXT_CHANGED' ELSE failure_reason END,"
                            "queued_at=NULL,queued_by=NULL WHERE communication_id=%s",
                            (cid,),
                        )
                    else:
                        await conn.execute(
                            "UPDATE public.communications SET "
                            "subject=%s,body=%s,recipient_snapshot=%s,"
                            "context_snapshot_json=%s,content_version=content_version+1,"
                            "version=version+1,"
                            "send_status='DRAFT',approved_version=NULL,approved_by=NULL,"
                            "approved_at=NULL,"
                            "queued_at=NULL,queued_by=NULL,failure_reason=NULL,updated_at=now() "
                            "WHERE communication_id=%s",
                            (
                                body.subject,
                                body.body,
                                app["notification_email"],
                                Jsonb(context),
                                cid,
                            ),
                        )
                elif action == "resolve":
                    if (
                        status != "UNKNOWN"
                        or not attempts
                        or attempts[0]["attempt_id"] != body.attempt_id
                        or attempts[0]["status"] != "UNKNOWN"
                    ):
                        raise DomainError(
                            409,
                            "INVALID_ATTEMPT",
                            "현재 결과 미확인 발송 시도만 확인할 수 있습니다.",
                        )
                    state = dict(ACCEPTED="SENT", NOT_ACCEPTED="FAILED", INCONCLUSIVE="UNKNOWN")[
                        body.outcome
                    ]
                    await conn.execute(
                        "INSERT INTO public.communication_resolutions(communication_id,attempt_id,"
                        "from_status,to_status,method,outcome,evidence_ref,reason,resolved_by) "
                        "VALUES(%s,%s,'UNKNOWN',%s,%s,%s,%s,%s,%s)",
                        (
                            cid,
                            body.attempt_id,
                            state,
                            body.method,
                            body.outcome,
                            body.evidence_ref,
                            body.reason,
                            actor.user_id,
                        ),
                    )
                    await conn.execute(
                        "UPDATE public.communication_attempts SET "
                        "status=%s,completed_at=now() WHERE attempt_id=%s",
                        (state, body.attempt_id),
                    )
                    await conn.execute(
                        "UPDATE public.communications SET "
                        "send_status=%s,version=version+1,updated_at=now(),"
                        "sent_at=CASE WHEN %s='SENT' THEN now() ELSE sent_at "
                        "END,claim_token=NULL,claimed_at=NULL,"
                        "queued_at=NULL,queued_by=NULL,failure_reason=CASE WHEN %s='FAILED' "
                        "THEN 'NOT_ACCEPTED' "
                        "WHEN %s='SENT' THEN NULL ELSE failure_reason END WHERE "
                        "communication_id=%s",
                        (state, state, state, state, cid),
                    )
                else:
                    await validate_context(conn, message, app, project)
                    required = dict(approve="DRAFT", send="READY", retry="FAILED")[action]
                    if status != required:
                        raise DomainError(
                            409, "INVALID_STATUS", "현재 메시지 상태에서 처리할 수 없습니다."
                        )
                    if action == "approve":
                        if body.content_version != message["content_version"]:
                            raise DomainError(
                                409, "CONTENT_VERSION_CONFLICT", "현재 초안 버전을 확인해 주세요."
                            )
                        await conn.execute(
                            "UPDATE public.communications SET "
                            "send_status='READY',approved_version=content_version,"
                            "approved_by=%s,approved_at=now(),failure_reason=NULL,"
                            "version=version+1,updated_at=now() "
                            "WHERE communication_id=%s",
                            (actor.user_id, cid),
                        )
                    else:
                        if message["approved_version"] != message["content_version"]:
                            raise DomainError(
                                409, "APPROVAL_REQUIRED", "현재 초안 승인이 필요합니다."
                            )
                        if message["failure_reason"] == "PROVIDER_KEY_EXPIRED":
                            raise DomainError(
                                409, "PROVIDER_KEY_EXPIRED", "새 초안을 만들고 다시 승인해 주세요."
                            )
                        await conn.execute(
                            "UPDATE public.communications SET "
                            "send_status='QUEUED',queued_at=now(),queued_by=%s,"
                            "failure_reason=NULL,version=version+1,updated_at=now() WHERE "
                            "communication_id=%s",
                            (actor.user_id, cid),
                        )
                        response_status = 202
                updated = await one(
                    conn, "SELECT * FROM public.communications WHERE communication_id=%s", (target,)
                )
                value = await record(conn, actor.user_id, operation, before, updated, body.reason)
                return Change(value, response_status, "communication", target)

            result = await execute(
                conn,
                actor.user_id,
                operation,
                key,
                "POST",
                f"/api/communications/{cid}/{action}",
                "communication",
                cid,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.post("/communications/{communication_id}/approve", operation_id="approve_communication")
    async def approve(communication_id: UUID, body: Approve, actor: Actor, idempotency_key: Key):
        return await change(communication_id, body, actor, idempotency_key, "approve")

    @router.post(
        "/communications/{communication_id}/send",
        operation_id="send_communication",
        status_code=202,
    )
    async def send(communication_id: UUID, body: Mutation, actor: Actor, idempotency_key: Key):
        return await change(communication_id, body, actor, idempotency_key, "send")

    @router.post(
        "/communications/{communication_id}/retry",
        operation_id="retry_communication",
        status_code=202,
    )
    async def retry(communication_id: UUID, body: Mutation, actor: Actor, idempotency_key: Key):
        return await change(communication_id, body, actor, idempotency_key, "retry")

    @router.post("/communications/{communication_id}/revise", operation_id="revise_communication")
    async def revise(communication_id: UUID, body: Revise, actor: Actor, idempotency_key: Key):
        return await change(communication_id, body, actor, idempotency_key, "revise")

    @router.post("/communications/{communication_id}/resolve", operation_id="resolve_communication")
    async def resolve(communication_id: UUID, body: Resolve, actor: Actor, idempotency_key: Key):
        return await change(communication_id, body, actor, idempotency_key, "resolve")

    @router.post("/communications/{communication_id}/publish", operation_id="publish_communication")
    async def publish(communication_id: UUID, body: Approve, actor: Actor, idempotency_key: Key):
        return await change(communication_id, body, actor, idempotency_key, "publish")

    @router.post(
        "/communications/{communication_id}/unpublish", operation_id="unpublish_communication"
    )
    async def unpublish(communication_id: UUID, body: Mutation, actor: Actor, idempotency_key: Key):
        return await change(communication_id, body, actor, idempotency_key, "unpublish")

    return router
