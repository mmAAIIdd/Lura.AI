from functools import lru_cache
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    api_prefix: str = "/api/v1"
    database_url: str = "postgresql+asyncpg://lura:lura@localhost:5432/lura"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = Field(min_length=32)
    frontend_url: AnyHttpUrl = "http://localhost:3001"
    allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:3001"]
    allowed_hosts: Annotated[list[str], NoDecode] = ["localhost", "127.0.0.1", "api"]

    session_cookie_name: str = "lura_session"
    csrf_cookie_name: str = "lura_csrf"
    cookie_secure: bool = False
    session_ttl_days: int = Field(default=30, ge=1, le=90)
    max_active_sessions: int = Field(default=10, ge=1, le=50)

    request_max_bytes: int = Field(default=64 * 1024, ge=1024, le=1024 * 1024)
    trusted_proxy_hosts: Annotated[list[str], NoDecode] = []
    login_ip_limit: int = Field(default=20, ge=1, le=1000)
    login_account_limit: int = Field(default=10, ge=1, le=1000)
    login_window_seconds: int = Field(default=900, ge=60, le=86400)
    login_captcha_threshold: int = Field(default=3, ge=1, le=20)
    login_lock_threshold: int = Field(default=5, ge=2, le=50)
    login_lock_seconds: int = Field(default=300, ge=30, le=86400)
    register_ip_limit: int = Field(default=5, ge=1, le=100)
    register_account_limit: int = Field(default=3, ge=1, le=100)
    password_reset_ip_limit: int = Field(default=5, ge=1, le=100)
    password_reset_account_limit: int = Field(default=3, ge=1, le=100)

    captcha_provider: Literal["disabled", "turnstile"] = "disabled"
    turnstile_site_key: str | None = None
    turnstile_secret_key: str | None = None
    turnstile_verify_url: AnyHttpUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

    resend_api_key: str | None = None
    email_from: str | None = None
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: AnyHttpUrl = "http://localhost:8000/api/v1/auth/oauth/google/callback"

    # Supabase is the identity provider for email sign-up and sign-in. Only the
    # project URL and the publishable key are needed: the token is validated by
    # asking Supabase itself, so no signing secret is ever stored here.
    supabase_url: AnyHttpUrl | None = None
    supabase_publishable_key: str | None = None

    openai_api_key: str | None = None
    gemini_api_key: str | None = None
    anthropic_api_key: str | None = None
    ai_runtime_timeout_seconds: int = Field(default=60, ge=10, le=180)
    ai_runtime_max_history_messages: int = Field(default=24, ge=2, le=100)
    ai_runtime_max_retries: int = Field(default=3, ge=1, le=6)
    # The newest Flash model is periodically saturated upstream; this keeps chat answering.
    gemini_fallback_model: str = "gemini-3.6-flash"

    document_max_bytes: int = Field(default=2 * 1024 * 1024, ge=64 * 1024, le=16 * 1024 * 1024)
    embedding_model: str = "gemini-embedding-2"
    embedding_dimensions: int = Field(default=768, ge=128, le=3072)
    rag_chunk_chars: int = Field(default=1400, ge=400, le=8000)
    rag_chunk_overlap_chars: int = Field(default=200, ge=0, le=2000)
    rag_top_k: int = Field(default=6, ge=1, le=30)
    rag_max_scanned_chunks: int = Field(default=4000, ge=100, le=50000)

    @field_validator("allowed_origins", "allowed_hosts", "trusted_proxy_hosts", mode="before")
    @classmethod
    def split_csv(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if self.environment == "production" and (
            self.secret_key.startswith("replace-") or len(set(self.secret_key)) < 12
        ):
            raise ValueError("SECRET_KEY must be a strong, randomly generated production secret")
        if self.environment == "production" and not self.cookie_secure:
            raise ValueError("COOKIE_SECURE must be true in production")
        if self.environment == "production" and self.frontend_url.scheme != "https":
            raise ValueError("FRONTEND_URL must use HTTPS in production")
        if self.environment == "production" and any(
            not origin.startswith("https://") for origin in self.allowed_origins
        ):
            raise ValueError("ALLOWED_ORIGINS must use HTTPS in production")
        if self.environment == "production" and not (self.resend_api_key and self.email_from):
            raise ValueError("Transactional email must be configured in production")
        if self.environment == "production" and not (
            self.google_client_id and self.google_client_secret
        ):
            raise ValueError("Google OAuth must be configured in production")
        if self.environment == "production" and self.google_redirect_uri.scheme != "https":
            raise ValueError("GOOGLE_REDIRECT_URI must use HTTPS in production")
        if self.environment == "production" and self.captcha_provider != "turnstile":
            raise ValueError("CAPTCHA_PROVIDER must be turnstile in production")
        if self.captcha_provider == "turnstile" and not (
            self.turnstile_site_key and self.turnstile_secret_key
        ):
            raise ValueError(
                "TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required when CAPTCHA is enabled"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
