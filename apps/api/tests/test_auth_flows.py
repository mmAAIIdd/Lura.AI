from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import PasswordResetToken, Session, User, UserStatus
from app.routers import auth as auth_router
from app.security import hash_token
from app.services import create_one_time_token, utc_now
from tests.conftest import EmailOutbox, FakeRedis
from tests.helpers import VALID_PASSWORD, create_active_user, login


@pytest.mark.asyncio
async def test_registration_verification_authenticated_request_and_logout(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    email_outbox: EmailOutbox,
) -> None:
    registration = await client.post(
        "/api/v1/auth/register",
        json={"email": " ADA@Example.com "},
    )
    assert registration.status_code == 202
    assert "ada@example.com" in email_outbox.verification_tokens

    async with db_session_factory() as db:
        user = await db.scalar(select(User).where(User.email == "ada@example.com"))
        assert user is not None
        assert user.password_hash is None
        assert user.email_verified is False

    verification = await client.post(
        "/api/v1/auth/verify-email",
        json={
            "token": email_outbox.verification_tokens["ada@example.com"],
            "name": "Ada Lovelace",
            "password": VALID_PASSWORD,
            "password_confirmation": VALID_PASSWORD,
        },
    )
    assert verification.status_code == 200
    assert "HttpOnly" in verification.headers.get("set-cookie", "")
    assert (await client.get("/api/v1/auth/me")).status_code == 200

    without_csrf = await client.post("/api/v1/auth/logout")
    assert without_csrf.status_code == 403
    csrf_response = await client.get("/api/v1/auth/csrf")
    assert csrf_response.status_code == 200
    csrf_token = csrf_response.json()["csrf_token"]
    assert (
        await client.post(
            "/api/v1/auth/logout",
            headers={"X-CSRF-Token": csrf_token},
        )
    ).status_code == 200
    assert (await client.get("/api/v1/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_duplicate_registration_is_neutral_and_invalid_inputs_are_rejected(
    client: httpx.AsyncClient,
    email_outbox: EmailOutbox,
) -> None:
    payload = {"email": "grace@example.com"}
    first = await client.post("/api/v1/auth/register", json=payload)
    second = await client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == second.status_code == 202
    assert first.json() == second.json()
    assert "grace@example.com" in email_outbox.verification_tokens

    invalid_email = await client.post(
        "/api/v1/auth/register",
        json={"email": "not-an-email"},
    )
    rejected_preverification_password = await client.post(
        "/api/v1/auth/register",
        json={"email": "new@example.com", "password": VALID_PASSWORD},
    )
    assert invalid_email.status_code == 422
    assert rejected_preverification_password.status_code == 422

    invalid_password = await client.post(
        "/api/v1/auth/verify-email",
        json={
            "token": email_outbox.verification_tokens["grace@example.com"],
            "name": "Grace Hopper",
            "password": "weak",
            "password_confirmation": "weak",
        },
    )
    assert invalid_password.status_code == 422


@pytest.mark.asyncio
async def test_verification_cannot_reactivate_suspended_account(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with db_session_factory() as db:
        user = User(
            email="suspended@example.com",
            name="Suspended User",
            password_hash=None,
            email_verified=False,
            status=UserStatus.SUSPENDED,
        )
        db.add(user)
        await db.flush()
        token, raw_token = create_one_time_token(user.id, "verification")
        db.add(token)
        await db.commit()

    response = await client.post(
        "/api/v1/auth/verify-email",
        json={
            "token": raw_token,
            "name": "Suspended User",
            "password": VALID_PASSWORD,
            "password_confirmation": VALID_PASSWORD,
        },
    )
    assert response.status_code == 400
    async with db_session_factory() as db:
        stored_user = await db.scalar(select(User).where(User.email == "suspended@example.com"))
        assert stored_user is not None
        assert stored_user.status == UserStatus.SUSPENDED
        assert stored_user.password_hash is None


@pytest.mark.asyncio
async def test_login_errors_are_neutral_and_rate_limited(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    await create_active_user(db_session_factory, "user@example.com")
    wrong_password = await login(client, "user@example.com", "WrongPassword123")
    missing_account = await login(client, "missing@example.com", "WrongPassword123")
    assert wrong_password.status_code == missing_account.status_code == 401
    assert wrong_password.json() == missing_account.json()


@pytest.mark.asyncio
async def test_login_rate_limit_and_captcha_escalation(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await create_active_user(db_session_factory, "limited@example.com")
    monkeypatch.setattr(auth_router.settings, "login_ip_limit", 2)
    monkeypatch.setattr(auth_router.settings, "login_captcha_threshold", 1)
    monkeypatch.setattr(auth_router.settings, "captcha_provider", "turnstile")

    captcha_calls: list[str | None] = []

    async def accept_captcha(token: str | None, _request: object, action: str) -> None:
        captcha_calls.append(token)
        assert action == "login"

    monkeypatch.setattr(auth_router.captcha_verifier, "verify", accept_captcha)
    first = await login(client, "limited@example.com", "WrongPassword123")
    second = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "limited@example.com",
            "password": "WrongPassword123",
            "captcha_token": "verified-captcha",
        },
    )
    third = await login(client, "limited@example.com", "WrongPassword123")

    assert first.status_code == 401
    assert second.status_code == 401
    assert captcha_calls == ["verified-captcha"]
    assert third.status_code == 429
    assert int(third.headers["Retry-After"]) > 0
    assert fake_redis.values


@pytest.mark.asyncio
async def test_successful_login_session_expiration_and_multiple_sessions(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    user = await create_active_user(db_session_factory, "sessions@example.com")
    assert (await login(client, user.email)).status_code == 200
    assert (await login(client, user.email)).status_code == 200

    sessions_response = await client.get("/api/v1/auth/sessions")
    assert sessions_response.status_code == 200
    assert len(sessions_response.json()) == 2

    current_session_hash = hash_token(client.cookies["lura_session"])
    async with db_session_factory() as db:
        current_session = await db.scalar(
            select(Session).where(Session.token_hash == current_session_hash)
        )
        assert current_session is not None
        current_session.expires_at = utc_now() - timedelta(seconds=1)
        await db.commit()

    assert (await client.get("/api/v1/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_account_cooldown_and_active_session_limit(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await create_active_user(db_session_factory, "cooldown@example.com")
    monkeypatch.setattr(auth_router.settings, "login_lock_threshold", 2)
    monkeypatch.setattr(auth_router.settings, "login_captcha_threshold", 20)
    monkeypatch.setattr(auth_router.settings, "max_active_sessions", 2)

    assert (await login(client, user.email, "WrongPassword123")).status_code == 401
    assert (await login(client, user.email, "WrongPassword123")).status_code == 401
    async with db_session_factory() as db:
        locked_user = await db.get(User, user.id)
        assert locked_user is not None
        original_locked_until = locked_user.locked_until
    assert (await login(client, user.email)).status_code == 200

    async with db_session_factory() as db:
        stored_user = await db.get(User, user.id)
        assert stored_user is not None
        assert original_locked_until is not None
        assert stored_user.locked_until is None

    assert (await login(client, user.email)).status_code == 200
    assert (await login(client, user.email)).status_code == 200

    async with db_session_factory() as db:
        active_sessions = await db.scalars(
            select(Session).where(
                Session.user_id == user.id,
                Session.revoked_at.is_(None),
                Session.expires_at > utc_now(),
            )
        )
        assert len(active_sessions.all()) == 2


@pytest.mark.asyncio
async def test_password_reset_is_one_time_and_revokes_sessions(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    email_outbox: EmailOutbox,
) -> None:
    user = await create_active_user(db_session_factory, "reset@example.com")
    assert (await login(client, user.email)).status_code == 200

    request_reset = await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": user.email},
    )
    assert request_reset.status_code == 202
    token = email_outbox.reset_tokens[user.email]

    new_password = "EvenStrongerPassword456"
    reset = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": token,
            "password": new_password,
            "password_confirmation": new_password,
        },
    )
    assert reset.status_code == 200
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    assert (await login(client, user.email, VALID_PASSWORD)).status_code == 401
    assert (await login(client, user.email, new_password)).status_code == 200

    reused = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": token,
            "password": VALID_PASSWORD,
            "password_confirmation": VALID_PASSWORD,
        },
    )
    assert reused.status_code == 400


@pytest.mark.asyncio
async def test_expired_and_invalid_password_reset_tokens(
    client: httpx.AsyncClient,
    db_session_factory: async_sessionmaker[AsyncSession],
    email_outbox: EmailOutbox,
) -> None:
    user = await create_active_user(db_session_factory, "expired@example.com")
    await client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    token = email_outbox.reset_tokens[user.email]

    async with db_session_factory() as db:
        reset_token = await db.scalar(
            select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(token))
        )
        assert reset_token is not None
        reset_token.expires_at = utc_now() - timedelta(seconds=1)
        await db.commit()

    payload = {
        "password": "AnotherStrongPassword789",
        "password_confirmation": "AnotherStrongPassword789",
    }
    expired = await client.post("/api/v1/auth/reset-password", json={"token": token, **payload})
    invalid = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": "x" * 43, **payload},
    )
    assert expired.status_code == invalid.status_code == 400
