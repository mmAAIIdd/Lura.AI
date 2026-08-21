from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.supabase import SupabaseIdentityError
from app.models import OAuthAccount, User, UserStatus
from app.routers import auth as auth_router
from tests.helpers import create_active_user

SUBJECT = "6f1d1f2e-6d1a-4a8f-9c3c-0d1b2a3c4d5e"


def supabase_profile(**overrides: Any) -> dict[str, Any]:
    profile = {
        "id": SUBJECT,
        "email": "supabase.person@example.com",
        "email_confirmed_at": "2026-08-20T10:00:00Z",
        "user_metadata": {"full_name": "Supabase Person"},
    }
    profile.update(overrides)
    return profile


class StubSupabaseIdentity:
    """Stands in for Supabase's /auth/v1/user check."""

    def __init__(self, profile: dict[str, Any] | None = None, *, configured: bool = True) -> None:
        self._profile = profile
        self.configured = configured
        self.seen_tokens: list[str] = []

    async def get_user(self, access_token: str) -> dict[str, Any]:
        self.seen_tokens.append(access_token)
        if self._profile is None:
            raise SupabaseIdentityError("Supabase rejected the access token")
        return self._profile


def use_identity(monkeypatch: pytest.MonkeyPatch, stub: StubSupabaseIdentity) -> StubSupabaseIdentity:
    monkeypatch.setattr(auth_router, "supabase_identity", stub)
    return stub


async def exchange(client: httpx.AsyncClient, token: str = "supabase-access-token-value") -> httpx.Response:
    return await client.post("/api/v1/auth/supabase/session", json={"access_token": token})


async def test_exchange_creates_account_and_opens_a_session(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = use_identity(monkeypatch, StubSupabaseIdentity(supabase_profile()))

    response = await exchange(client)

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "supabase.person@example.com"
    assert body["name"] == "Supabase Person"
    assert body["email_verified"] is True
    assert body["status"] == "active"
    assert stub.seen_tokens == ["supabase-access-token-value"]

    assert "lura_session" in response.cookies
    assert "lura_csrf" in response.cookies

    # The session cookie must actually authenticate the follow-up request.
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "supabase.person@example.com"

    async with db_session_factory() as db:
        link = await db.scalar(select(OAuthAccount).where(OAuthAccount.provider == "supabase"))
        assert link is not None
        assert link.provider_account_id == SUBJECT


async def test_repeat_exchange_reuses_the_same_account(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_identity(monkeypatch, StubSupabaseIdentity(supabase_profile()))

    first = await exchange(client)
    second = await exchange(client)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]

    async with db_session_factory() as db:
        users = (await db.scalars(select(User))).all()
        links = (await db.scalars(select(OAuthAccount))).all()
    assert len(users) == 1
    assert len(links) == 1


async def test_exchange_links_an_existing_local_account_by_email(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing = await create_active_user(db_session_factory, "supabase.person@example.com")
    use_identity(monkeypatch, StubSupabaseIdentity(supabase_profile()))

    response = await exchange(client)

    assert response.status_code == 200
    assert response.json()["id"] == str(existing.id)

    async with db_session_factory() as db:
        users = (await db.scalars(select(User))).all()
    assert len(users) == 1


async def test_unconfirmed_supabase_email_is_refused(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_identity(monkeypatch, StubSupabaseIdentity(supabase_profile(email_confirmed_at=None)))

    response = await exchange(client)

    assert response.status_code == 403
    assert "lura_session" not in response.cookies
    async with db_session_factory() as db:
        assert (await db.scalars(select(User))).all() == []


async def test_rejected_token_yields_unauthorized(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_identity(monkeypatch, StubSupabaseIdentity(None))

    response = await exchange(client)

    assert response.status_code == 401
    assert "lura_session" not in response.cookies


async def test_suspended_account_cannot_open_a_session(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_active_user(db_session_factory, "supabase.person@example.com")
    async with db_session_factory() as db:
        suspended = await db.get(User, user.id)
        assert suspended is not None
        suspended.status = UserStatus.SUSPENDED
        await db.commit()

    use_identity(monkeypatch, StubSupabaseIdentity(supabase_profile()))

    response = await exchange(client)

    assert response.status_code == 403
    assert "lura_session" not in response.cookies


async def test_unconfigured_server_reports_unavailable(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_identity(monkeypatch, StubSupabaseIdentity(supabase_profile(), configured=False))

    response = await exchange(client)

    assert response.status_code == 503


async def test_status_reports_whether_supabase_is_configured(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_identity(monkeypatch, StubSupabaseIdentity(supabase_profile(), configured=False))
    assert (await client.get("/api/v1/auth/supabase/status")).json() == {"configured": False}

    use_identity(monkeypatch, StubSupabaseIdentity(supabase_profile(), configured=True))
    assert (await client.get("/api/v1/auth/supabase/status")).json() == {"configured": True}
