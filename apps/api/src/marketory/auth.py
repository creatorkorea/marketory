from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

import httpx

from marketory.config import Settings
from marketory.errors import DomainError


@dataclass(frozen=True)
class Identity:
    user_id: UUID
    email: str


class SupabaseAuthenticator:
    """Auth server verifies signature/expiry; no unverified JWT claims are consumed."""

    def __init__(self, settings: Settings, transport=None):
        self.settings, self.transport = settings, transport

    async def verify(self, token: str) -> Identity:
        if not self.settings.supabase_url or not self.settings.supabase_publishable_key:
            raise DomainError(503, "AUTH_UNAVAILABLE", "인증 서비스 연결이 필요합니다.")
        try:
            async with httpx.AsyncClient(
                timeout=5, transport=self.transport, follow_redirects=False
            ) as client:
                response = await client.get(
                    self.settings.supabase_url.rstrip("/") + "/auth/v1/user",
                    headers={
                        "Authorization": "Bearer " + token,
                        "apikey": self.settings.supabase_publishable_key.get_secret_value(),
                    },
                )
        except httpx.HTTPError:
            raise DomainError(
                503, "AUTH_UNAVAILABLE", "인증 서비스에 연결하지 못했습니다."
            ) from None
        if response.status_code in (401, 403):
            raise DomainError(401, "INVALID_SESSION", "다시 로그인해 주세요.")
        if response.status_code != 200:
            raise DomainError(503, "AUTH_UNAVAILABLE", "인증 서비스 응답을 확인하지 못했습니다.")
        try:
            user = response.json()
            banned = user.get("banned_until")
            if (
                user.get("deleted_at")
                or user.get("is_anonymous")
                or not user.get("email_confirmed_at")
                or (
                    banned
                    and datetime.fromisoformat(banned.replace("Z", "+00:00"))
                    > datetime.now(timezone.utc)
                )
            ):
                raise ValueError("Inactive identity")
            email = user["email"]
            if not isinstance(email, str) or not email or len(email) > 255:
                raise ValueError("Invalid email")
            return Identity(UUID(user["id"]), email)
        except (ValueError, KeyError, TypeError, AttributeError):
            raise DomainError(
                401, "INVALID_SESSION", "확인된 이메일 계정으로 다시 로그인해 주세요."
            ) from None
