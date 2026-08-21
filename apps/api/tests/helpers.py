
import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import User, UserStatus
from app.security import hash_password
from app.services import utc_now

VALID_PASSWORD = "StrongPassword123"


async def create_active_user(
    factory: async_sessionmaker[AsyncSession],
    email: str,
    password: str = VALID_PASSWORD,
) -> User:
    async with factory() as db:
        user = User(
            email=email,
            name="Test User",
            password_hash=hash_password(password),
            password_updated_at=utc_now(),
            email_verified=True,
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


async def login(
    client: httpx.AsyncClient,
    email: str,
    password: str = VALID_PASSWORD,
) -> httpx.Response:
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


def csrf_headers(client: httpx.AsyncClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["lura_csrf"]}
