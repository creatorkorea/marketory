from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, Header, Query
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict, ValidationError

from marketory.auth import Identity
from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute, lookup
from marketory.permissions import active_user, one, require_project
from marketory.projects import project_router


class EmptyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Envelope(BaseModel):
    data: dict | list[dict]
    request_id: UUID


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list
    request_id: UUID


class RequestResult(BaseModel):
    outcome: str
    http_status: int
    response: dict
    resource_id: UUID | None
    request_id: UUID


def build_router(settings, verify):
    router = APIRouter(
        prefix="/api",
        responses={code: {"model": ErrorBody} for code in (401, 403, 404, 409, 410, 422, 503)},
    )
    bearer = HTTPBearer(auto_error=False)

    async def identity(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ):
        if not credentials:
            raise DomainError(401, "AUTH_REQUIRED", "로그인이 필요합니다.")
        return await verify(credentials.credentials)

    @router.post(
        "/auth/bootstrap",
        response_model=Envelope,
        operation_id="auth_bootstrap",
        openapi_extra={
            "requestBody": {
                "content": {"application/json": {"schema": EmptyInput.model_json_schema()}}
            }
        },
    )
    async def bootstrap(
        payload: Annotated[Any, Body()],
        actor: Annotated[Identity, Depends(identity)],
        idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
    ):
        async with transaction(settings) as conn:
            # In the same transaction as the idempotency result, including first login.
            inserted = await conn.execute(
                "INSERT INTO public.users(user_id,email) VALUES (%s,%s) "
                "ON CONFLICT(user_id) DO NOTHING RETURNING user_id",
                (actor.user_id, actor.email),
            )
            created = await inserted.fetchone() is not None
            await conn.execute(
                "UPDATE public.users SET email=%s,updated_at=now() WHERE user_id=%s "
                "AND status='ACTIVE' AND email IS DISTINCT FROM %s",
                (actor.email, actor.user_id, actor.email),
            )
            user = await active_user(conn, actor.user_id)

            async def authorize():
                await active_user(conn, actor.user_id)

            async def mutate():
                try:
                    EmptyInput.model_validate(payload)
                except ValidationError:
                    raise DomainError(
                        422, "INVALID_INPUT", "역할 등 사용자 설정값을 받지 않습니다."
                    ) from None
                data = {
                    "user_id": str(actor.user_id),
                    "global_role": user["global_role"],
                    "account_role": user["account_role"],
                    "profile_required": user["profile_completed_at"] is None,
                }
                await conn.execute(
                    "INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id) "
                    "VALUES (%s,'AUTH_BOOTSTRAP','user',%s)",
                    (actor.user_id, actor.user_id),
                )
                return Change(data, resource_type="user", resource_id=actor.user_id)

            result = await execute(
                conn,
                actor.user_id,
                "auth.bootstrap",
                idempotency_key,
                "POST",
                "/api/auth/bootstrap",
                "user",
                actor.user_id,
                payload,
                authorize,
                mutate,
            )
            if created and result.status >= 400:
                # A rejected first bootstrap must not leave a newly created account behind.
                raise DomainError(result.status, result.body["code"], result.body["message"])
        return JSONResponse(
            result.body, status_code=result.status, headers={"Cache-Control": "no-store"}
        )

    @router.get("/me", response_model=Envelope, operation_id="get_me")
    async def me(actor: Annotated[Identity, Depends(identity)]):
        async with transaction(settings) as conn:
            user = await active_user(conn, actor.user_id)
            can_create = user["global_role"] == "PLATFORM_ADMIN"
            if not can_create and user["account_role"] == "STAFF":
                can_create = bool(
                    await one(
                        conn,
                        "SELECT m.project_member_id FROM public.project_members m "
                        "JOIN public.projects p USING(project_id) WHERE m.user_id=%s "
                        "AND m.active AND m.role='OPERATOR' AND p.deleted_at IS NULL LIMIT 1",
                        (actor.user_id,),
                    )
                )
        return {
            "data": {
                "user_id": str(actor.user_id),
                "email": actor.email,
                "name": user["name"],
                "global_role": user["global_role"],
                "account_role": user["account_role"],
                "profile_required": user["profile_completed_at"] is None,
                "can_create_project": can_create,
            },
            "request_id": uuid4(),
        }

    @router.get("/projects", response_model=Envelope, operation_id="list_projects")
    async def projects(
        actor: Annotated[Identity, Depends(identity)],
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        async with transaction(settings) as conn:
            user = await active_user(conn, actor.user_id)
            admin = user["global_role"] == "PLATFORM_ADMIN"
            if not admin and user["account_role"] != "STAFF":
                raise DomainError(403, "FORBIDDEN", "프로젝트 운영 권한이 없습니다.")
            async with conn.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """SELECT p.project_id,p.name,p.status,p.version,p.event_date,p.venue,
                    p.target_team_count,p.recruit_end_at,
                    (%s OR EXISTS(SELECT FROM public.project_members m
                    WHERE m.project_id=p.project_id
                    AND m.user_id=%s AND m.active AND m.role='OPERATOR')) AS can_manage
                    FROM public.projects p
                    WHERE p.deleted_at IS NULL AND (%s OR EXISTS (
                    SELECT FROM public.project_members m
                    WHERE m.project_id=p.project_id AND m.user_id=%s AND m.active))
                    ORDER BY p.created_at DESC,p.project_id LIMIT %s OFFSET %s""",
                    (admin, actor.user_id, admin, actor.user_id, limit, offset),
                )
                data = await cursor.fetchall()
        return {"data": data, "request_id": uuid4()}

    @router.get(
        "/projects/{project_id}", response_model=Envelope, operation_id="get_project_summary"
    )
    async def summary(project_id: UUID, actor: Annotated[Identity, Depends(identity)]):
        async with transaction(settings) as conn:
            project = await require_project(conn, actor.user_id, project_id)
        return {
            "data": {key: project[key] for key in ("project_id", "name", "status", "version")},
            "request_id": uuid4(),
        }

    @router.get(
        "/me/requests/{operation}/{idempotency_key}",
        response_model=RequestResult,
        responses={202: {"model": ErrorBody}},
        operation_id="get_request_result",
    )
    async def request_result(
        operation: str, idempotency_key: UUID, actor: Annotated[Identity, Depends(identity)]
    ):
        if operation not in (
            "auth.bootstrap",
            "projects.update",
            "projects.create",
            "projects.status",
            "projects.members",
        ):
            raise DomainError(422, "UNKNOWN_OPERATION", "지원하지 않는 요청 종류입니다.")
        async with transaction(settings) as conn:
            result = await lookup(conn, actor.user_id, operation, idempotency_key)
        return JSONResponse(
            result.body, status_code=result.status, headers={"Cache-Control": "no-store"}
        )

    router.include_router(project_router(settings, identity))
    return router
