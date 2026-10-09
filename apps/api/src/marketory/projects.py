"""Project configuration. Every write shares the request-result transaction."""

from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID, uuid5

from fastapi import APIRouter, Depends, Header
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from marketory.db import transaction
from marketory.errors import DomainError
from marketory.idempotency import Change, execute
from marketory.permissions import active_user, one, require_project

KST = timezone(timedelta(hours=9))
Status = Literal["DRAFT", "RECRUITING", "REVIEWING", "CLOSED", "COMPLETED"]
Text = Annotated[str, Field(min_length=1, max_length=2000)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Policy(Strict):
    schema_version: Literal[1] = 1
    allowed_categories: list[Text] = Field(max_length=50)
    restricted_items: list[Text] = Field(max_length=50)
    business_required: bool
    photo_required: bool
    participation_fee_krw: int = Field(ge=0, le=100000000)
    consent_version: str = Field(max_length=100)
    consent_text: str = Field(max_length=10000)


class Criterion(Strict):
    code: Annotated[str, Field(min_length=1, max_length=80)]
    weight: int = Field(gt=0, le=100)


class Evaluation(Strict):
    schema_version: Literal[1] = 1
    criteria: list[Criterion] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def weights(self):
        if sum(c.weight for c in self.criteria) != 100:
            raise ValueError("Weights must sum to 100")
        if len({c.code for c in self.criteria}) != len(self.criteria):
            raise ValueError("Duplicate criterion")
        return self


class BoothPolicy(Strict):
    schema_version: Literal[1] = 1
    description: str = Field(max_length=5000)


class ProjectInput(Strict):
    name: Annotated[str, Field(min_length=1, max_length=150)]
    venue: Annotated[str, Field(min_length=1, max_length=255)]
    event_date: date
    recruit_start_at: AwareDatetime
    recruit_end_at: AwareDatetime
    event_end_at: AwareDatetime
    target_team_count: int = Field(gt=0, le=100000)
    policy_json: Policy
    booth_policy_json: BoothPolicy
    evaluation_policy_json: Evaluation
    reason: Text

    @model_validator(mode="after")
    def dates(self):
        if not self.recruit_start_at < self.recruit_end_at <= self.event_end_at:
            raise ValueError("Invalid recruitment interval")
        if self.event_end_at.astimezone(KST).date() != self.event_date:
            raise ValueError("Event end must fall on the KST event date")
        return self


class ProjectUpdate(ProjectInput):
    expected_version: int = Field(gt=0)


class Transition(Strict):
    expected_version: int = Field(gt=0)
    status: Status
    reason: Text


class MemberInput(Strict):
    expected_version: int = Field(gt=0)
    email: Annotated[str, Field(min_length=3, max_length=255)]
    role: Literal["OPERATOR", "REVIEWER", "VIEWER"]
    active: bool
    reason: Text


async def require_admin(conn, actor):
    user = await active_user(conn, actor)
    if user["global_role"] != "PLATFORM_ADMIN":
        raise DomainError(403, "FORBIDDEN", "플랫폼 관리자만 권한을 배정할 수 있습니다.")
    return user


async def require_creator(conn, actor):
    user = await active_user(conn, actor)
    if user["global_role"] == "PLATFORM_ADMIN":
        return
    member = await one(
        conn,
        "SELECT m.project_member_id FROM public.project_members m "
        "JOIN public.projects p USING(project_id) WHERE m.user_id=%s "
        "AND m.active AND m.role='OPERATOR' AND p.deleted_at IS NULL "
        "ORDER BY m.project_id LIMIT 1 FOR SHARE OF m",
        (actor,),
    )
    if user["account_role"] != "STAFF" or not member:
        raise DomainError(403, "FORBIDDEN", "마켓 생성 권한이 없습니다.")


def version_matches(project, expected):
    if project["version"] != expected:
        raise DomainError(
            409, "VERSION_CONFLICT", "다른 변경이 있습니다. 최신 내용을 확인해 주세요."
        )


def before_end(project):
    if project["status"] == "COMPLETED" or datetime.now(timezone.utc) >= project["event_end_at"]:
        raise DomainError(409, "EVENT_ENDED", "행사가 종료되어 변경할 수 없습니다.")


def publishable(project):
    policy = project["policy_json"]
    if (
        not policy.get("allowed_categories")
        or not policy.get("consent_version")
        or not policy.get("consent_text")
        or not project.get("booth_policy_json", {}).get("description")
        or not project["evaluation_policy_json"].get("criteria")
    ):
        raise DomainError(
            422, "PUBLISH_REQUIREMENTS", "품목·동의 문구·심사·부스 조건을 입력해 주세요."
        )
    if datetime.now(timezone.utc) >= project["recruit_end_at"]:
        raise DomainError(422, "RECRUITMENT_ENDED", "미래의 모집 마감 시간을 설정해 주세요.")


async def audit(conn, actor, project_id, action, before, after, reason):
    await conn.execute(
        "INSERT INTO public.audit_logs(project_id,actor_user_id,action,entity_type,"
        "entity_id,before_json,after_json,reason) VALUES(%s,%s,%s,'project',%s,%s,%s,%s)",
        (
            project_id,
            actor,
            action,
            project_id,
            Jsonb(jsonable_encoder(before)),
            Jsonb(jsonable_encoder(after)),
            reason,
        ),
    )


def project_router(settings, identity):
    router = APIRouter()
    Actor = Annotated[object, Depends(identity)]
    Key = Annotated[UUID, Header(alias="Idempotency-Key")]

    @router.get("/projects/{project_id}/settings", operation_id="project_settings")
    async def get_settings(project_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            project = await require_project(conn, actor.user_id, project_id, "operate")
            return {"data": jsonable_encoder(project)}

    @router.post("/projects", operation_id="create_project", status_code=201)
    async def create(body: ProjectInput, actor: Actor, idempotency_key: Key):
        pid = uuid5(actor.user_id, "projects.create:" + str(idempotency_key))
        async with transaction(settings) as conn:

            async def authorize():
                await require_creator(conn, actor.user_id)
                if await one(
                    conn, "SELECT project_id FROM public.projects WHERE project_id=%s", (pid,)
                ):
                    await require_project(conn, actor.user_id, pid, "operate")

            async def mutate():
                data = body.model_dump(mode="json", exclude={"reason"})
                if body.event_end_at <= datetime.now(timezone.utc):
                    raise DomainError(422, "EVENT_ENDED", "미래의 행사 종료 시간을 입력해 주세요.")
                await conn.execute(
                    "INSERT INTO public.projects(project_id,name,event_date,venue,"
                    "recruit_start_at,recruit_end_at,event_end_at,target_team_count,policy_json,"
                    "booth_policy_json,evaluation_policy_json,created_by) "
                    "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        pid,
                        body.name,
                        body.event_date,
                        body.venue,
                        body.recruit_start_at,
                        body.recruit_end_at,
                        body.event_end_at,
                        body.target_team_count,
                        Jsonb(data["policy_json"]),
                        Jsonb(data["booth_policy_json"]),
                        Jsonb(data["evaluation_policy_json"]),
                        actor.user_id,
                    ),
                )
                user = await active_user(conn, actor.user_id)
                if user["account_role"] != "STAFF":
                    await conn.execute(
                        "UPDATE public.users SET account_role='STAFF',updated_at=now() "
                        "WHERE user_id=%s",
                        (actor.user_id,),
                    )
                    await audit(
                        conn,
                        actor.user_id,
                        pid,
                        "PROJECT_CREATOR_STAFF",
                        {"account_role": user["account_role"]},
                        {"account_role": "STAFF"},
                        body.reason,
                    )
                await conn.execute(
                    "INSERT INTO public.project_members(project_id,user_id,role) "
                    "VALUES(%s,%s,'OPERATOR')",
                    (pid, actor.user_id),
                )
                project = await one(
                    conn, "SELECT * FROM public.projects WHERE project_id=%s", (pid,)
                )
                await audit(conn, actor.user_id, pid, "PROJECT_CREATED", None, project, body.reason)
                return Change(jsonable_encoder(project), 201, "project", pid)

            result = await execute(
                conn,
                actor.user_id,
                "projects.create",
                idempotency_key,
                "POST",
                "/api/projects",
                "project",
                pid,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    async def change(project_id, body, actor, key, operation, method, path, mutate_fn, admin=False):
        async with transaction(settings) as conn:
            project = None

            async def authorize():
                nonlocal project
                if admin:
                    await require_admin(conn, actor.user_id)
                project = await require_project(conn, actor.user_id, project_id, "operate")

            async def mutate():
                version_matches(project, body.expected_version)
                after = await mutate_fn(conn, project)
                await audit(
                    conn, actor.user_id, project_id, operation.upper(), project, after, body.reason
                )
                return Change(
                    jsonable_encoder(after), resource_type="project", resource_id=project_id
                )

            result = await execute(
                conn,
                actor.user_id,
                operation,
                key,
                method,
                path,
                "project",
                project_id,
                body.model_dump(mode="json"),
                authorize,
                mutate,
            )
        return JSONResponse(result.body, status_code=result.status)

    @router.patch("/projects/{project_id}", operation_id="update_project")
    async def update(project_id: UUID, body: ProjectUpdate, actor: Actor, idempotency_key: Key):
        async def mutate(conn, project):
            before_end(project)
            if project["status"] == "CLOSED":
                raise DomainError(409, "PROJECT_CLOSED", "재검토를 시작한 뒤 설정을 수정해 주세요.")
            data = body.model_dump(mode="json", exclude={"expected_version", "reason"})
            if body.event_end_at <= datetime.now(timezone.utc):
                raise DomainError(422, "EVENT_ENDED", "미래의 행사 종료 시간을 입력해 주세요.")
            occupied = await one(
                conn,
                "SELECT count(*) AS n FROM public.applications WHERE project_id=%s "
                "AND deleted_at IS NULL AND status IN ('APPROVED','CONFIRMED')",
                (project_id,),
            )
            if occupied["n"] > body.target_team_count:
                raise DomainError(
                    409, "CAPACITY_CONFLICT", "선정·확정 인원보다 정원을 줄일 수 없습니다."
                )
            deadline = await one(
                conn,
                "SELECT application_id FROM public.applications WHERE project_id=%s "
                "AND deleted_at IS NULL AND (info_due_at >= %s OR confirm_due_at >= %s) LIMIT 1",
                (project_id, body.event_end_at, body.event_end_at),
            )
            if deadline:
                raise DomainError(
                    409,
                    "DEADLINE_CONFLICT",
                    "기존 보완·확정 기한 이후로 행사 종료를 설정해 주세요.",
                )
            if project["status"] == "RECRUITING":
                publishable({**data, "recruit_end_at": body.recruit_end_at})
            changed_policy = any(
                project[k] != data[k]
                for k in ("policy_json", "booth_policy_json", "evaluation_policy_json")
            )
            await conn.execute(
                "UPDATE public.projects SET name=%s,event_date=%s,venue=%s,"
                "recruit_start_at=%s,recruit_end_at=%s,event_end_at=%s,target_team_count=%s,"
                "policy_json=%s,booth_policy_json=%s,evaluation_policy_json=%s,"
                "version=version+1,policy_version=policy_version+%s,updated_at=now() "
                "WHERE project_id=%s",
                (
                    body.name,
                    body.event_date,
                    body.venue,
                    body.recruit_start_at,
                    body.recruit_end_at,
                    body.event_end_at,
                    body.target_team_count,
                    Jsonb(data["policy_json"]),
                    Jsonb(data["booth_policy_json"]),
                    Jsonb(data["evaluation_policy_json"]),
                    int(changed_policy),
                    project_id,
                ),
            )
            return await one(
                conn, "SELECT * FROM public.projects WHERE project_id=%s", (project_id,)
            )

        return await change(
            project_id,
            body,
            actor,
            idempotency_key,
            "projects.update",
            "PATCH",
            f"/api/projects/{project_id}",
            mutate,
        )

    @router.post("/projects/{project_id}/status", operation_id="transition_project")
    async def transition(project_id: UUID, body: Transition, actor: Actor, idempotency_key: Key):
        async def mutate(conn, project):
            allowed = {
                "DRAFT": {"RECRUITING"},
                "RECRUITING": {"REVIEWING"},
                "REVIEWING": {"RECRUITING", "CLOSED"},
                "CLOSED": {"REVIEWING", "COMPLETED"},
            }
            if body.status not in allowed.get(project["status"], set()):
                raise DomainError(
                    409, "INVALID_TRANSITION", "현재 상태에서 사용할 수 없는 변경입니다."
                )
            if body.status == "COMPLETED":
                if datetime.now(timezone.utc) < project["event_end_at"]:
                    raise DomainError(
                        409, "EVENT_NOT_ENDED", "행사 종료 시간 이후 최종 종료할 수 있습니다."
                    )
            else:
                before_end(project)
            if body.status == "RECRUITING":
                publishable(project)
                if project["status"] == "REVIEWING" and project["recruit_start_at"] <= datetime.now(
                    timezone.utc
                ):
                    raise DomainError(
                        422, "NEW_RECRUITMENT_PERIOD", "재모집의 새 시작 시간을 설정해 주세요."
                    )
            await conn.execute(
                "UPDATE public.projects SET status=%s,version=version+1,updated_at=now() "
                "WHERE project_id=%s",
                (body.status, project_id),
            )
            return await one(
                conn, "SELECT * FROM public.projects WHERE project_id=%s", (project_id,)
            )

        return await change(
            project_id,
            body,
            actor,
            idempotency_key,
            "projects.status",
            "POST",
            f"/api/projects/{project_id}/status",
            mutate,
        )

    @router.get("/projects/{project_id}/members", operation_id="project_members")
    async def members(project_id: UUID, actor: Actor):
        async with transaction(settings) as conn:
            await require_admin(conn, actor.user_id)
            await require_project(conn, actor.user_id, project_id)
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    "SELECT m.user_id,u.email,m.role,m.active FROM public.project_members m "
                    "JOIN public.users u USING(user_id) WHERE m.project_id=%s ORDER BY u.email",
                    (project_id,),
                )
                return {"data": jsonable_encoder(await cur.fetchall())}

    @router.post("/projects/{project_id}/members", operation_id="assign_project_member")
    async def assign(project_id: UUID, body: MemberInput, actor: Actor, idempotency_key: Key):
        async def mutate(conn, project):
            before_end(project)
            user = await one(
                conn,
                "SELECT * FROM public.users WHERE lower(email)=%s FOR UPDATE",
                (body.email.lower(),),
            )
            if not user or user["status"] != "ACTIVE":
                raise DomainError(
                    422, "MEMBER_NOT_READY", "먼저 이메일 인증과 계정 생성을 완료해 주세요."
                )
            previous = await one(
                conn,
                "SELECT role,active FROM public.project_members WHERE project_id=%s AND user_id=%s",
                (project_id, user["user_id"]),
            )
            if not body.active and not previous:
                raise DomainError(422, "MEMBER_NOT_FOUND", "배정된 운영자가 아닙니다.")
            if body.active:
                await conn.execute(
                    "UPDATE public.users SET account_role='STAFF',updated_at=now() "
                    "WHERE user_id=%s",
                    (user["user_id"],),
                )
            await conn.execute(
                "INSERT INTO public.project_members(project_id,user_id,role,active) "
                "VALUES(%s,%s,%s,%s) ON CONFLICT(project_id,user_id) "
                "DO UPDATE SET role=EXCLUDED.role,active=EXCLUDED.active",
                (project_id, user["user_id"], body.role, body.active),
            )
            await conn.execute(
                "UPDATE public.projects SET version=version+1,updated_at=now() WHERE project_id=%s",
                (project_id,),
            )
            await audit(
                conn,
                actor.user_id,
                project_id,
                "MEMBER_ASSIGNED",
                {
                    "user_id": user["user_id"],
                    "account_role": user["account_role"],
                    "membership": previous,
                },
                {"user_id": user["user_id"], "role": body.role, "active": body.active},
                body.reason,
            )
            return await one(
                conn, "SELECT * FROM public.projects WHERE project_id=%s", (project_id,)
            )

        return await change(
            project_id,
            body,
            actor,
            idempotency_key,
            "projects.members",
            "POST",
            f"/api/projects/{project_id}/members",
            mutate,
            admin=True,
        )

    @router.get("/public/projects/{project_id}", operation_id="public_project")
    async def public(project_id: UUID):
        async with transaction(settings) as conn:
            p = await one(
                conn,
                "SELECT * FROM public.projects WHERE project_id=%s "
                "AND deleted_at IS NULL AND status<>'DRAFT'",
                (project_id,),
            )
            if not p:
                raise DomainError(404, "NOT_FOUND", "공개된 마켓을 찾을 수 없습니다.")
            data = {
                k: p[k]
                for k in (
                    "project_id",
                    "name",
                    "venue",
                    "event_date",
                    "event_end_at",
                    "recruit_start_at",
                    "recruit_end_at",
                    "target_team_count",
                    "status",
                    "policy_version",
                    "policy_json",
                    "booth_policy_json",
                )
            }
            now = datetime.now(timezone.utc)
            data["accepting_applications"] = (
                p["status"] == "RECRUITING"
                and p["recruit_start_at"] <= now < p["recruit_end_at"]
                and now < p["event_end_at"]
            )
            return {"data": jsonable_encoder(data)}

    return router
