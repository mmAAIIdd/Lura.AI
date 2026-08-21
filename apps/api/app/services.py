import logging
import uuid
from datetime import UTC, datetime, timedelta
from ipaddress import IPv4Address, IPv6Address, ip_address, ip_network
from typing import Literal
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, Request, status
from redis.asyncio import Redis
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models import AuditLog, PasswordResetToken, Session, User, VerificationToken
from app.security import derive_csrf_token, generate_token, hash_token

logger = logging.getLogger(__name__)
settings = get_settings()


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def get_client_ip(request: Request) -> str | None:
    direct_host = request.client.host if request.client else None
    if not direct_host:
        return None

    try:
        direct_ip = ip_address(direct_host)
    except ValueError:
        return direct_host[:64]

    trusted_networks = []
    for value in settings.trusted_proxy_hosts:
        try:
            trusted_networks.append(ip_network(value, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid trusted proxy address")

    def is_trusted(candidate: IPv4Address | IPv6Address) -> bool:
        return any(candidate.version == network.version and candidate in network for network in trusted_networks)

    forwarded_for = request.headers.get("x-forwarded-for")
    if not forwarded_for or not is_trusted(direct_ip):
        return str(direct_ip)

    forwarded_values = [value.strip() for value in forwarded_for.split(",")]
    if not forwarded_values or len(forwarded_values) > 16:
        return str(direct_ip)

    try:
        forwarded_ips = [ip_address(value) for value in forwarded_values]
    except ValueError:
        return str(direct_ip)

    for candidate in reversed([*forwarded_ips, direct_ip]):
        if not is_trusted(candidate):
            return str(candidate)
    return str(forwarded_ips[0])


async def rate_limit(redis: Redis, key: str, limit: int, window_seconds: int) -> None:
    try:
        count = await redis.eval(
            """
            local count = redis.call('INCR', KEYS[1])
            if count == 1 then
                redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            return count
            """,
            1,
            key,
            window_seconds,
        )
    except Exception as error:
        # Only the exception type is logged: a redis-py connection error renders
        # the full DSN, which carries the instance password in any deployment
        # that uses one.
        logger.error("Rate limiter unavailable: %s", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable",
        ) from error

    if count > limit:
        ttl = await redis.ttl(key)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
            headers={"Retry-After": str(max(ttl, 1))},
        )


async def get_counter(redis: Redis, key: str) -> int:
    try:
        value = await redis.get(key)
        return int(value or 0)
    except Exception as error:
        logger.error("Security counter unavailable: %s", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable",
        ) from error


async def increment_counter(redis: Redis, key: str, window_seconds: int) -> int:
    try:
        return int(
            await redis.eval(
                """
                local count = redis.call('INCR', KEYS[1])
                if count == 1 then
                    redis.call('EXPIRE', KEYS[1], ARGV[1])
                end
                return count
                """,
                1,
                key,
                window_seconds,
            )
        )
    except Exception as error:
        logger.error("Security counter unavailable: %s", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable",
        ) from error


async def clear_counter(redis: Redis, key: str) -> None:
    try:
        await redis.delete(key)
    except Exception as error:
        logger.error("Security counter unavailable: %s", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable",
        ) from error


async def add_audit_log(
    db: AsyncSession,
    action: str,
    request: Request,
    user_id: uuid.UUID | None = None,
    metadata_json: str | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent", "")[:512] or None,
            metadata_json=metadata_json,
        )
    )


def create_session(user: User, request: Request) -> tuple[Session, str, str]:
    session_token = generate_token()
    session_token_hash = hash_token(session_token)
    csrf_token = derive_csrf_token(session_token_hash)
    session = Session(
        user_id=user.id,
        token_hash=session_token_hash,
        csrf_token_hash=hash_token(csrf_token),
        expires_at=utc_now() + timedelta(days=settings.session_ttl_days),
        user_agent=request.headers.get("user-agent", "")[:512] or None,
        ip_address=get_client_ip(request),
    )
    return session, session_token, csrf_token


def create_one_time_token(
    user_id: uuid.UUID, token_type: Literal["verification", "reset"]
) -> tuple[VerificationToken | PasswordResetToken, str]:
    raw_token = generate_token()
    expires_at = utc_now() + timedelta(hours=24 if token_type == "verification" else 1)
    token_model = VerificationToken if token_type == "verification" else PasswordResetToken
    return token_model(user_id=user_id, token_hash=hash_token(raw_token), expires_at=expires_at), raw_token


async def revoke_user_sessions(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(Session)
        .where(Session.user_id == user_id, Session.revoked_at.is_(None))
        .values(revoked_at=utc_now())
    )


class EmailService:
    def __init__(self, config: Settings) -> None:
        self.config = config

    async def send_verification_email(self, recipient: str, token: str) -> None:
        link = f"{self.config.frontend_url}verify-email#{urlencode({'token': token})}"
        await self._send(recipient, "Verify your Lura email", f"Verify your email: {link}")

    async def send_password_reset_email(self, recipient: str, token: str) -> None:
        link = f"{self.config.frontend_url}reset-password#{urlencode({'token': token})}"
        await self._send(recipient, "Reset your Lura password", f"Reset your password: {link}")

    async def _send(self, recipient: str, subject: str, text: str) -> None:
        if not self.config.resend_api_key or not self.config.email_from:
            if self.config.environment == "development":
                # Local development has no mail provider, so the one-time link would otherwise be
                # unrecoverable: only its hash reaches the database.
                logger.warning(
                    "Transactional email is not configured; development delivery for %s:\n%s",
                    recipient,
                    text,
                )
            else:
                logger.warning("Transactional email delivery is not configured; message suppressed")
            return

        payload = {"from": self.config.email_from, "to": [recipient], "subject": subject, "text": text}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {self.config.resend_api_key}"},
                    json=payload,
                )
                response.raise_for_status()
        except httpx.HTTPError:
            logger.exception("Unable to send transactional email")
