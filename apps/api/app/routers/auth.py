import asyncio
import secrets
from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.captcha import CaptchaVerifier
from app.auth.oauth import GoogleOAuthService
from app.auth.sessions import enforce_active_session_limit, lock_user_for_session_change
from app.auth.supabase import SupabaseIdentityError, SupabaseIdentityService
from app.config import get_settings
from app.database import get_db
from app.dependencies import AuthContext, get_auth_context, require_auth, require_csrf
from app.models import (
    OAuthAccount,
    PasswordResetToken,
    Session,
    User,
    UserStatus,
    VerificationToken,
)
from app.schemas import (
    CaptchaStatusResponse,
    CompleteRegistrationRequest,
    CsrfTokenResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
    SupabaseSessionRequest,
    UserResponse,
)
from app.security import (
    derive_csrf_token,
    hash_identifier,
    hash_password,
    hash_token,
    password_needs_rehash,
    verify_password,
)
from app.services import (
    EmailService,
    add_audit_log,
    clear_counter,
    create_one_time_token,
    create_session,
    ensure_utc,
    get_client_ip,
    get_counter,
    increment_counter,
    normalize_email,
    rate_limit,
    revoke_user_sessions,
    utc_now,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
email_service = EmailService(settings)
captcha_verifier = CaptchaVerifier(settings)
google_oauth = GoogleOAuthService(settings)
supabase_identity = SupabaseIdentityService(settings)

GENERIC_REGISTRATION_MESSAGE = "If the address can be registered, a verification email will be sent."
GENERIC_RESET_MESSAGE = "If an account exists for this address, a reset email will be sent."
INVALID_CREDENTIALS_MESSAGE = "Invalid email or password."


@router.get("/oauth/google/status")
async def google_status() -> dict[str, bool]:
    return {"configured": google_oauth.configured}


@router.get("/captcha/status", response_model=CaptchaStatusResponse)
async def captcha_status() -> CaptchaStatusResponse:
    if settings.captcha_provider == "disabled":
        return CaptchaStatusResponse(provider=None, site_key=None)
    return CaptchaStatusResponse(provider="turnstile", site_key=settings.turnstile_site_key)


def set_auth_cookies(response: Response, session_token: str, csrf_token: str) -> None:
    max_age = settings.session_ttl_days * 24 * 60 * 60
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=csrf_token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


def oauth_error_response(error_code: str) -> RedirectResponse:
    response = RedirectResponse(
        url=f"{settings.frontend_url}login?oauth_error={error_code}",
        status_code=status.HTTP_303_SEE_OTHER,
    )
    oauth_cookie_path = f"{settings.api_prefix}/auth/oauth/google"
    response.delete_cookie("lura_oauth_state", path=oauth_cookie_path)
    response.delete_cookie("lura_oauth_verifier", path=oauth_cookie_path)
    return response


def rate_limit_key(request: Request, action: str) -> str:
    return f"auth:{action}:{get_client_ip(request) or 'unknown'}"


def account_rate_limit_key(request: Request, action: str, email: str) -> str:
    client_identity = get_client_ip(request) or "unknown"
    return f"auth:{action}:account-ip:{hash_identifier(f'{email}:{client_identity}')}"


def login_failure_key(email: str) -> str:
    return f"auth:login:failures:{hash_identifier(email)}"


async def apply_public_rate_limits(
    request: Request,
    action: str,
    email: str,
    ip_limit: int,
    account_limit: int,
    window_seconds: int,
) -> None:
    redis = request.app.state.redis
    await rate_limit(redis, rate_limit_key(request, action), ip_limit, window_seconds)
    await rate_limit(
        redis,
        account_rate_limit_key(request, action, email),
        account_limit,
        window_seconds,
    )


async def equalize_public_response(started_at: float, minimum_seconds: float = 0.15) -> None:
    elapsed = asyncio.get_running_loop().time() - started_at
    jitter = secrets.randbelow(50) / 1000
    await asyncio.sleep(max(0.0, minimum_seconds - elapsed) + jitter)


@router.post("/register", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
async def register(
    payload: RegisterRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    started_at = asyncio.get_running_loop().time()
    email = normalize_email(str(payload.email))
    await apply_public_rate_limits(
        request,
        "register",
        email,
        settings.register_ip_limit,
        settings.register_account_limit,
        3600,
    )
    await captcha_verifier.verify(payload.captcha_token, request, "register")
    existing_user = await db.scalar(select(User).where(User.email == email))

    if existing_user:
        if not existing_user.email_verified and existing_user.status != UserStatus.SUSPENDED:
            await db.execute(
                update(VerificationToken)
                .where(
                    VerificationToken.user_id == existing_user.id,
                    VerificationToken.used_at.is_(None),
                )
                .values(used_at=utc_now())
            )
            token, raw_token = create_one_time_token(existing_user.id, "verification")
            db.add(token)
            await add_audit_log(db, "verification_resent", request, existing_user.id)
            await db.commit()
            background_tasks.add_task(email_service.send_verification_email, existing_user.email, raw_token)
        await equalize_public_response(started_at)
        return MessageResponse(message=GENERIC_REGISTRATION_MESSAGE)

    user = User(
        email=email,
        password_hash=None,
        password_updated_at=None,
        name=email.split("@", maxsplit=1)[0][:120],
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        await equalize_public_response(started_at)
        return MessageResponse(message=GENERIC_REGISTRATION_MESSAGE)
    token, raw_token = create_one_time_token(user.id, "verification")
    db.add(token)
    await add_audit_log(db, "user_registered", request, user.id)
    await db.commit()
    background_tasks.add_task(email_service.send_verification_email, user.email, raw_token)
    await equalize_public_response(started_at)
    return MessageResponse(message=GENERIC_REGISTRATION_MESSAGE)


@router.post("/verify-email", response_model=UserResponse)
async def verify_email(
    payload: CompleteRegistrationRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> User:
    await rate_limit(request.app.state.redis, rate_limit_key(request, "verify-email"), 20, 3600)
    token = await db.scalar(
        select(VerificationToken)
        .where(
            VerificationToken.token_hash == hash_token(payload.token),
            VerificationToken.used_at.is_(None),
            VerificationToken.expires_at > utc_now(),
        )
        .with_for_update()
    )
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification link is invalid or expired")

    user = await db.scalar(select(User).where(User.id == token.user_id).with_for_update())
    if not user or user.status != UserStatus.PENDING_VERIFICATION or user.email_verified:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification link is invalid or expired")

    token.used_at = utc_now()
    user.name = payload.name.strip()
    user.password_hash = hash_password(payload.password)
    user.password_updated_at = utc_now()
    user.email_verified = True
    user.status = UserStatus.ACTIVE
    session, session_token, csrf_token = create_session(user, request)
    db.add(session)
    await db.flush()
    await enforce_active_session_limit(db, user.id, session.id, settings)
    await add_audit_log(db, "email_verified", request, user.id)
    await db.commit()
    set_auth_cookies(response, session_token, csrf_token)
    return user


@router.post("/login", response_model=UserResponse)
async def login(
    payload: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> User:
    email = normalize_email(str(payload.email))
    await apply_public_rate_limits(
        request,
        "login",
        email,
        settings.login_ip_limit,
        settings.login_account_limit,
        settings.login_window_seconds,
    )
    failure_key = login_failure_key(email)
    failure_count = await get_counter(request.app.state.redis, failure_key)
    if failure_count >= settings.login_captcha_threshold:
        await captcha_verifier.verify(payload.captcha_token, request, "login")

    user = await db.scalar(select(User).where(User.email == email))
    password_is_valid = verify_password(payload.password, user.password_hash if user else None)

    now = utc_now()
    account_is_locked = bool(user and user.locked_until and ensure_utc(user.locked_until) > now)
    if user and user.locked_until and not account_is_locked:
        user.locked_until = None
        user.failed_login_attempts = 0

    account_is_available = bool(
        user
        and user.email_verified
        and user.status == UserStatus.ACTIVE
    )
    if not user or not password_is_valid or not account_is_available:
        failures = await increment_counter(
            request.app.state.redis,
            failure_key,
            settings.login_window_seconds,
        )
        if user and not account_is_locked:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= settings.login_lock_threshold:
                lock_multiplier = min(
                    2 ** (user.failed_login_attempts - settings.login_lock_threshold), 16
                )
                user.locked_until = utc_now() + timedelta(
                    seconds=settings.login_lock_seconds * lock_multiplier
                )
            await add_audit_log(db, "login_failed", request, user.id)
            await db.commit()
        elif user:
            await add_audit_log(db, "login_blocked_by_cooldown", request, user.id)
            await db.commit()
        await asyncio.sleep(secrets.randbelow(150) / 1000)
        headers = {"X-Captcha-Required": "true"} if failures >= settings.login_captcha_threshold else None
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=INVALID_CREDENTIALS_MESSAGE,
            headers=headers,
        )

    if user.password_hash and password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
        user.password_updated_at = utc_now()
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = utc_now()
    await clear_counter(request.app.state.redis, failure_key)
    await lock_user_for_session_change(db, user.id)
    session, session_token, csrf_token = create_session(user, request)
    db.add(session)
    await db.flush()
    await enforce_active_session_limit(db, user.id, session.id, settings)
    await add_audit_log(db, "login_succeeded", request, user.id)
    await db.commit()
    set_auth_cookies(response, session_token, csrf_token)
    return user


SUPABASE_PROVIDER = "supabase"


def supabase_display_name(profile: dict, email: str) -> str:
    metadata = profile.get("user_metadata") or {}
    for key in ("full_name", "name"):
        candidate = str(metadata.get(key) or "").strip()
        if candidate:
            return candidate[:120]
    return email.split("@", 1)[0][:120] or "Lura user"


@router.get("/supabase/status")
async def supabase_status() -> dict[str, bool]:
    return {"configured": supabase_identity.configured}


@router.post("/supabase/session", response_model=UserResponse)
async def supabase_session(
    payload: SupabaseSessionRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Exchange a verified Supabase access token for a Lura session cookie.

    Supabase is the authority on the password and on whether the address was
    confirmed; this endpoint only mirrors that decision into a local user and
    issues the same session the password login issues. It is deliberately not
    rate limited here: reaching it already requires a token Supabase minted,
    and Supabase rate limits the sign-in that produces one.
    """
    if not supabase_identity.configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase authentication is not configured on the server",
        )

    try:
        profile = await supabase_identity.get_user(payload.access_token)
    except SupabaseIdentityError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Supabase session is invalid or expired",
        ) from None

    subject = str(profile.get("id") or "")
    raw_email = str(profile.get("email") or "")
    if not subject or not raw_email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Supabase session carries no email identity",
        )
    if not profile.get("email_confirmed_at"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Confirm your email address before signing in",
        )

    email = normalize_email(raw_email)
    link = await db.scalar(
        select(OAuthAccount)
        .options(selectinload(OAuthAccount.user))
        .where(
            OAuthAccount.provider == SUPABASE_PROVIDER,
            OAuthAccount.provider_account_id == subject,
        )
    )
    user = link.user if link else await db.scalar(select(User).where(User.email == email))

    if user is None:
        user = User(
            email=email,
            name=supabase_display_name(profile, email),
            email_verified=True,
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:
            # Two confirmations racing for the same address; the other one won.
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Please try signing in again"
            ) from None
        await add_audit_log(db, "supabase_account_created", request, user.id)
    else:
        # Supabase has just re-verified the address, so a pending account
        # becomes usable and an address change is carried across.
        user.email = email
        user.email_verified = True
        if user.status == UserStatus.PENDING_VERIFICATION:
            user.status = UserStatus.ACTIVE

    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is not active")

    if link is None:
        existing_link = await db.scalar(
            select(OAuthAccount).where(
                OAuthAccount.user_id == user.id,
                OAuthAccount.provider == SUPABASE_PROVIDER,
            )
        )
        if existing_link is None:
            db.add(
                OAuthAccount(
                    user_id=user.id, provider=SUPABASE_PROVIDER, provider_account_id=subject
                )
            )
        else:
            # The Supabase account behind this address was recreated.
            existing_link.provider_account_id = subject
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Please try signing in again"
            ) from None

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = utc_now()
    await lock_user_for_session_change(db, user.id)
    session, session_token, csrf_token = create_session(user, request)
    db.add(session)
    await db.flush()
    await enforce_active_session_limit(db, user.id, session.id, settings)
    await add_audit_log(db, "supabase_session_issued", request, user.id)
    await db.commit()
    set_auth_cookies(response, session_token, csrf_token)
    return user


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    context.session.revoked_at = utc_now()
    await add_audit_log(db, "logout", request, context.user.id)
    await db.commit()
    clear_auth_cookies(response)
    return MessageResponse(message="Signed out")


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(require_auth)) -> User:
    return current_user


@router.get("/csrf", response_model=CsrfTokenResponse)
async def csrf_token(
    context: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> CsrfTokenResponse:
    raw_token = derive_csrf_token(context.session.token_hash)
    context.session.csrf_token_hash = hash_token(raw_token)
    await db.commit()
    return CsrfTokenResponse(csrf_token=raw_token)


@router.post("/refresh", response_model=MessageResponse)
async def refresh(
    request: Request,
    response: Response,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    revoked_session_id = await db.scalar(
        update(Session)
        .where(Session.id == context.session.id, Session.revoked_at.is_(None))
        .values(revoked_at=utc_now())
        .returning(Session.id)
    )
    if not revoked_session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is invalid or expired")
    await lock_user_for_session_change(db, context.user.id)
    new_session, session_token, csrf_token = create_session(context.user, request)
    db.add(new_session)
    await db.flush()
    await enforce_active_session_limit(db, context.user.id, new_session.id, settings)
    await add_audit_log(db, "session_refreshed", request, context.user.id)
    await db.commit()
    set_auth_cookies(response, session_token, csrf_token)
    return MessageResponse(message="Session refreshed")


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    context: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)
) -> list[SessionResponse]:
    sessions = (
        await db.scalars(
            select(Session)
            .where(
                Session.user_id == context.user.id,
                Session.revoked_at.is_(None),
                Session.expires_at > utc_now(),
            )
            .order_by(Session.last_used_at.desc())
        )
    ).all()
    return [
        SessionResponse(
            id=session.id,
            created_at=session.created_at,
            last_used_at=session.last_used_at,
            expires_at=session.expires_at,
            user_agent=session.user_agent,
            current=session.id == context.session.id,
        )
        for session in sessions
    ]


@router.post("/sessions/{session_id}/revoke", response_model=MessageResponse)
async def revoke_session(
    session_id: UUID,
    request: Request,
    response: Response,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    session = await db.scalar(
        select(Session).where(Session.id == session_id, Session.user_id == context.user.id)
    )
    if not session or session.revoked_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    session.revoked_at = utc_now()
    await add_audit_log(db, "session_revoked", request, context.user.id)
    await db.commit()
    if session.id == context.session.id:
        clear_auth_cookies(response)
    return MessageResponse(message="Session revoked")


@router.post("/forgot-password", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(
    payload: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    started_at = asyncio.get_running_loop().time()
    email = normalize_email(str(payload.email))
    await apply_public_rate_limits(
        request,
        "password-reset",
        email,
        settings.password_reset_ip_limit,
        settings.password_reset_account_limit,
        3600,
    )
    await captcha_verifier.verify(payload.captcha_token, request, "forgot_password")
    user = await db.scalar(select(User).where(User.email == email))
    if user and user.status == UserStatus.ACTIVE and user.email_verified:
        await db.execute(
            update(PasswordResetToken)
            .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
            .values(used_at=utc_now())
        )
        token, raw_token = create_one_time_token(user.id, "reset")
        db.add(token)
        await add_audit_log(db, "password_reset_requested", request, user.id)
        await db.commit()
        background_tasks.add_task(email_service.send_password_reset_email, user.email, raw_token)
    await equalize_public_response(started_at)
    return MessageResponse(message=GENERIC_RESET_MESSAGE)


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(
    payload: ResetPasswordRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> MessageResponse:
    await rate_limit(request.app.state.redis, rate_limit_key(request, "reset-password"), 10, 3600)
    token = await db.scalar(
        select(PasswordResetToken)
        .options(selectinload(PasswordResetToken.user))
        .where(
            PasswordResetToken.token_hash == hash_token(payload.token),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > utc_now(),
        )
        .with_for_update()
    )
    if not token or not token.user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset link is invalid or expired")

    token.user.password_hash = hash_password(payload.password)
    token.user.password_updated_at = utc_now()
    token.user.failed_login_attempts = 0
    token.user.locked_until = None
    await db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == token.user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=utc_now())
    )
    await revoke_user_sessions(db, token.user.id)
    await add_audit_log(db, "password_reset_completed", request, token.user.id)
    await db.commit()
    return MessageResponse(message="Password updated. Sign in with your new password.")


@router.get("/oauth/google/start")
async def google_start(request: Request) -> RedirectResponse:
    await rate_limit(request.app.state.redis, rate_limit_key(request, "oauth-start"), 20, 900)
    if not google_oauth.configured:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Google OAuth is not configured")

    url, state, code_verifier = google_oauth.create_authorization_request()
    response = RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        "lura_oauth_state",
        state,
        max_age=600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path=f"{settings.api_prefix}/auth/oauth/google",
    )
    response.set_cookie(
        "lura_oauth_verifier",
        code_verifier,
        max_age=600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path=f"{settings.api_prefix}/auth/oauth/google",
    )
    return response


@router.get("/oauth/google/callback")
async def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    await rate_limit(request.app.state.redis, rate_limit_key(request, "oauth-callback"), 30, 900)
    expected_state = request.cookies.get("lura_oauth_state")
    code_verifier = request.cookies.get("lura_oauth_verifier")
    if error or not code or not state:
        return oauth_error_response("cancelled")
    if (
        not expected_state
        or not code_verifier
        or not secrets.compare_digest(state, expected_state)
    ):
        return oauth_error_response("invalid_state")

    try:
        identity = await google_oauth.exchange(code, code_verifier)
    except HTTPException:
        return oauth_error_response("provider_error")

    account = await db.scalar(
        select(OAuthAccount).options(selectinload(OAuthAccount.user)).where(
            OAuthAccount.provider == "google",
            OAuthAccount.provider_account_id == identity.provider_account_id,
        )
    )
    if account:
        user = account.user
    else:
        user = await db.scalar(select(User).where(User.email == identity.email))
        if not user:
            user = User(
                email=identity.email,
                name=identity.name,
                avatar_url=identity.avatar_url,
                email_verified=True,
                status=UserStatus.ACTIVE,
            )
            db.add(user)
            await db.flush()
        elif user.status == UserStatus.PENDING_VERIFICATION:
            await db.execute(
                update(VerificationToken)
                .where(
                    VerificationToken.user_id == user.id,
                    VerificationToken.used_at.is_(None),
                )
                .values(used_at=utc_now())
            )
            user.name = identity.name
            user.avatar_url = identity.avatar_url
            user.email_verified = True
            user.status = UserStatus.ACTIVE
        db.add(
            OAuthAccount(
                user_id=user.id,
                provider="google",
                provider_account_id=identity.provider_account_id,
            )
        )

    if not user or user.status != UserStatus.ACTIVE:
        await db.rollback()
        return oauth_error_response("account_unavailable")
    user.last_login_at = utc_now()
    user.failed_login_attempts = 0
    user.locked_until = None
    await lock_user_for_session_change(db, user.id)
    session, session_token, csrf_token = create_session(user, request)
    db.add(session)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return oauth_error_response("link_failed")
    await enforce_active_session_limit(db, user.id, session.id, settings)
    await add_audit_log(db, "oauth_google_login", request, user.id)
    await db.commit()

    response = RedirectResponse(url=f"{settings.frontend_url}dashboard", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie("lura_oauth_state", path=f"{settings.api_prefix}/auth/oauth/google")
    response.delete_cookie("lura_oauth_verifier", path=f"{settings.api_prefix}/auth/oauth/google")
    set_auth_cookies(response, session_token, csrf_token)
    return response
