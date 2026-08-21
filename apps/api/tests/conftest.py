import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

os.environ.update(
    {
        "ENVIRONMENT": "test",
        "SECRET_KEY": "test-secret-key-with-at-least-thirty-two-characters",
        "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
        "REDIS_URL": "redis://localhost:6379/15",
        "ALLOWED_HOSTS": "testserver,localhost,127.0.0.1",
        "ALLOWED_ORIGINS": "http://localhost:3001",
        "GOOGLE_CLIENT_ID": "test-google-client",
        "GOOGLE_CLIENT_SECRET": "test-google-secret",
    }
)

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.routers import auth as auth_router


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.expirations: dict[str, int] = {}

    async def eval(self, _script: str, _keys: int, key: str, window_seconds: int) -> int:
        self.values[key] = self.values.get(key, 0) + 1
        self.expirations.setdefault(key, int(window_seconds))
        return self.values[key]

    async def get(self, key: str) -> str | None:
        value = self.values.get(key)
        return str(value) if value is not None else None

    async def delete(self, key: str) -> int:
        existed = key in self.values
        self.values.pop(key, None)
        self.expirations.pop(key, None)
        return int(existed)

    async def ttl(self, key: str) -> int:
        return self.expirations.get(key, -1)


@dataclass
class EmailOutbox:
    verification_tokens: dict[str, str] = field(default_factory=dict)
    reset_tokens: dict[str, str] = field(default_factory=dict)

    async def send_verification_email(self, recipient: str, token: str) -> None:
        self.verification_tokens[recipient] = token

    async def send_password_reset_email(self, recipient: str, token: str) -> None:
        self.reset_tokens[recipient] = token


@pytest_asyncio.fixture
async def db_session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    yield factory
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.fixture
def fake_redis() -> FakeRedis:
    redis = FakeRedis()
    app.state.redis = redis
    return redis


@pytest.fixture
def email_outbox(monkeypatch: pytest.MonkeyPatch) -> EmailOutbox:
    outbox = EmailOutbox()
    monkeypatch.setattr(
        auth_router.email_service,
        "send_verification_email",
        outbox.send_verification_email,
    )
    monkeypatch.setattr(
        auth_router.email_service,
        "send_password_reset_email",
        outbox.send_password_reset_email,
    )
    return outbox


@pytest_asyncio.fixture
async def client(
    db_session_factory: async_sessionmaker[AsyncSession],
    fake_redis: FakeRedis,
) -> AsyncIterator[httpx.AsyncClient]:
    del db_session_factory, fake_redis
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def reset_mutable_settings() -> AsyncIterator[None]:
    original = {
        "captcha_provider": auth_router.settings.captcha_provider,
        "login_ip_limit": auth_router.settings.login_ip_limit,
        "login_account_limit": auth_router.settings.login_account_limit,
        "login_captcha_threshold": auth_router.settings.login_captcha_threshold,
        "login_lock_threshold": auth_router.settings.login_lock_threshold,
        "request_max_bytes": auth_router.settings.request_max_bytes,
    }
    yield
    for key, value in original.items():
        setattr(auth_router.settings, key, value)
