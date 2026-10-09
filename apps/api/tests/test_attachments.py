from datetime import datetime, timezone
from io import BytesIO
from uuid import UUID

import psycopg
from fastapi.testclient import TestClient
from PIL import Image
from test_applications import draft, setup
from test_p1_p3 import isolated_db  # noqa: F401
from test_projects import headers

from marketory.auth import Identity
from marketory.config import Settings
from marketory.errors import DomainError
from marketory.main import create_app


class MemoryStorage:
    def __init__(self):
        self.files = {}

    def configured(self):
        pass

    async def upload(self, key, content, mime):
        if key in self.files:
            raise DomainError(503, "STORAGE_UNAVAILABLE", "unavailable")
        self.files[key] = content

    async def read(self, key):
        if key not in self.files:
            raise DomainError(404, "FILE_NOT_UPLOADED", "missing")
        return self.files[key]

    async def signed_url(self, key):
        return "https://storage.test.invalid/signed?token=short-lived"


def client_for(dsn, storage):
    async def verify(token):
        return Identity(UUID(token), "seller@test.invalid", datetime.now(timezone.utc))

    return TestClient(
        create_app(
            Settings(environment="test", database_url=dsn), authenticator=verify, storage=storage
        ),
        backend_options={"loop_factory": __import__("asyncio").SelectorEventLoop},
    )


def png():
    stream = BytesIO()
    Image.new("RGB", (2, 2)).save(stream, format="PNG")
    return stream.getvalue()


def issue(c, actor, app, **changes):
    return c.post(
        "/api/attachments/upload-url",
        headers=headers(actor),
        json={
            "application_id": app["application_id"],
            "field_code": "product_images",
            "original_name": "photo.png",
            "mime_type": "image/png",
            "size_bytes": len(png()),
            "expected_version": app["version"],
            "expected_revision_no": app["revision_no"],
            **changes,
        },
    )


def test_attachment_atomic_complete_replay_ownership_and_detach(isolated_db):  # noqa: F811
    outsider, actor, project = setup(isolated_db)
    with psycopg.connect(isolated_db) as conn:
        conn.execute("DELETE FROM public.project_members WHERE user_id=%s", (outsider,))
    storage = MemoryStorage()
    with client_for(isolated_db, storage) as c:
        app = draft(c, actor, project)
        issued = issue(c, actor, app)
        assert issued.status_code == 200, issued.text
        intent = issued.json()["data"]
        upload = intent["upload_url"]
        assert c.put(upload, headers=headers(outsider), content=png()).status_code == 404
        assert (
            c.put(
                upload, headers={**headers(actor), "Content-Type": "image/png"}, content=png()
            ).status_code
            == 200
        )
        assert (
            c.put(
                upload, headers={**headers(actor), "Content-Type": "image/png"}, content=png()
            ).status_code
            == 200
        )
        body = {
            "upload_intent_id": intent["upload_intent_id"],
            "expected_version": 1,
            "expected_revision_no": 1,
        }
        h = headers(actor)
        completed = c.post("/api/attachments/complete", headers=h, json=body)
        assert completed.status_code == 200, completed.text
        data = completed.json()["data"]
        assert (data["application_version"], data["revision_no"]) == (2, 2)
        assert c.post("/api/attachments/complete", headers=h, json=body).json() == completed.json()
        assert (
            c.post("/api/attachments/complete", headers=headers(actor), json=body).json()["code"]
            == "ALREADY_COMPLETED"
        )
        aid = data["attachment_id"]
        assert (
            c.get(f"/api/attachments/{aid}/download", headers=headers(outsider)).status_code == 404
        )
        assert c.get(f"/api/attachments/{aid}/download", headers=headers(actor)).status_code == 200
        detail = c.get(f"/api/applications/{app['application_id']}", headers=headers(actor))
        assert "storage_key" not in detail.text
        assert (
            c.post(
                f"/api/attachments/{aid}/detach",
                headers=headers(actor),
                json={"expected_version": 1, "reason": "교체"},
            ).status_code
            == 409
        )
        detached = c.post(
            f"/api/attachments/{aid}/detach",
            headers=headers(actor),
            json={"expected_version": 2, "reason": "교체"},
        )
        assert detached.status_code == 200, detached.text
        assert detached.json()["data"]["revision_no"] == 3
        assert len(storage.files) == 1  # no unapproved object deletion


def test_upload_spoof_stale_intent_and_abandon(isolated_db):  # noqa: F811
    _, actor, project = setup(isolated_db)
    storage = MemoryStorage()
    with client_for(isolated_db, storage) as c:
        app = draft(c, actor, project)
        intent = issue(c, actor, app).json()["data"]
        assert (
            c.put(
                intent["upload_url"],
                headers={**headers(actor), "Content-Type": "image/png"},
                content=b"fake",
            ).status_code
            == 422
        )
        assert not storage.files
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.applications SET version=version+1,revision_no=revision_no+1 "
                "WHERE application_id=%s",
                (app["application_id"],),
            )
        assert (
            c.put(
                intent["upload_url"],
                headers={**headers(actor), "Content-Type": "image/png"},
                content=png(),
            ).status_code
            == 409
        )
        failed = c.post(
            "/api/attachments/complete",
            headers=headers(actor),
            json={
                "upload_intent_id": intent["upload_intent_id"],
                "expected_version": 2,
                "expected_revision_no": 2,
            },
        )
        assert failed.status_code == 409, failed.text
        abandoned = c.post(
            f"/api/attachments/uploads/{intent['upload_intent_id']}/abandon",
            headers=headers(actor),
            json={"expected_version": 2},
        )
        assert abandoned.status_code == 200, abandoned.text
        with psycopg.connect(isolated_db) as conn:
            assert (
                conn.execute("SELECT status FROM public.upload_intents").fetchone()[0] == "REJECTED"
            )


def test_file_download_roles_and_revocation(isolated_db):  # noqa: F811
    staff, actor, project = setup(isolated_db)
    with client_for(isolated_db, MemoryStorage()) as c:
        app = draft(c, actor, project)
        files = []
        for field in ("product_images", "business_document"):
            intent = issue(c, actor, app, field_code=field).json()["data"]
            assert (
                c.put(
                    intent["upload_url"],
                    headers={**headers(actor), "Content-Type": "image/png"},
                    content=png(),
                ).status_code
                == 200
            )
            reply = c.post(
                "/api/attachments/complete",
                headers=headers(actor),
                json={
                    "upload_intent_id": intent["upload_intent_id"],
                    "expected_version": app["version"],
                    "expected_revision_no": app["revision_no"],
                },
            )
            assert reply.status_code == 200
            files.append(reply.json()["data"]["attachment_id"])
            app = c.get(
                f"/api/applications/{app['application_id']}", headers=headers(actor)
            ).json()["data"]
        for role, expected in (
            ("OPERATOR", (200, 200)),
            ("REVIEWER", (200, 403)),
            ("VIEWER", (403, 403)),
        ):
            with psycopg.connect(isolated_db) as conn:
                conn.execute(
                    "UPDATE public.project_members SET role=%s WHERE project_id=%s AND user_id=%s",
                    (role, project, staff),
                )
            assert (
                tuple(
                    c.get(f"/api/attachments/{file}/download", headers=headers(staff)).status_code
                    for file in files
                )
                == expected
            )
        with psycopg.connect(isolated_db) as conn:
            conn.execute(
                "UPDATE public.project_members SET active=false WHERE user_id=%s", (staff,)
            )
        assert (
            c.get(f"/api/attachments/{files[0]}/download", headers=headers(staff)).status_code
            == 404
        )


def test_expired_and_cancelled_uploads_cannot_complete(isolated_db):  # noqa: F811
    _, actor, project = setup(isolated_db)
    with client_for(isolated_db, MemoryStorage()) as c:
        app = draft(c, actor, project)
        intent = issue(c, actor, app).json()["data"]
        with psycopg.connect(isolated_db) as conn:
            conn.execute("UPDATE public.upload_intents SET expires_at=now()-interval '1 second'")
        assert c.put(intent["upload_url"], headers=headers(actor), content=png()).status_code == 410
        assert (
            c.post(
                f"/api/attachments/uploads/{intent['upload_intent_id']}/abandon",
                headers=headers(actor),
                json={"expected_version": 1},
            ).status_code
            == 200
        )
        intent = issue(c, actor, app).json()["data"]
        assert (
            c.put(
                intent["upload_url"],
                headers={**headers(actor), "Content-Type": "image/png"},
                content=png(),
            ).status_code
            == 200
        )
        assert (
            c.post(
                f"/api/applications/{app['application_id']}/cancel",
                headers=headers(actor),
                json={"expected_version": 1, "reason": "테스트 취소"},
            ).status_code
            == 200
        )
        result = c.post(
            "/api/attachments/complete",
            headers=headers(actor),
            json={
                "upload_intent_id": intent["upload_intent_id"],
                "expected_version": 2,
                "expected_revision_no": 1,
            },
        )
        assert result.status_code == 409
        with psycopg.connect(isolated_db) as conn:
            assert conn.execute("SELECT count(*) FROM public.attachments").fetchone()[0] == 0
