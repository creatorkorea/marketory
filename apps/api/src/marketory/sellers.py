"""Reusable seller profile; identity and role are always server owned."""

import re
from typing import Annotated
from uuid import UUID, uuid5

from fastapi import APIRouter, Depends, Header, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from pydantic import Field, field_validator

from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute
from marketory.permissions import active_user, one
from marketory.projects import Strict

PROFILE_FIELDS = (
    "seller_id",
    "user_id",
    "shop_name",
    "owner_name",
    "phone",
    "business_no",
    "sns_url",
    "base_category",
    "base_product_desc",
    "version",
)


class SellerInput(Strict):
    expected_version: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=80)
    shop_name: str = Field(min_length=1, max_length=150)
    owner_name: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=1, max_length=30)
    business_no: str | None = Field(default=None, max_length=30)
    sns_url: str | None = Field(default=None, max_length=500)
    base_category: str | None = Field(default=None, max_length=50)
    base_product_desc: str | None = Field(default=None, max_length=10000)

    @field_validator("phone", "business_no")
    @classmethod
    def normalize_number(cls, value):
        if value is None or not value:
            return None
        if not re.fullmatch(r"[0-9+()\s-]+", value):
            raise ValueError("숫자와 구분 기호만 입력해 주세요.")
        normalized = re.sub(r"[^0-9]", "", value)
        if not normalized:
            raise ValueError("번호를 입력해 주세요.")
        return normalized

    @field_validator("sns_url")
    @classmethod
    def safe_url(cls, value):
        if value and not value.startswith(("https://", "http://")):
            raise ValueError("http 또는 https 주소를 입력해 주세요.")
        return value


async def seller_profile(conn, actor):
    seller = await one(conn, "SELECT * FROM public.sellers WHERE user_id=%s FOR SHARE", (actor,))
    if not seller:
        return None
    user = await one(conn, "SELECT name FROM public.users WHERE user_id=%s", (actor,))
    return {**{k: seller[k] for k in PROFILE_FIELDS}, "name": user["name"]}


def seller_router(settings, identity):
    router = APIRouter()
    Actor = Annotated[object, Depends(identity)]
    Key = Annotated[UUID, Header(alias="Idempotency-Key")]

    @router.get("/me/seller", operation_id="seller_profile")
    async def read(actor: Actor):
        async with transaction(settings) as conn:
            await active_user(conn, actor.user_id)
            return {"data": jsonable_encoder(await seller_profile(conn, actor.user_id))}

    @router.post("/me/seller", operation_id="create_seller_profile")
    @router.patch("/me/seller", operation_id="update_seller_profile")
    async def save(body: SellerInput, actor: Actor, idempotency_key: Key, request: Request):
        sid = uuid5(actor.user_id, "seller-profile")
        async with transaction(settings) as conn:

            async def authorize():
                await conn.execute(
                    "SELECT user_id FROM public.users WHERE user_id=%s FOR UPDATE", (actor.user_id,)
                )
                user = await active_user(conn, actor.user_id)
                if user["account_role"] != "SELLER":
                    raise DomainError(403, "FORBIDDEN", "셀러 계정만 프로필을 저장할 수 있습니다.")
                # Serializes first creation and name/profile changes across different keys.

            async def mutate():
                before = await seller_profile(conn, actor.user_id)
                if (before["version"] if before else 0) != body.expected_version:
                    raise DomainError(409, "VERSION_CONFLICT", "최신 프로필을 확인해 주세요.")
                values = body.model_dump(exclude={"name", "expected_version"})
                fields = tuple(values)
                if before:
                    await conn.execute(
                        "UPDATE public.sellers SET "
                        + ",".join(f"{k}=%s" for k in fields)
                        + ",version=version+1,updated_at=now() WHERE user_id=%s",
                        (*values.values(), actor.user_id),
                    )
                else:
                    await conn.execute(
                        "INSERT INTO public.sellers(seller_id,user_id,"
                        + ",".join(fields)
                        + ") VALUES("
                        + ",".join(["%s"] * (len(fields) + 2))
                        + ")",
                        (sid, actor.user_id, *values.values()),
                    )
                await conn.execute(
                    "UPDATE public.users SET name=%s,profile_completed_at=now(),"
                    "updated_at=now() WHERE user_id=%s",
                    (body.name, actor.user_id),
                )
                after = await seller_profile(conn, actor.user_id)
                await conn.execute(
                    "INSERT INTO public.audit_logs(actor_user_id,action,entity_type,"
                    "entity_id,before_json,after_json) VALUES(%s,'SELLERS.SAVE','seller',%s,%s,%s)",
                    (
                        actor.user_id,
                        after["seller_id"],
                        Jsonb(jsonable_encoder(before)),
                        Jsonb(jsonable_encoder(after)),
                    ),
                )
                return Change(
                    jsonable_encoder(after), resource_type="seller", resource_id=after["seller_id"]
                )

            result = await execute(
                conn,
                actor.user_id,
                "sellers.save",
                idempotency_key,
                request.method,
                "/api/me/seller",
                "seller",
                sid,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    return router
