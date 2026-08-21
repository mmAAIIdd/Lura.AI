from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from redis.asyncio import Redis

from app.config import get_settings
from app.middleware import RequestSizeLimitMiddleware, SecurityHeadersMiddleware
from app.routers.auth import router as auth_router
from app.routers.catalog import router as catalog_router
from app.routers.conversations import router as conversations_router
from app.routers.documents import router as documents_router
from app.routers.product_context import router as product_context_router
from app.routers.projects import router as projects_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    try:
        yield
    finally:
        await app.state.redis.aclose()


# The OpenAPI schema enumerates every route, payload shape and error response.
# That is useful locally and is free reconnaissance for an attacker in
# production, so the schema and both UIs are served only outside production.
expose_api_docs = settings.environment != "production"

app = FastAPI(
    title="Lura API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if expose_api_docs else None,
    redoc_url="/redoc" if expose_api_docs else None,
    openapi_url="/openapi.json" if expose_api_docs else None,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.add_middleware(
    RequestSizeLimitMiddleware,
    max_bytes=settings.request_max_bytes,
    upload_max_bytes=settings.document_max_bytes,
)
app.add_middleware(
    SecurityHeadersMiddleware,
    production=settings.environment == "production",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
    expose_headers=["X-Captcha-Required", "Retry-After"],
)
app.include_router(auth_router, prefix=settings.api_prefix)
app.include_router(catalog_router, prefix=settings.api_prefix)
app.include_router(projects_router, prefix=settings.api_prefix)
app.include_router(conversations_router, prefix=settings.api_prefix)
app.include_router(product_context_router, prefix=settings.api_prefix)
app.include_router(documents_router, prefix=settings.api_prefix)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
