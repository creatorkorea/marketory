import hashlib
import json
from dataclasses import dataclass
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb

from marketory.errors import DomainError
from marketory.permissions import active_user, authorize_result, one


@dataclass
class Change:
    data: dict
    status: int = 200
    resource_type: str | None = None
    resource_id: UUID | None = None


@dataclass
class Result:
    status: int
    body: dict


def expired_error():
    return DomainError(
        410, "REQUEST_RESULT_EXPIRED", "요청 결과 보관기간이 끝났습니다. 현재 상태를 확인해 주세요."
    )


async def lock_key(conn, actor, operation, key):
    digest = hashlib.sha256(f"{actor}:{operation}:{key}".encode()).digest()
    lock = int.from_bytes(digest[:8], "big", signed=True)
    await conn.execute("SET LOCAL lock_timeout='5s'")
    await conn.execute("SELECT pg_advisory_xact_lock(%s)", (lock,))


async def get_row(conn, actor, operation, key):
    return await one(
        conn,
        "SELECT * FROM public.api_idempotency WHERE actor_user_id=%s "
        "AND operation=%s AND idempotency_key=%s FOR UPDATE",
        (actor, operation, key),
    )


async def execute(
    conn, actor, operation, key, method, path, target_type, target_id, body, authorize, mutate
):
    await lock_key(conn, actor, operation, key)
    row = await get_row(conn, actor, operation, key)
    if row and row["status"] == "EXPIRED":
        raise expired_error()
    await authorize()
    request_hash = hashlib.sha256(
        json.dumps(
            [method.upper(), path.rstrip("/"), str(target_id), body],
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    if row:
        if row["status"] == "IN_PROGRESS":
            raise DomainError(409, "NEEDS_OPERATOR_REVIEW", "요청 결과를 운영자가 확인해야 합니다.")
        if row["request_hash"] != request_hash:
            raise DomainError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 키의 내용이 다릅니다.")
        return Result(row["http_status"], row["response_json"])
    request_id = uuid4()
    await conn.execute(
        """INSERT INTO public.api_idempotency
        (request_id,actor_user_id,operation,idempotency_key,request_hash,status,resource_type,resource_id)
        VALUES (%s,%s,%s,%s,%s,'IN_PROGRESS',%s,%s)""",
        (request_id, actor, operation, key, request_hash, target_type, target_id),
    )
    try:
        async with conn.transaction():
            change = await mutate()
        status = change.status
        response = {"data": change.data, "request_id": str(request_id)}
        state = "SUCCEEDED"
        target_type = change.resource_type or target_type
        target_id = change.resource_id or target_id
    except DomainError as error:
        if not 400 <= error.status < 500:
            raise
        status, response, state = error.status, error.body(request_id), "FAILED"
    await conn.execute(
        """UPDATE public.api_idempotency SET status=%s,response_json=%s,http_status=%s,
        resource_type=%s,resource_id=%s,updated_at=now() WHERE request_id=%s""",
        (state, Jsonb(response), status, target_type, target_id, request_id),
    )
    return Result(status, response)


async def lookup(conn, actor, operation, key):
    user = await one(conn, "SELECT user_id FROM public.users WHERE user_id=%s FOR SHARE", (actor,))
    if user or operation != "auth.bootstrap":
        await active_user(conn, actor)
    await lock_key(conn, actor, operation, key)
    row = await get_row(conn, actor, operation, key)
    if not row:
        return Result(
            202,
            {
                "code": "UNRESOLVED",
                "message": "기존 키와 본문으로 결과를 확인해 주세요.",
                "details": [],
                "request_id": str(uuid4()),
            },
        )
    if row["status"] == "EXPIRED":
        raise expired_error()
    await authorize_result(conn, actor, row)
    if row["status"] == "IN_PROGRESS":
        raise DomainError(409, "NEEDS_OPERATOR_REVIEW", "요청 결과를 운영자가 확인해야 합니다.")
    return Result(
        200,
        {
            "outcome": row["status"],
            "http_status": row["http_status"],
            "response": row["response_json"],
            "resource_id": str(row["resource_id"]) if row["resource_id"] else None,
            "request_id": str(row["request_id"]),
        },
    )


async def expire(conn, actor, operation, key, cutoff):
    """Internal maintenance; no scheduler/public route until retention is approved."""
    await lock_key(conn, actor, operation, key)
    row = await get_row(conn, actor, operation, key)
    if not row or row["status"] == "EXPIRED":
        return False
    if row["status"] not in ("SUCCEEDED", "FAILED") or row["resource_type"] not in (
        None,
        "user",
        "project",
    ):
        raise DomainError(409, "RESOURCE_NOT_TERMINAL", "연결된 작업 결과 확인이 필요합니다.")
    result = await conn.execute(
        """UPDATE public.api_idempotency SET status='EXPIRED',
        response_json=NULL,request_hash=NULL,resource_type=NULL,resource_id=NULL,http_status=NULL,
        expired_at=now(),updated_at=now() WHERE request_id=%s AND updated_at < %s::timestamptz""",
        (row["request_id"], cutoff),
    )
    return result.rowcount == 1
