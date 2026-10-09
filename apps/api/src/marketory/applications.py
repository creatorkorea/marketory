"""Seller drafts and submissions use the existing durable request-result transaction."""

from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID, uuid5

from fastapi import APIRouter, Depends, Header, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import Field

from marketory.application_domain import (
    CANCEL_STATES,
    application_audit,
    application_data,
    before_event_end,
    editable_application,
    recruiting,
    require_application,
)
from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute
from marketory.permissions import active_user, one
from marketory.projects import Strict, version_matches
from marketory.sellers import PROFILE_FIELDS


class CreateApplication(Strict):
    project_id: UUID


class ApplicationUpdate(Strict):
    expected_version: int = Field(gt=0)
    product_name: str | None = Field(default=None, max_length=150)
    product_desc: str | None = Field(default=None, max_length=10000)
    price_range: str | None = Field(default=None, max_length=80)
    category: str | None = Field(default=None, max_length=50)
    electricity_required: bool = False
    table_count: int = Field(default=0, ge=0, le=100)
    fire_required: bool = False
    cold_storage_required: bool = False
    vehicle_entry_required: bool = False
    request_note: str | None = Field(default=None, max_length=10000)


class SubmitApplication(Strict):
    expected_version: int = Field(gt=0)
    expected_policy_version: int = Field(gt=0)
    consent_version: str = Field(min_length=1, max_length=100)
    consent_accepted: Literal[True]


class CancelApplication(Strict):
    expected_version: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=2000)


class SubmissionRequirements(DomainError):
    def __init__(self, fields):
        super().__init__(422, "SUBMISSION_REQUIREMENTS", "필수 항목과 첨부를 확인해 주세요.")
        self.fields = fields

    def body(self, request_id=None):
        return {
            **super().body(request_id),
            "details": [
                {"field": field, "message": "확인이 필요한 항목입니다."} for field in self.fields
            ],
        }


async def status_history(conn, app, actor, status, reason):
    await conn.execute(
        "INSERT INTO public.application_status_history(application_id,from_status,"
        "to_status,changed_by,reason) VALUES(%s,%s,%s,%s,%s)",
        (app["application_id"], app.get("status"), status, actor, reason),
    )


async def validate_submission(conn, app, project, seller):
    missing = [
        k for k in ("product_name", "product_desc", "price_range", "category") if not app.get(k)
    ]
    missing.extend(k for k in ("shop_name", "owner_name", "phone") if not seller.get(k))
    policy = project["policy_json"]
    if app.get("category") not in policy.get("allowed_categories", []):
        missing.append("category (허용된 품목을 선택해 주세요)")
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT file_type FROM public.attachments WHERE application_id=%s "
            "AND deleted_at IS NULL",
            (app["application_id"],),
        )
        kinds = {r["file_type"] for r in await cur.fetchall()}
    if policy.get("photo_required") and "PRODUCT_IMAGE" not in kinds:
        missing.append("product_images")
    if policy.get("business_required") and "BUSINESS_DOC" not in kinds:
        missing.append("business_document")
    pending = await one(
        conn,
        "SELECT upload_intent_id FROM public.upload_intents "
        "WHERE application_id=%s AND status='ISSUED' LIMIT 1",
        (app["application_id"],),
    )
    if pending:
        missing.append("pending_upload (첨부를 완료하거나 업로드 선택을 취소해 주세요)")
    if missing:
        raise SubmissionRequirements(missing)


def application_router(settings, identity):
    router = APIRouter()
    Actor = Annotated[object, Depends(identity)]
    Key = Annotated[UUID, Header(alias="Idempotency-Key")]

    @router.post("/applications", status_code=201, operation_id="create_application")
    async def create(body: CreateApplication, actor: Actor, idempotency_key: Key):
        aid = uuid5(actor.user_id, "applications.create:" + str(idempotency_key))
        async with transaction(settings) as conn:
            project = seller = None

            async def authorize():
                nonlocal project, seller
                user = await active_user(conn, actor.user_id)
                if user["account_role"] != "SELLER":
                    raise DomainError(403, "FORBIDDEN", "셀러 계정만 신청할 수 있습니다.")
                project = await one(
                    conn,
                    "SELECT * FROM public.projects WHERE project_id=%s "
                    "AND deleted_at IS NULL FOR UPDATE",
                    (body.project_id,),
                )
                if not project or project["status"] == "DRAFT":
                    raise DomainError(404, "NOT_FOUND", "공개된 마켓을 찾을 수 없습니다.")
                seller = await one(
                    conn,
                    "SELECT * FROM public.sellers WHERE user_id=%s FOR SHARE",
                    (actor.user_id,),
                )
                if not seller:
                    raise DomainError(422, "PROFILE_REQUIRED", "먼저 셀러 프로필을 저장해 주세요.")

            async def mutate():
                recruiting(project)
                exists = await one(
                    conn,
                    "SELECT application_id FROM public.applications "
                    "WHERE project_id=%s AND seller_id=%s",
                    (body.project_id, seller["seller_id"]),
                )
                if exists:
                    raise DomainError(
                        409, "APPLICATION_EXISTS", "이미 신청이 있습니다. 내 신청을 확인해 주세요."
                    )
                await conn.execute(
                    "INSERT INTO public.applications(application_id,project_id,"
                    "seller_id,category,product_desc) VALUES(%s,%s,%s,%s,%s)",
                    (
                        aid,
                        body.project_id,
                        seller["seller_id"],
                        seller["base_category"],
                        seller["base_product_desc"],
                    ),
                )
                app = await one(
                    conn, "SELECT * FROM public.applications WHERE application_id=%s", (aid,)
                )
                await status_history(conn, {"application_id": aid}, actor.user_id, "DRAFT", None)
                await application_audit(
                    conn, actor.user_id, app, "APPLICATIONS.CREATE", None, app, None
                )
                return Change(
                    await application_data(conn, app, project, seller), 201, "application", aid
                )

            result = await execute(
                conn,
                actor.user_id,
                "applications.create",
                idempotency_key,
                "POST",
                "/api/applications",
                "application",
                aid,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.get("/me/applications", operation_id="my_applications")
    async def listing(
        actor: Actor,
        limit: int = Query(default=20, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        project_id: UUID | None = None,
    ):
        async with transaction(settings) as conn:
            await active_user(conn, actor.user_id)
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    "SELECT a.application_id FROM public.applications a "
                    "JOIN public.sellers s USING(seller_id) WHERE s.user_id=%s "
                    "AND a.deleted_at IS NULL "
                    + ("AND a.project_id=%s " if project_id else "")
                    + "ORDER BY a.created_at DESC,a.application_id LIMIT %s OFFSET %s",
                    (actor.user_id, *([project_id] if project_id else []), limit, offset),
                )
                ids = await cur.fetchall()
            data = []
            for item in ids:
                app, project, seller = await require_application(
                    conn, actor.user_id, item["application_id"]
                )
                data.append(await application_data(conn, app, project, seller))
            return {"data": data}

    @router.get("/applications/{application_id}", operation_id="application_detail")
    async def detail(application_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            app, project, seller = await require_application(conn, actor.user_id, application_id)
            return {"data": await application_data(conn, app, project, seller)}

    async def change(application_id, body, actor, key, operation, method, suffix, mutate_fn):
        async with transaction(settings) as conn:
            app = project = seller = None

            async def authorize():
                nonlocal app, project, seller
                app, project, seller = await require_application(
                    conn, actor.user_id, application_id, "write"
                )

            async def mutate():
                version_matches(app, body.expected_version)
                await mutate_fn(conn, app, project, seller)
                after = await one(
                    conn,
                    "SELECT * FROM public.applications WHERE application_id=%s",
                    (application_id,),
                )
                reason = getattr(body, "reason", None)
                await application_audit(
                    conn, actor.user_id, app, operation.upper(), app, after, reason
                )
                return Change(
                    await application_data(conn, after, project, seller),
                    resource_type="application",
                    resource_id=application_id,
                )

            result = await execute(
                conn,
                actor.user_id,
                operation,
                key,
                method,
                f"/api/applications/{application_id}{suffix}",
                "application",
                application_id,
                body.model_dump(mode="json", exclude_unset=isinstance(body, ApplicationUpdate)),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.patch("/applications/{application_id}", operation_id="update_application")
    async def update(
        application_id: UUID, body: ApplicationUpdate, actor: Actor, idempotency_key: Key
    ):
        async def mutate(conn, app, project, seller):
            values = body.model_dump(exclude_unset=True, exclude={"expected_version"})
            editable_application(app, project, set(values))
            if not values:
                raise DomainError(422, "EMPTY_UPDATE", "수정할 항목을 입력해 주세요.")
            if app["status"] == "NEED_INFO":
                required = {"product_name", "product_desc", "price_range", "category"}
                missing = [field for field in required & values.keys() if not values[field]]
                if missing:
                    raise SubmissionRequirements(missing)
            await conn.execute(
                "UPDATE public.applications SET "
                + ",".join(f"{k}=%s" for k in values)
                + ",version=version+1,revision_no=revision_no+1,updated_at=now() "
                "WHERE application_id=%s",
                (*values.values(), application_id),
            )

        return await change(
            application_id, body, actor, idempotency_key, "applications.update", "PATCH", "", mutate
        )

    async def submit_change(application_id, body, actor, key, resubmit):
        async def mutate(conn, app, project, seller):
            if app["status"] != ("NEED_INFO" if resubmit else "DRAFT"):
                raise DomainError(409, "INVALID_TRANSITION", "현재 상태에서는 제출할 수 없습니다.")
            editable_application(app, project, set())
            if body.expected_policy_version != project["policy_version"] or (
                body.consent_version != project["policy_json"].get("consent_version")
            ):
                raise DomainError(
                    409, "POLICY_CONFLICT", "변경된 모집 조건과 동의 문구를 다시 확인해 주세요."
                )
            await validate_submission(conn, app, project, seller)
            if not actor.email or not actor.email_verified_at:
                raise DomainError(422, "VERIFIED_EMAIL_REQUIRED", "인증된 이메일이 필요합니다.")
            consent = dict(
                consent_version=body.consent_version,
                accepted_at=datetime.now(timezone.utc).isoformat(),
                user_id=str(actor.user_id),
                purpose="market_application",
            )
            snapshot = {k: seller[k] for k in PROFILE_FIELDS if k not in ("version", "user_id")}
            # Resubmission preserves the original seller/email snapshot and first submission time.
            await conn.execute(
                "UPDATE public.applications SET status='SUBMITTED',"
                "submitted_at=COALESCE(submitted_at,now()),last_submitted_at=now(),"
                "seller_snapshot_json=COALESCE(seller_snapshot_json,%s),policy_version=%s,"
                "consent_json=%s,notification_email=COALESCE(notification_email,%s),"
                "notification_email_verified_at=COALESCE(notification_email_verified_at,%s),"
                "version=version+1,updated_at=now() WHERE application_id=%s",
                (
                    Jsonb(jsonable_encoder(snapshot)),
                    project["policy_version"],
                    Jsonb(consent),
                    actor.email,
                    actor.email_verified_at,
                    application_id,
                ),
            )
            await status_history(
                conn,
                app,
                actor.user_id,
                "SUBMITTED",
                "요청 항목 보완 제출" if resubmit else "셀러 제출",
            )

        return await change(
            application_id,
            body,
            actor,
            key,
            "applications.resubmit" if resubmit else "applications.submit",
            "POST",
            "/resubmit" if resubmit else "/submit",
            mutate,
        )

    @router.post("/applications/{application_id}/submit", operation_id="submit_application")
    async def submit(
        application_id: UUID, body: SubmitApplication, actor: Actor, idempotency_key: Key
    ):
        return await submit_change(application_id, body, actor, idempotency_key, False)

    @router.post("/applications/{application_id}/resubmit", operation_id="resubmit_application")
    async def resubmit(
        application_id: UUID, body: SubmitApplication, actor: Actor, idempotency_key: Key
    ):
        return await submit_change(application_id, body, actor, idempotency_key, True)

    @router.post("/applications/{application_id}/cancel", operation_id="cancel_application")
    async def cancel(
        application_id: UUID, body: CancelApplication, actor: Actor, idempotency_key: Key
    ):
        async def mutate(conn, app, project, seller):
            before_event_end(project)
            if app["status"] not in CANCEL_STATES:
                raise DomainError(409, "INVALID_TRANSITION", "현재 상태에서는 취소할 수 없습니다.")
            # Future booth/communication workflows must extend this same atomic transaction.
            await conn.execute(
                "UPDATE public.applications SET status='CANCELLED',cancel_reason=%s,"
                "version=version+1,updated_at=now() WHERE application_id=%s",
                (body.reason, application_id),
            )
            await status_history(conn, app, actor.user_id, "CANCELLED", body.reason)

        return await change(
            application_id,
            body,
            actor,
            idempotency_key,
            "applications.cancel",
            "POST",
            "/cancel",
            mutate,
        )

    return router
