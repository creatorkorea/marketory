"""Resend plain-text adapter. Never retain provider bodies or credentials in errors."""

from dataclasses import dataclass
from typing import Literal

import httpx

from marketory.config import Settings


@dataclass(frozen=True)
class DeliveryResult:
    status: Literal["SENT", "FAILED", "UNKNOWN"]
    provider_message_id: str | None = None
    error_code: str | None = None


class ResendProvider:
    def __init__(self, settings: Settings, *, transport=None):
        self.settings = settings
        self.transport = transport

    async def send(self, message: dict) -> DeliveryResult:
        key = self.settings.resend_api_key
        if not key or not key.get_secret_value().strip():
            return DeliveryResult("FAILED", error_code="PROVIDER_NOT_CONFIGURED")
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.email_timeout_seconds,
                transport=self.transport,
                follow_redirects=False,
            ) as client:
                response = await client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": "Bearer " + key.get_secret_value(),
                        "Idempotency-Key": str(message["idempotency_key"]),
                    },
                    json={
                        "from": message["sender_snapshot"],
                        "to": [message["recipient_snapshot"]],
                        "subject": message["subject"],
                        "text": message["body"],
                    },
                )
        except httpx.HTTPError:
            return DeliveryResult("UNKNOWN", error_code="PROVIDER_NETWORK_ERROR")
        if 200 <= response.status_code < 300:
            try:
                payload = response.json()
                mid = payload.get("id") if isinstance(payload, dict) else None
            except ValueError:
                mid = None
            if isinstance(mid, str) and mid.strip():
                return DeliveryResult("SENT", provider_message_id=mid)
            return DeliveryResult("UNKNOWN", error_code="PROVIDER_INVALID_RESPONSE")
        # Only definitive request rejection is safe to retry. Conflict and timeout
        # responses may describe an earlier accepted request with this same key.
        definitive = response.status_code in {400, 401, 403, 404, 405, 413, 415, 422, 429}
        return DeliveryResult(
            "FAILED" if definitive else "UNKNOWN",
            error_code=f"PROVIDER_HTTP_{response.status_code}",
        )
