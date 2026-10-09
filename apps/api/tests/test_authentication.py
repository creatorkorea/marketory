from uuid import uuid4

import httpx
import pytest

from marketory.auth import SupabaseAuthenticator
from marketory.config import Settings
from marketory.errors import DomainError
from marketory.runtime import run_async


def test_provider_identity_ignores_metadata_and_rejects_unconfirmed():
    user_id = uuid4()

    async def scenario():
        for confirmed, expected in [("2026-10-09T00:00:00Z", True), (None, False)]:

            def handle(request):
                assert request.headers["Authorization"] == "Bearer signed-token"
                return httpx.Response(
                    200,
                    json={
                        "id": str(user_id),
                        "email": "owner@test.invalid",
                        "email_confirmed_at": confirmed,
                        "user_metadata": {"role": "PLATFORM_ADMIN"},
                    },
                )

            verifier = SupabaseAuthenticator(
                Settings(
                    supabase_url="https://test.supabase.co", supabase_publishable_key="test-key"
                ),
                transport=httpx.MockTransport(handle),
            )
            if expected:
                identity = await verifier.verify("signed-token")
                assert identity.user_id == user_id
                assert not hasattr(identity, "role")
            else:
                with pytest.raises(DomainError) as failure:
                    await verifier.verify("signed-token")
                assert failure.value.status == 401

    run_async(scenario())


@pytest.mark.parametrize(
    "provider_status,expected", [(401, 401), (403, 401), (429, 503), (500, 503)]
)
def test_invalid_token_and_provider_failure_are_distinct(provider_status, expected):
    async def scenario():
        verifier = SupabaseAuthenticator(
            Settings(supabase_url="https://test.supabase.co", supabase_publishable_key="test-key"),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(provider_status, text="private-provider-detail")
            ),
        )
        with pytest.raises(DomainError) as failure:
            await verifier.verify("forged-or-expired")
        assert failure.value.status == expected
        assert "private-provider-detail" not in str(failure.value)

    run_async(scenario())


@pytest.mark.parametrize(
    "state",
    [
        {"banned_until": "2100-01-01T00:00:00Z"},
        {"deleted_at": "2026-10-09T00:00:00Z"},
        {"is_anonymous": True},
    ],
)
def test_inactive_provider_identity_is_rejected(state):
    async def scenario():
        verifier = SupabaseAuthenticator(
            Settings(supabase_url="https://test.supabase.co", supabase_publishable_key="test-key"),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "id": str(uuid4()),
                        "email": "x@test.invalid",
                        "email_confirmed_at": "2026-10-09T00:00:00Z",
                        **state,
                    },
                )
            ),
        )
        with pytest.raises(DomainError) as failure:
            await verifier.verify("signed-token")
        assert failure.value.status == 401

    run_async(scenario())
