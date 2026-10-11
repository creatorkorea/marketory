import json

import httpx
import pytest

from marketory.config import Settings
from marketory.email_provider import ResendProvider
from marketory.runtime import run_async

MESSAGE = dict(
    sender_snapshot="Original <original@test.invalid>",
    recipient_snapshot="recipient@test.invalid",
    subject="제목",
    body="본문",
    idempotency_key="stable-key",
)


@pytest.mark.parametrize(
    ("code", "payload", "status"),
    [
        (200, {"id": "email-id"}, "SENT"),
        (201, {"id": "email-id"}, "SENT"),
        (200, {}, "UNKNOWN"),
        (200, {"id": 1}, "UNKNOWN"),
        (200, [], "UNKNOWN"),
        (400, {}, "FAILED"),
        (401, {}, "FAILED"),
        (403, {}, "FAILED"),
        (422, {}, "FAILED"),
        (429, {}, "FAILED"),
        (408, {}, "UNKNOWN"),
        (409, {"name": "concurrent_idempotent_requests"}, "UNKNOWN"),
        (409, {"name": "invalid_idempotent_request"}, "UNKNOWN"),
        (500, {}, "UNKNOWN"),
        (503, {}, "UNKNOWN"),
        (302, {}, "UNKNOWN"),
    ],
)
def test_resend_payload_and_classification(code, payload, status):
    def handler(request):
        assert str(request.url) == "https://api.resend.com/emails"
        assert request.headers["idempotency-key"] == "stable-key"
        assert request.headers["authorization"] == "Bearer test-secret"
        assert json.loads(request.content) == {
            "from": MESSAGE["sender_snapshot"],
            "to": [MESSAGE["recipient_snapshot"]],
            "subject": "제목",
            "text": "본문",
        }
        return httpx.Response(code, json=payload)

    config = Settings(
        _env_file=None, resend_api_key="test-secret", email_from="changed@test.invalid"
    )
    result = run_async(ResendProvider(config, transport=httpx.MockTransport(handler)).send(MESSAGE))
    assert result.status == status
    assert result.provider_message_id == ("email-id" if status == "SENT" else None)
    assert "test-secret" not in repr(result) and "recipient@test.invalid" not in repr(result)


def test_network_and_invalid_json_are_unknown():
    for response in ("network", "bad-json"):

        def handler(request):
            if response == "network":
                raise httpx.ReadTimeout("secret recipient@test.invalid", request=request)
            return httpx.Response(200, text="not-json")

        config = Settings(_env_file=None, resend_api_key="test-secret")
        result = run_async(
            ResendProvider(config, transport=httpx.MockTransport(handler)).send(MESSAGE)
        )
        assert result.status == "UNKNOWN" and "recipient" not in repr(result)


def test_safe_defaults_and_timeout_validation():
    config = Settings(_env_file=None)
    assert config.email_delivery_enabled is False
    assert config.email_from == "마켓토리 <marketory@send.creatorkorea.org>"
    assert config.email_timeout_seconds == 15 and config.email_claim_timeout_seconds == 120
    with pytest.raises(ValueError):
        Settings(_env_file=None, email_timeout_seconds=15, email_claim_timeout_seconds=15)


def test_missing_key_never_calls_transport():
    def handler(request):
        pytest.fail("Missing key must never issue a provider request")

    config = Settings(_env_file=None, resend_api_key=None)
    result = run_async(ResendProvider(config, transport=httpx.MockTransport(handler)).send(MESSAGE))
    assert result.status == "FAILED" and result.error_code == "PROVIDER_NOT_CONFIGURED"
