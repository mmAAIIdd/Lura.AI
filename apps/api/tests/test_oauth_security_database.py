from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import Request

from app import services
from app.auth.oauth import GoogleIdentity
from app.config import Settings
from app.main import app
from app.models import OAuthAccount, User, UserStatus
from app.routers import auth as auth_router
from app.security import hash_password
from tests.helpers import VALID_PASSWORD, create_active_user, csrf_headers, login


@pytest.mark.asyncio
async def test_google_oauth_creates_user_and_reuses_linked_account(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = GoogleIdentity(
        provider_account_id="google-subject-1",
        email="google@example.com",
        name="Google User",
        avatar_url="https://example.com/avatar.png",
    )

    async def exchange(_code: str, verifier: str) -> GoogleIdentity:
        assert verifier
        return identity

    monkeypatch.setattr(auth_router.google_oauth, "exchange", exchange)

    async def complete_oauth() -> httpx.Response:
        start = await client.get("/api/v1/auth/oauth/google/start")
        assert start.status_code == 302
        state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
        return await client.get(
            "/api/v1/auth/oauth/google/callback",
            params={"code": "valid-code", "state": state},
        )

    first = await complete_oauth()
    assert first.status_code == 303
    assert first.headers["location"].endswith("dashboard")
    await client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    second = await complete_oauth()
    assert second.status_code == 303

    async with db_session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(User)) == 1
        assert await db.scalar(select(func.count()).select_from(OAuthAccount)) == 1


@pytest.mark.asyncio
async def test_google_oauth_links_existing_verified_email_without_duplicate_user(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing_user = await create_active_user(db_session_factory, "linked@example.com")

    async def exchange(_code: str, _verifier: str) -> GoogleIdentity:
        return GoogleIdentity(
            provider_account_id="google-linked-subject",
            email=existing_user.email,
            name="Linked User",
            avatar_url=None,
        )

    monkeypatch.setattr(auth_router.google_oauth, "exchange", exchange)
    start = await client.get("/api/v1/auth/oauth/google/start")
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    callback = await client.get(
        "/api/v1/auth/oauth/google/callback",
        params={"code": "valid-code", "state": state},
    )
    assert callback.status_code == 303

    async with db_session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(User)) == 1
        account = await db.scalar(select(OAuthAccount))
        assert account is not None
        assert account.user_id == existing_user.id


@pytest.mark.asyncio
async def test_google_oauth_claims_pending_email_without_inheriting_a_password(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    email_outbox: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del email_outbox
    assert (
        await client.post("/api/v1/auth/register", json={"email": "pending-google@example.com"})
    ).status_code == 202

    async def exchange(_code: str, _verifier: str) -> GoogleIdentity:
        return GoogleIdentity(
            provider_account_id="google-pending-subject",
            email="pending-google@example.com",
            name="Verified Google User",
            avatar_url=None,
        )

    monkeypatch.setattr(auth_router.google_oauth, "exchange", exchange)
    start = await client.get("/api/v1/auth/oauth/google/start")
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    callback = await client.get(
        "/api/v1/auth/oauth/google/callback",
        params={"code": "valid-code", "state": state},
    )
    assert callback.status_code == 303

    async with db_session_factory() as db:
        user = await db.scalar(select(User).where(User.email == "pending-google@example.com"))
        assert user is not None
        assert user.status == UserStatus.ACTIVE
        assert user.email_verified is True
        assert user.password_hash is None
        assert await db.scalar(select(func.count()).select_from(OAuthAccount)) == 1


@pytest.mark.asyncio
async def test_google_oauth_rejects_invalid_state_and_provider_response(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = await client.get("/api/v1/auth/oauth/google/start")
    assert start.status_code == 302
    invalid_state = await client.get(
        "/api/v1/auth/oauth/google/callback",
        params={"code": "code", "state": "attacker-state"},
    )
    assert invalid_state.status_code == 303
    assert invalid_state.headers["location"].endswith("login?oauth_error=invalid_state")

    start = await client.get("/api/v1/auth/oauth/google/start")
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]

    async def failed_exchange(_code: str, _verifier: str) -> GoogleIdentity:
        raise HTTPException(status_code=400, detail="Google sign-in failed")

    monkeypatch.setattr(auth_router.google_oauth, "exchange", failed_exchange)
    invalid_response = await client.get(
        "/api/v1/auth/oauth/google/callback",
        params={"code": "invalid-code", "state": state},
    )
    assert invalid_response.status_code == 303
    assert invalid_response.headers["location"].endswith("login?oauth_error=provider_error")


@pytest.mark.asyncio
async def test_session_idor_is_blocked(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    first_user = await create_active_user(db_session_factory, "first@example.com")
    second_user = await create_active_user(db_session_factory, "second@example.com")
    assert (await login(client, first_user.email)).status_code == 200

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as second_client:
        assert (await login(second_client, second_user.email)).status_code == 200
        sessions = (await second_client.get("/api/v1/auth/sessions")).json()
        second_session_id = sessions[0]["id"]

    forbidden = await client.post(
        f"/api/v1/auth/sessions/{second_session_id}/revoke",
        headers=csrf_headers(client),
    )
    assert forbidden.status_code == 404


@pytest.mark.asyncio
async def test_database_unique_constraint_and_rollback_recovery(
    db_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with db_session_factory() as db:
        first = User(
            email="unique@example.com",
            name="First",
            password_hash=hash_password(VALID_PASSWORD),
            email_verified=True,
            status=UserStatus.ACTIVE,
        )
        duplicate = User(
            email="unique@example.com",
            name="Duplicate",
            password_hash=hash_password(VALID_PASSWORD),
            email_verified=True,
            status=UserStatus.ACTIVE,
        )
        db.add(first)
        await db.commit()
        db.add(duplicate)
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()
        assert await db.scalar(select(func.count()).select_from(User)) == 1


def test_migration_chain_has_single_hardening_head() -> None:
    config = Config("alembic.ini")
    scripts = ScriptDirectory.from_config(config)
    assert scripts.get_current_head() == "0007_workspace_rag"
    revisions = list(scripts.walk_revisions())
    assert [revision.revision for revision in revisions] == [
        "0007_workspace_rag",
        "0006_secure_registration",
        "0005_auth_hardening",
        "0004_product_context",
        "0003_conversations",
        "0002_project_composition",
        "0001_auth_foundation",
    ]


def test_revision_identifiers_fit_the_alembic_version_column() -> None:
    # alembic_version.version_num is varchar(32); a longer id aborts the upgrade at commit time.
    scripts = ScriptDirectory.from_config(Config("alembic.ini"))
    too_long = [
        revision.revision
        for revision in scripts.walk_revisions()
        if len(revision.revision) > 32
    ]
    assert too_long == []


@pytest.mark.asyncio
async def test_request_size_limit_and_security_headers(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        content=b"x" * 70000,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_cors_exposes_captcha_escalation_header(client: httpx.AsyncClient) -> None:
    response = await client.get(
        "/health",
        headers={"Origin": "http://localhost:3001"},
    )
    assert response.status_code == 200
    exposed = response.headers.get("access-control-expose-headers", "").lower()
    assert "x-captcha-required" in exposed


def test_forwarded_chain_uses_nearest_untrusted_valid_address() -> None:
    original = services.settings.trusted_proxy_hosts
    services.settings.trusted_proxy_hosts = ["10.0.0.0/8"]
    try:
        request = Request(
            {
                "type": "http",
                "http_version": "1.1",
                "method": "GET",
                "scheme": "https",
                "path": "/",
                "raw_path": b"/",
                "query_string": b"",
                "headers": [(b"x-forwarded-for", b"198.51.100.9, 203.0.113.7, 10.0.0.4")],
                "client": ("10.0.0.5", 12345),
                "server": ("api.example.com", 443),
            }
        )
        assert services.get_client_ip(request) == "203.0.113.7"

        malformed = Request(
            {
                "type": "http",
                "http_version": "1.1",
                "method": "GET",
                "scheme": "https",
                "path": "/",
                "raw_path": b"/",
                "query_string": b"",
                "headers": [(b"x-forwarded-for", b"attacker-value")],
                "client": ("10.0.0.5", 12345),
                "server": ("api.example.com", 443),
            }
        )
        assert services.get_client_ip(malformed) == "10.0.0.5"
    finally:
        services.settings.trusted_proxy_hosts = original


def test_production_configuration_fails_closed_without_security_credentials() -> None:
    with pytest.raises(ValueError):
        Settings(
            environment="production",
            secret_key="replace-with-a-random-32-character-minimum-secret",
            frontend_url="http://example.com",
            cookie_secure=False,
        )

    configured = Settings(
        environment="production",
        secret_key="7f4c9d2a8b6e1f3c5d7a9b2e4f6c8d1a0b3e5f7c9d2a4b6e",
        frontend_url="https://app.example.com",
        allowed_origins=["https://app.example.com"],
        cookie_secure=True,
        resend_api_key="re_test",
        email_from="Lura <auth@example.com>",
        google_client_id="google-client",
        google_client_secret="google-secret",
        google_redirect_uri="https://api.example.com/api/v1/auth/oauth/google/callback",
        captcha_provider="turnstile",
        turnstile_site_key="site-key",
        turnstile_secret_key="secret-key",
    )
    assert configured.cookie_secure is True
