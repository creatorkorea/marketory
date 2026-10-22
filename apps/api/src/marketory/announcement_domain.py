"""Market-wide publication snapshots, independent from email delivery."""

from fastapi.encoders import jsonable_encoder

from marketory.errors import DomainError
from marketory.permissions import one, require_project
from marketory.projects import before_end


async def require_announcement(conn, actor, aid):
    ref = await one(
        conn, "SELECT project_id FROM public.market_announcements WHERE announcement_id=%s", (aid,)
    )
    if not ref:
        raise DomainError(404, "NOT_FOUND", "공통 안내를 찾을 수 없습니다.")
    project = await require_project(conn, actor, ref["project_id"], "operate")
    msg = await one(
        conn,
        "SELECT * FROM public.market_announcements WHERE announcement_id=%s FOR UPDATE",
        (aid,),
    )
    return msg, project


def announcement_data(msg, project):
    fields = (
        "announcement_id",
        "project_id",
        "subject",
        "body",
        "audience",
        "content_version",
        "version",
        "approved_version",
        "approved_at",
        "created_at",
        "updated_at",
    )
    result = {key: msg[key] for key in fields}
    result["publication"] = (
        dict(
            subject=msg["published_subject"],
            body=msg["published_body"],
            audience=msg["published_audience"],
            content_version=msg["published_content_version"],
            published_at=msg["published_at"],
            withdrawn_at=msg["withdrawn_at"],
        )
        if msg["published_at"]
        else None
    )
    actions = ["unpublish"] if msg["published_at"] and not msg["withdrawn_at"] else []
    try:
        before_end(project)
    except DomainError:
        pass
    else:
        actions.append("revise")
        if msg["approved_version"] != msg["content_version"]:
            actions.append("approve")
        elif msg["withdrawn_at"] or msg["published_content_version"] != msg["content_version"]:
            actions.append("publish")
    result["allowed_actions"] = actions
    return jsonable_encoder(result)
