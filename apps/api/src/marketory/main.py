import asyncio
from collections.abc import Awaitable, Callable
from typing import Literal

import psycopg
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from marketory.auth import SupabaseAuthenticator
from marketory.config import Settings
from marketory.db import check_database
from marketory.errors import DomainError
from marketory.routes import build_router


class Health(BaseModel):
    status: Literal["ok", "unavailable"]


def create_app(
    settings: Settings | None = None,
    probe: Callable[[], Awaitable[bool]] | None = None,
    authenticator=None,
    storage=None,
) -> FastAPI:
    config = settings if settings is not None else Settings()
    if (authenticator is not None or storage is not None) and config.environment != "test":
        raise ValueError("Dependency overrides are only allowed in tests")
    app = FastAPI(title="MARKETORY API", version="0.1.0")
    app.include_router(
        build_router(config, authenticator or SupabaseAuthenticator(config).verify, storage)
    )

    @app.middleware("http")
    async def private_responses(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request, error):
        headers = {"Retry-After": "2"} if error.code == "REQUEST_IN_PROGRESS" else {}
        return JSONResponse(error.body(), status_code=error.status, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse(
            DomainError(422, "INVALID_INPUT", "요청 형식을 확인해 주세요.").body(), status_code=422
        )

    @app.exception_handler(psycopg.Error)
    async def database_error(request, error):
        if isinstance(error, psycopg.errors.LockNotAvailable):
            return JSONResponse(
                DomainError(409, "REQUEST_IN_PROGRESS", "같은 키로 다시 확인해 주세요.").body(),
                status_code=409,
                headers={"Retry-After": "2"},
            )
        if isinstance(error, psycopg.errors.UniqueViolation):
            return JSONResponse(
                DomainError(409, "CONFLICT", "기존 정보를 확인해 주세요.").body(), status_code=409
            )
        return JSONResponse(
            DomainError(
                503, "DATABASE_UNAVAILABLE", "잠시 후 같은 요청으로 다시 확인해 주세요."
            ).body(),
            status_code=503,
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @app.get("/health/live", response_model=Health, operation_id="health_live")
    async def live():
        return Health(status="ok")

    @app.get(
        "/health/ready",
        response_model=Health,
        operation_id="health_ready",
        responses={503: {"model": Health}},
    )
    async def ready(response: Response):
        try:
            healthy = await asyncio.wait_for(
                probe() if probe else check_database(config),
                timeout=5,
            )
        except Exception:
            healthy = False
        response.headers["Cache-Control"] = "no-store"
        response.status_code = 200 if healthy else 503
        return Health(status="ok" if healthy else "unavailable")

    return app


app = create_app()
