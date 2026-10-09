from psycopg.rows import dict_row

from marketory.errors import DomainError


async def one(conn, query, params=()):
    async with conn.cursor(row_factory=dict_row) as cursor:
        await cursor.execute(query, params)
        return await cursor.fetchone()


async def active_user(conn, actor):
    user = await one(conn, "SELECT * FROM public.users WHERE user_id=%s FOR SHARE", (actor,))
    if not user:
        raise DomainError(403, "BOOTSTRAP_REQUIRED", "계정 초기 설정이 필요합니다.")
    if user["status"] != "ACTIVE":
        raise DomainError(403, "ACCOUNT_INACTIVE", "비활성 계정입니다.")
    return user


async def require_project(conn, actor, project_id, action="summary"):
    user = await active_user(conn, actor)
    lock = "FOR UPDATE" if action == "operate" else "FOR SHARE"
    project = await one(
        conn,
        "SELECT * FROM public.projects WHERE project_id=%s AND deleted_at IS NULL " + lock,
        (project_id,),
    )
    if not project:
        raise DomainError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.")
    if user["global_role"] == "PLATFORM_ADMIN":
        return project
    member = await one(
        conn,
        "SELECT role FROM public.project_members WHERE project_id=%s "
        "AND user_id=%s AND active FOR SHARE",
        (project_id, actor),
    )
    if user["account_role"] != "STAFF" or not member:
        raise DomainError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.")
    allowed = {
        "summary": {"OPERATOR", "REVIEWER", "VIEWER"},
        "review": {"OPERATOR", "REVIEWER"},
        "operate": {"OPERATOR"},
    }
    if member["role"] not in allowed.get(action, set()):
        raise DomainError(403, "FORBIDDEN", "이 작업에 필요한 권한이 없습니다.")
    return project


async def require_seller(conn, actor, seller_id):
    await active_user(conn, actor)
    seller = await one(
        conn,
        "SELECT seller_id FROM public.sellers WHERE seller_id=%s AND user_id=%s FOR SHARE",
        (seller_id, actor),
    )
    if not seller:
        raise DomainError(404, "NOT_FOUND", "셀러 정보를 찾을 수 없습니다.")


async def authorize_result(conn, actor, row):
    await active_user(conn, actor)
    if (
        row["operation"] == "auth.bootstrap"
        and row["resource_type"] == "user"
        and row["resource_id"] == actor
    ):
        return
    if row["operation"] == "projects.update" and row["resource_type"] == "project":
        await require_project(conn, actor, row["resource_id"], "operate")
        return
    raise DomainError(403, "FORBIDDEN", "이 요청 결과를 조회할 권한이 없습니다.")
