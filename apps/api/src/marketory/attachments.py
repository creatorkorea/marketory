"""Private immutable uploads; linking an object is a versioned database transaction."""

import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import Field

from marketory.application_domain import (
    application_audit,
    editable_application,
    require_application,
)
from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute, lock_key
from marketory.permissions import active_user, one, require_project
from marketory.projects import Strict, version_matches
from marketory.storage import MAX_BYTES, POLICY, Storage, inspect_file

KINDS = {"product_images": "PRODUCT_IMAGE", "business_document": "BUSINESS_DOC"}


class Issue(Strict):
    application_id: UUID
    field_code: Literal["product_images", "business_document"]
    original_name: str = Field(min_length=1, max_length=255)
    mime_type: Literal["image/jpeg", "image/png", "image/webp", "application/pdf"]
    size_bytes: int = Field(gt=0, le=MAX_BYTES)
    expected_version: int = Field(gt=0)
    expected_revision_no: int = Field(gt=0)


class Complete(Strict):
    upload_intent_id: UUID
    expected_version: int = Field(gt=0)
    expected_revision_no: int = Field(gt=0)


class Version(Strict):
    expected_version: int = Field(gt=0)


class Detach(Version):
    reason: str = Field(min_length=1, max_length=2000)


def check_version(app, version, revision=None):
    version_matches(app, version)
    if revision is not None and app["revision_no"] != revision:
        raise DomainError(409, "VERSION_CONFLICT", "최신 신청서를 확인해 주세요.")


def check_intent(intent, app, project):
    if intent["status"] == "COMPLETED":
        raise DomainError(409, "ALREADY_COMPLETED", "이미 연결한 파일입니다.")
    if intent["status"] != "ISSUED" or intent["expires_at"] <= datetime.now(timezone.utc):
        raise DomainError(410, "UPLOAD_EXPIRED", "업로드 유효기간이 지났습니다.")
    editable_application(app, project, {intent["field_code"]})
    check_version(app, intent["expected_application_version"], intent["expected_revision_no"])


async def find_intent(conn, actor, intent_id):
    # Lookup only discovers parent; always lock parent before locking intent.
    found = await one(
        conn,
        "SELECT application_id FROM public.upload_intents "
        "WHERE upload_intent_id=%s AND requested_by=%s",
        (intent_id, actor),
    )
    if not found:
        raise DomainError(404, "NOT_FOUND", "업로드 요청을 찾을 수 없습니다.")
    app, project, seller = await require_application(conn, actor, found["application_id"], "edit")
    intent = await one(
        conn,
        "SELECT * FROM public.upload_intents WHERE upload_intent_id=%s "
        "AND requested_by=%s FOR UPDATE",
        (intent_id, actor),
    )
    return intent, app, project, seller


async def capacity(conn, app, field, include_pending=False):
    row = await one(
        conn,
        "SELECT count(*) AS n FROM public.attachments WHERE application_id=%s "
        "AND file_type=%s AND deleted_at IS NULL",
        (app["application_id"], KINDS[field]),
    )
    count = row["n"]
    if include_pending:
        pending = await one(
            conn,
            "SELECT count(*) AS n FROM public.upload_intents "
            "WHERE application_id=%s AND field_code=%s AND status='ISSUED'",
            (app["application_id"], field),
        )
        count += pending["n"]
    if count >= (10 if field == "product_images" else 1):
        raise DomainError(422, "FILE_LIMIT", "첨부 개수 제한을 확인해 주세요.")


async def bump(conn, app):
    return await one(
        conn,
        "UPDATE public.applications SET version=version+1,"
        "revision_no=revision_no+1,updated_at=now() WHERE application_id=%s "
        "RETURNING version,revision_no",
        (app["application_id"],),
    )


def attachment_router(settings, identity, storage=None):
    router = APIRouter()
    provider = storage or Storage(settings)
    Actor = Annotated[object, Depends(identity)]
    Key = Annotated[UUID, Header(alias="Idempotency-Key")]

    @router.get("/attachments/policy", operation_id="attachment_policy")
    async def policy():
        api_url = urlsplit(settings.public_api_url)
        return {"data": {**POLICY, "upload_origin": f"{api_url.scheme}://{api_url.netloc}"}}

    @router.post("/attachments/upload-url", operation_id="issue_upload")
    async def issue(body: Issue, actor: Actor, idempotency_key: Key):
        async with transaction(settings) as conn:
            app = project = None

            async def authorize():
                nonlocal app, project
                app, project, _ = await require_application(
                    conn, actor.user_id, body.application_id, "edit"
                )

            async def mutate():
                provider.configured()
                editable_application(app, project, {body.field_code})
                check_version(app, body.expected_version, body.expected_revision_no)
                if body.field_code == "product_images" and body.mime_type == "application/pdf":
                    raise DomainError(422, "INVALID_FILE", "상품 사진은 이미지 파일이어야 합니다.")
                await capacity(conn, app, body.field_code, True)
                intent_id = uuid4()
                storage_key = f"applications/{app['application_id']}/{uuid4()}"
                expires = datetime.now(timezone.utc) + timedelta(
                    seconds=settings.upload_intent_ttl_seconds
                )
                await conn.execute(
                    "INSERT INTO public.upload_intents(upload_intent_id,storage_key,application_id,"
                    "field_code,requested_by,expected_application_version,expected_revision_no,"
                    "original_name,mime_type,size_bytes,max_size_bytes,expires_at) "
                    "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        intent_id,
                        storage_key,
                        app["application_id"],
                        body.field_code,
                        actor.user_id,
                        app["version"],
                        app["revision_no"],
                        body.original_name,
                        body.mime_type,
                        body.size_bytes,
                        MAX_BYTES,
                        expires,
                    ),
                )
                await application_audit(
                    conn,
                    actor.user_id,
                    app,
                    "ATTACHMENTS.ISSUE",
                    None,
                    {"upload_intent_id": str(intent_id), "field": body.field_code},
                    None,
                )
                return Change(
                    jsonable_encoder(
                        {
                            "upload_intent_id": intent_id,
                            "upload_url": settings.public_api_url.rstrip("/")
                            + f"/api/attachments/uploads/{intent_id}",
                            "expires_at": expires,
                            "application_version": app["version"],
                            "revision_no": app["revision_no"],
                        }
                    )
                )

            result = await execute(
                conn,
                actor.user_id,
                "attachments.issue",
                idempotency_key,
                "POST",
                "/api/attachments/upload-url",
                "application",
                body.application_id,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.put("/attachments/uploads/{intent_id}", operation_id="upload_bytes")
    async def upload(intent_id: UUID, request: Request, actor: Actor):
        async with transaction(settings) as conn:
            intent, app, project, _ = await find_intent(conn, actor.user_id, intent_id)
            check_intent(intent, app, project)
        content = bytearray()
        try:
            async with asyncio.timeout(120):
                async for chunk in request.stream():
                    content.extend(chunk)
                    if len(content) > MAX_BYTES:
                        raise DomainError(413, "FILE_TOO_LARGE", "파일은 10MiB 이하여야 합니다.")
        except TimeoutError:
            raise DomainError(408, "UPLOAD_TIMEOUT", "파일 전송 시간이 초과되었습니다.") from None
        raw = bytes(content)
        if (
            len(raw) != intent["size_bytes"]
            or request.headers.get("content-type", "").split(";")[0] != intent["mime_type"]
        ):
            raise DomainError(422, "INVALID_FILE", "선택한 파일과 업로드 파일이 다릅니다.")
        inspect_file(raw, intent["mime_type"], intent["field_code"])
        digest = hashlib.sha256(raw).hexdigest()
        if intent["content_sha256"] and intent["content_sha256"] != digest:
            raise DomainError(409, "UPLOAD_IMMUTABLE", "기존 업로드의 파일을 바꿀 수 없습니다.")
        # Recover a successful provider write whose response/DB commit was lost.
        try:
            existing = await provider.read(intent["storage_key"])
        except DomainError as error:
            if error.code != "FILE_NOT_UPLOADED":
                raise
            await provider.upload(intent["storage_key"], raw, intent["mime_type"])
        else:
            if hashlib.sha256(existing).hexdigest() != digest:
                raise DomainError(409, "UPLOAD_IMMUTABLE", "기존 업로드의 파일을 바꿀 수 없습니다.")
        async with transaction(settings) as conn:
            intent, app, project, _ = await find_intent(conn, actor.user_id, intent_id)
            check_intent(intent, app, project)
            await conn.execute(
                "UPDATE public.upload_intents SET content_sha256=%s,"
                "uploaded_at=coalesce(uploaded_at,now()) "
                "WHERE upload_intent_id=%s",
                (digest, intent_id),
            )
        return {"data": {"upload_intent_id": str(intent_id), "uploaded": True}}

    @router.post("/attachments/complete", operation_id="complete_upload")
    async def complete(body: Complete, actor: Actor, idempotency_key: Key):
        async with transaction(settings) as conn:
            await lock_key(conn, actor.user_id, "attachments.complete", idempotency_key)
            intent, app, project, _ = await find_intent(conn, actor.user_id, body.upload_intent_id)

            async def authorize():
                await active_user(conn, actor.user_id)

            async def mutate():
                check_intent(intent, app, project)
                check_version(app, body.expected_version, body.expected_revision_no)
                raw = await provider.read(intent["storage_key"])
                inspect_file(raw, intent["mime_type"], intent["field_code"])
                if (
                    len(raw) != intent["size_bytes"]
                    or hashlib.sha256(raw).hexdigest() != intent["content_sha256"]
                ):
                    raise DomainError(422, "INVALID_FILE", "파일 무결성을 확인할 수 없습니다.")
                await capacity(conn, app, intent["field_code"])
                aid = uuid4()
                await conn.execute(
                    "INSERT INTO public.attachments(attachment_id,application_id,file_type,"
                    "storage_key,original_name,mime_type,size_bytes,uploaded_by) "
                    "VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        aid,
                        app["application_id"],
                        KINDS[intent["field_code"]],
                        intent["storage_key"],
                        intent["original_name"],
                        intent["mime_type"],
                        len(raw),
                        actor.user_id,
                    ),
                )
                await conn.execute(
                    "UPDATE public.upload_intents SET status='COMPLETED',attachment_id=%s "
                    "WHERE upload_intent_id=%s",
                    (aid, body.upload_intent_id),
                )
                versions = await bump(conn, app)
                await application_audit(
                    conn,
                    actor.user_id,
                    app,
                    "ATTACHMENTS.COMPLETE",
                    None,
                    {"attachment_id": str(aid), **versions},
                    None,
                )
                return Change(
                    {
                        "attachment_id": str(aid),
                        "application_version": versions["version"],
                        "revision_no": versions["revision_no"],
                    }
                )

            result = await execute(
                conn,
                actor.user_id,
                "attachments.complete",
                idempotency_key,
                "POST",
                "/api/attachments/complete",
                "application",
                app["application_id"],
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.post("/attachments/uploads/{intent_id}/abandon", operation_id="abandon_upload")
    async def abandon(intent_id: UUID, body: Version, actor: Actor, idempotency_key: Key):
        async with transaction(settings) as conn:
            await lock_key(conn, actor.user_id, "attachments.abandon", idempotency_key)
            intent, app, project, _ = await find_intent(conn, actor.user_id, intent_id)

            async def authorize():
                await active_user(conn, actor.user_id)

            async def mutate():
                check_version(app, body.expected_version)
                if intent["status"] == "COMPLETED":
                    raise DomainError(409, "ALREADY_COMPLETED", "이미 연결한 파일입니다.")
                await conn.execute(
                    "UPDATE public.upload_intents SET status='REJECTED' WHERE upload_intent_id=%s",
                    (intent_id,),
                )
                await application_audit(
                    conn,
                    actor.user_id,
                    app,
                    "ATTACHMENTS.ABANDON",
                    None,
                    {"upload_intent_id": str(intent_id)},
                    "업로드 선택 취소",
                )
                return Change(
                    {"application_version": app["version"], "revision_no": app["revision_no"]}
                )

            result = await execute(
                conn,
                actor.user_id,
                "attachments.abandon",
                idempotency_key,
                "POST",
                f"/api/attachments/uploads/{intent_id}/abandon",
                "application",
                app["application_id"],
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.post("/attachments/{attachment_id}/detach", operation_id="detach_attachment")
    async def detach(attachment_id: UUID, body: Detach, actor: Actor, idempotency_key: Key):
        async with transaction(settings) as conn:
            await lock_key(conn, actor.user_id, "attachments.detach", idempotency_key)
            found = await one(
                conn,
                "SELECT application_id FROM public.attachments WHERE attachment_id=%s",
                (attachment_id,),
            )
            if not found:
                raise DomainError(404, "NOT_FOUND", "첨부를 찾을 수 없습니다.")
            app, project, _ = await require_application(
                conn, actor.user_id, found["application_id"], "edit"
            )

            async def authorize():
                await active_user(conn, actor.user_id)

            async def mutate():
                file = await one(
                    conn,
                    "SELECT * FROM public.attachments WHERE attachment_id=%s "
                    "AND deleted_at IS NULL FOR UPDATE",
                    (attachment_id,),
                )
                if not file or file["file_type"] not in KINDS.values():
                    raise DomainError(404, "NOT_FOUND", "첨부를 찾을 수 없습니다.")
                field = next(k for k, v in KINDS.items() if v == file["file_type"])
                editable_application(app, project, {field})
                check_version(app, body.expected_version)
                await conn.execute(
                    "UPDATE public.attachments SET deleted_at=now() WHERE attachment_id=%s",
                    (attachment_id,),
                )
                versions = await bump(conn, app)
                await application_audit(
                    conn,
                    actor.user_id,
                    app,
                    "ATTACHMENTS.DETACH",
                    {"attachment_id": str(attachment_id)},
                    versions,
                    body.reason,
                )
                return Change(
                    {
                        "attachment_id": str(attachment_id),
                        "application_version": versions["version"],
                        "revision_no": versions["revision_no"],
                    }
                )

            result = await execute(
                conn,
                actor.user_id,
                "attachments.detach",
                idempotency_key,
                "POST",
                f"/api/attachments/{attachment_id}/detach",
                "application",
                app["application_id"],
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.get("/attachments/{attachment_id}/download", operation_id="download_attachment")
    async def download(attachment_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            await active_user(conn, actor.user_id)
            file = await one(
                conn,
                "SELECT t.*,a.project_id,s.user_id FROM public.attachments t "
                "JOIN public.applications a ON a.application_id=t.application_id "
                "JOIN public.sellers s ON s.seller_id=a.seller_id "
                "WHERE t.attachment_id=%s AND t.deleted_at IS NULL AND a.deleted_at IS NULL",
                (attachment_id,),
            )
            if not file:
                raise DomainError(404, "NOT_FOUND", "첨부를 찾을 수 없습니다.")
            if file["user_id"] != actor.user_id:
                await require_project(
                    conn,
                    actor.user_id,
                    file["project_id"],
                    "review" if file["file_type"] == "PRODUCT_IMAGE" else "operate",
                )
            url = await provider.signed_url(file["storage_key"])
        return {"data": {"url": url, "expires_in": 300}}

    return router
