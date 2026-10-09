"""Participation is explicitly confirmed after approval; it is never automatic."""

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import Field

from marketory.application_domain import (
    application_audit,
    application_data,
    before_event_end,
    require_application,
)
from marketory.applications import status_history
from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute
from marketory.permissions import one
from marketory.projects import Strict, version_matches


class Confirm(Strict):
    expected_version: int = Field(gt=0)
    reason: str | None = Field(default=None, min_length=1, max_length=2000)


def confirmation_router(settings, identity):
    router = APIRouter()
    Actor = Annotated[object, Depends(identity)]
    Key = Annotated[UUID, Header(alias="Idempotency-Key")]

    @router.post("/applications/{application_id}/confirm", operation_id="confirm_participation")
    async def confirm(application_id: UUID, body: Confirm, actor: Actor, idempotency_key: Key):
        async with transaction(settings) as conn:
            owned = bool(
                await one(
                    conn,
                    "SELECT a.application_id FROM public.applications a "
                    "JOIN public.sellers s USING(seller_id) WHERE a.application_id=%s "
                    "AND s.user_id=%s",
                    (application_id, actor.user_id),
                )
            )
            resource_type = "application" if owned else "review_application_operator"
            app = project = seller = None

            async def authorize():
                nonlocal app, project, seller
                if owned:
                    app, project, seller = await require_application(
                        conn, actor.user_id, application_id, "edit"
                    )
                else:
                    from marketory.review_domain import require_review

                    app, project, _ = await require_review(
                        conn, actor.user_id, application_id, "operate"
                    )

            async def mutate():
                version_matches(app, body.expected_version)
                before_event_end(project)
                if not owned and not body.reason:
                    raise DomainError(
                        422,
                        "CONFIRMATION_EVIDENCE_REQUIRED",
                        "참가 의사를 확인한 근거를 입력해 주세요.",
                    )
                if app["status"] != "APPROVED":
                    raise DomainError(
                        409, "INVALID_TRANSITION", "선정된 신청만 참가확정할 수 있습니다."
                    )
                if not app["confirm_due_at"] or datetime.now(timezone.utc) >= app["confirm_due_at"]:
                    raise DomainError(
                        409,
                        "CONFIRMATION_EXPIRED",
                        "참가확정 기한이 지났습니다. 운영자에게 연장을 요청해 주세요.",
                    )
                if app["confirm_due_at"] >= project["event_end_at"]:
                    raise DomainError(
                        409, "INVALID_DEADLINE", "행사 종료 전의 확정 기한이 필요합니다."
                    )
                after = await one(
                    conn,
                    "UPDATE public.applications SET status='CONFIRMED',"
                    "confirmed_at=now(),version=version+1,updated_at=now() "
                    "WHERE application_id=%s RETURNING *",
                    (application_id,),
                )
                reason = body.reason if not owned else "셀러 본인 참가확정"
                await status_history(conn, app, actor.user_id, "CONFIRMED", reason)
                await application_audit(
                    conn, actor.user_id, app, "APPLICATIONS.CONFIRM", app, after, reason
                )
                if owned:
                    data = await application_data(conn, after, project, seller)
                else:
                    from marketory.review_domain import review_data

                    data = await review_data(conn, actor.user_id, after, project, "OPERATOR")
                return Change(data, resource_type=resource_type, resource_id=application_id)

            result = await execute(
                conn,
                actor.user_id,
                "applications.confirm",
                idempotency_key,
                "POST",
                f"/api/applications/{application_id}/confirm",
                resource_type,
                application_id,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    return router
