import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import Session, User
from app.services import utc_now


async def lock_user_for_session_change(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())


async def enforce_active_session_limit(
    db: AsyncSession,
    user_id: uuid.UUID,
    current_session_id: uuid.UUID,
    settings: Settings,
) -> None:
    sessions = (
        await db.scalars(
            select(Session)
            .where(
                Session.user_id == user_id,
                Session.revoked_at.is_(None),
                Session.expires_at > utc_now(),
                Session.id != current_session_id,
            )
            .order_by(Session.last_used_at.desc())
        )
    ).all()
    sessions_to_revoke = sessions[max(settings.max_active_sessions - 1, 0) :]
    revoked_at = utc_now()
    for session in sessions_to_revoke:
        session.revoked_at = revoked_at
