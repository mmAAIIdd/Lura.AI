from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import get_db
from app.models import Session, User, UserRole, UserStatus
from app.security import compare_token, hash_token
from app.services import ensure_utc, utc_now

settings = get_settings()


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: Session


async def get_auth_context(
    request: Request, db: AsyncSession = Depends(get_db)
) -> AuthContext:
    raw_session_token = request.cookies.get(settings.session_cookie_name)
    if not raw_session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    result = await db.execute(
        select(Session)
        .options(selectinload(Session.user))
        .where(Session.token_hash == hash_token(raw_session_token))
    )
    session = result.scalar_one_or_none()
    if (
        not session
        or session.revoked_at
        or ensure_utc(session.expires_at) <= utc_now()
        or not session.user
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is invalid or expired")
    if session.user.status != UserStatus.ACTIVE or not session.user.email_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is not active")

    session.last_used_at = utc_now()
    return AuthContext(user=session.user, session=session)


async def require_auth(context: AuthContext = Depends(get_auth_context)) -> User:
    return context.user


async def require_admin(current_user: User = Depends(require_auth)) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return current_user


async def require_csrf(request: Request, context: AuthContext = Depends(get_auth_context)) -> AuthContext:
    csrf_token = request.headers.get("x-csrf-token")
    if not csrf_token or not compare_token(csrf_token, context.session.csrf_token_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")
    return context
