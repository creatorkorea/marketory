"""Transactional manual booth resources, proposals and atomic confirmation."""

from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import Field, model_validator

from marketory.booth_domain import (
    BOOTH_FIELDS,
    board_data,
    compatible,
    increment_project,
    lock_board,
    release_rows,
    require_booth,
    require_target,
)
from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute
from marketory.projects import Strict, Text, audit, before_end, version_matches
from marketory.review_domain import review_project


class BoothChange(Strict):
    expected_version: int = Field(gt=0)
    reason: Text


class BoothInput(BoothChange):
    booth_no: str = Field(min_length=1, max_length=30)
    zone: str | None = Field(default=None, max_length=50)
    electricity_available: bool
    fire_allowed: bool
    cold_storage_available: bool
    vehicle_access: bool
    table_capacity: int | None = Field(default=None, ge=0, le=2147483647)
    note: str | None = Field(default=None, max_length=5000)
    status: Literal["AVAILABLE", "BLOCKED"]


class DraftItem(Strict):
    application_id: UUID
    booth_id: UUID
    expected_application_version: int = Field(gt=0)


class BoothDraft(BoothChange):
    items: list[DraftItem] = Field(max_length=1000)

    @model_validator(mode="after")
    def unique_targets(self):
        if len({r.application_id for r in self.items}) != len(self.items) or len(
            {r.booth_id for r in self.items}
        ) != len(self.items):
            raise ValueError("Duplicate application or booth target")
        return self


class BoothRelease(BoothChange):
    application_id: UUID
    expected_application_version: int = Field(gt=0)


def booth_router(settings, identity):
    router = APIRouter()
    Actor = Annotated[object, Depends(identity)]
    Key = Annotated[UUID, Header(alias="Idempotency-Key")]

    @router.get("/projects/{project_id}/booths", operation_id="booth_board")
    async def get_board(project_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            project, role = await review_project(conn, actor.user_id, project_id)
            return {"data": await board_data(conn, project, role)}

    async def change(pid, body, actor, key, operation, method, path, mutate, status=200):
        async with transaction(settings) as conn:
            project = None

            async def authorize():
                nonlocal project
                project, _ = await review_project(conn, actor.user_id, pid, "operate")

            async def apply():
                version_matches(project, body.expected_version)
                before_end(project)
                apps, booths, assignments = await lock_board(conn, pid)
                before = await board_data(conn, project, "OPERATOR")
                await mutate(conn, project, apps, booths, assignments)
                after_project = await increment_project(conn, pid)
                after = await board_data(conn, after_project, "OPERATOR")
                await audit(conn, actor.user_id, pid, operation.upper(), before, after, body.reason)
                return Change(after, status, "project", pid)

            result = await execute(
                conn,
                actor.user_id,
                operation,
                key,
                method,
                path,
                "project",
                pid,
                body.model_dump(mode="json"),
                authorize,
                apply,
            )
        return JSONResponse(result.body, status_code=result.status)

    async def save_booth(pid, bid, body, actor, key):
        async def mutate(conn, project, apps, booths, assignments):
            data = body.model_dump(exclude={"expected_version", "reason"})
            if bid:
                require_booth(booths, bid)
                for row in assignments:
                    if row["booth_id"] == bid and row["confirmed"]:
                        compatible(project, require_target(apps, row["application_id"]), data)
            if any(
                b["booth_no"] == body.booth_no and b["booth_id"] != bid for b in booths.values()
            ):
                raise DomainError(409, "BOOTH_NUMBER_EXISTS", "이미 등록된 부스 번호입니다.")
            fields = [f for f in BOOTH_FIELDS if f not in {"booth_id", "project_id", "version"}]
            if bid:
                await conn.execute(
                    "UPDATE public.booths SET "
                    + ",".join(f"{f}=%s" for f in fields)
                    + ",version=version+1,updated_at=now() WHERE booth_id=%s",
                    tuple(data[f] for f in fields) + (bid,),
                )
            else:
                await conn.execute(
                    "INSERT INTO public.booths(project_id,"
                    + ",".join(fields)
                    + ") VALUES("
                    + ",".join(["%s"] * (len(fields) + 1))
                    + ")",
                    (pid,) + tuple(data[f] for f in fields),
                )

        suffix = f"/{bid}" if bid else ""
        return await change(
            pid,
            body,
            actor,
            key,
            "booths.update" if bid else "booths.create",
            "PATCH" if bid else "POST",
            f"/api/projects/{pid}/booths{suffix}",
            mutate,
            200 if bid else 201,
        )

    @router.post("/projects/{project_id}/booths", operation_id="create_booth", status_code=201)
    async def create(project_id: UUID, body: BoothInput, actor: Actor, idempotency_key: Key):
        return await save_booth(project_id, None, body, actor, idempotency_key)

    @router.patch("/projects/{project_id}/booths/{booth_id}", operation_id="update_booth")
    async def update(
        project_id: UUID, booth_id: UUID, body: BoothInput, actor: Actor, idempotency_key: Key
    ):
        return await save_booth(project_id, booth_id, body, actor, idempotency_key)

    @router.post("/projects/{project_id}/booth-draft", operation_id="save_booth_draft")
    async def draft(project_id: UUID, body: BoothDraft, actor: Actor, idempotency_key: Key):
        async def mutate(conn, project, apps, booths, assignments):
            for item in body.items:
                app = require_target(apps, item.application_id, item.expected_application_version)
                compatible(project, app, require_booth(booths, item.booth_id))
            await release_rows(
                conn,
                [r["assignment_id"] for r in assignments if not r["confirmed"]],
                actor.user_id,
                body.reason,
            )
            operation_id = uuid4()
            for item in body.items:
                await conn.execute(
                    "INSERT INTO public.booth_assignments(project_id,application_id,booth_id,"
                    "source,"
                    "reason,assigned_by,input_application_version,input_booth_version,"
                    "operation_id) "
                    "VALUES(%s,%s,%s,'MANUAL',%s,%s,%s,%s,%s)",
                    (
                        project_id,
                        item.application_id,
                        item.booth_id,
                        body.reason,
                        actor.user_id,
                        item.expected_application_version,
                        booths[item.booth_id]["version"],
                        operation_id,
                    ),
                )

        return await change(
            project_id,
            body,
            actor,
            idempotency_key,
            "booths.draft",
            "POST",
            f"/api/projects/{project_id}/booth-draft",
            mutate,
        )

    @router.post("/projects/{project_id}/booth-confirm", operation_id="confirm_booth_draft")
    async def confirm(project_id: UUID, body: BoothChange, actor: Actor, idempotency_key: Key):
        async def mutate(conn, project, apps, booths, assignments):
            pending = [r for r in assignments if not r["confirmed"]]
            if not pending:
                raise DomainError(409, "NO_BOOTH_DRAFT", "확정할 임시 배치가 없습니다.")
            aids = {r["application_id"] for r in pending}
            bids = {r["booth_id"] for r in pending}
            if len(aids) != len(pending) or len(bids) != len(pending):
                raise DomainError(409, "BOOTH_CONFLICT", "중복 배치가 있습니다.")
            for row in pending:
                app = require_target(apps, row["application_id"], row["input_application_version"])
                booth = require_booth(booths, row["booth_id"])
                version_matches(booth, row["input_booth_version"])
                compatible(project, app, booth)
            if any(
                r["confirmed"] and r["booth_id"] in bids and r["application_id"] not in aids
                for r in assignments
            ):
                raise DomainError(
                    409, "BOOTH_OCCUPIED", "변경 대상 밖의 셀러가 부스를 사용 중입니다."
                )
            await release_rows(
                conn,
                [
                    r["assignment_id"]
                    for r in assignments
                    if r["confirmed"] and r["application_id"] in aids
                ],
                actor.user_id,
                body.reason,
            )
            await conn.execute(
                "UPDATE public.booth_assignments SET confirmed=true,confirmed_at=now(),"
                "assigned_by=%s,reason=%s,version=version+1 WHERE assignment_id=ANY(%s)",
                (actor.user_id, body.reason, [r["assignment_id"] for r in pending]),
            )
            await conn.execute(
                "UPDATE public.applications SET version=version+1,updated_at=now() "
                "WHERE application_id=ANY(%s)",
                (list(aids),),
            )

        return await change(
            project_id,
            body,
            actor,
            idempotency_key,
            "booths.confirm",
            "POST",
            f"/api/projects/{project_id}/booth-confirm",
            mutate,
        )

    @router.post("/projects/{project_id}/booth-release", operation_id="release_booth")
    async def release(project_id: UUID, body: BoothRelease, actor: Actor, idempotency_key: Key):
        async def mutate(conn, project, apps, booths, assignments):
            require_target(apps, body.application_id, body.expected_application_version)
            targets = [
                r["assignment_id"]
                for r in assignments
                if r["application_id"] == body.application_id
            ]
            if not targets:
                raise DomainError(409, "NO_BOOTH_ASSIGNMENT", "해제할 배치가 없습니다.")
            await release_rows(conn, targets, actor.user_id, body.reason)
            await conn.execute(
                "UPDATE public.applications SET version=version+1,updated_at=now() "
                "WHERE application_id=%s",
                (body.application_id,),
            )

        return await change(
            project_id,
            body,
            actor,
            idempotency_key,
            "booths.release",
            "POST",
            f"/api/projects/{project_id}/booth-release",
            mutate,
        )

    return router
