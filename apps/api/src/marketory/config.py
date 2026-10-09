from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MARKETORY_",
        env_file=Path(__file__).resolve().parents[2] / ".env",
        extra="ignore",
        hide_input_in_errors=True,
    )
    environment: Literal["local", "test", "preview", "production"] = "local"
    database_url: SecretStr | None = None
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    worker_poll_seconds: float = Field(default=10, ge=1, le=300)
    supabase_url: str | None = None
    supabase_publishable_key: SecretStr | None = None

    @model_validator(mode="after")
    def validate_environment(self):
        if self.supabase_url and not self.supabase_url.startswith("https://"):
            raise ValueError("Supabase authentication requires HTTPS")
        if self.database_url and not self.database_url.get_secret_value().strip():
            self.database_url = None
        if self.environment in {"preview", "production"}:
            if not self.database_url:
                raise ValueError("Database configuration required outside local/test")
            if "cors_origins" not in self.model_fields_set:
                raise ValueError("Explicit CORS origins required outside local/test")
            if not self.cors_origins or any(
                not origin.startswith("https://") or "*" in origin for origin in self.cors_origins
            ):
                raise ValueError("Use explicit HTTPS origins outside local/test")
        return self
