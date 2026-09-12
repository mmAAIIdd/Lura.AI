---
name: fastapi-backend
description: Rules for changing the Lura FastAPI backend in apps/api — router structure, the AuthContext/require_auth/require_csrf dependency chain, the owner_id filtering pattern, Pydantic settings, middleware order, audit logging and rate limiting. Use when adding or modifying an endpoint, a dependency, a service, a Pydantic schema or backend configuration.
---

# Lura FastAPI backend

Python 3.12+, FastAPI, SQLAlchemy 2.0 async, asyncpg, Redis, Alembic. Everything under
`apps/api/app/`.

## Module map

| File | Owns |
|---|---|
| `main.py` | app construction, middleware order, router registration, `/health` |
| `config.py` | `Settings` (pydantic-settings), `get_settings()` — `lru_cache`d |
| `dependencies.py` | `AuthContext`, `require_auth`, `require_admin`, `require_csrf` |
| `models.py` | SQLAlchemy ORM models |
| `schemas.py` | Pydantic request/response models |
| `services.py` | rate limiting, audit log, session creation, email, time helpers |
| `security.py` | Argon2 hashing, HMAC token hashing, CSRF derivation |
| `middleware.py` | `RequestSizeLimitMiddleware`, `SecurityHeadersMiddleware` |
| `routers/` | `auth`, `catalog`, `projects`, `conversations`, `product_context`, `documents` |
| `ai_runtime.py`, `rag.py` | see the `lura-ai-runtime-rag` skill |

## Adding an endpoint

1. Put it in the router that owns the resource. Create a new router only for a genuinely
   new resource, and then register it in `main.py` with `prefix=settings.api_prefix`
   (`/api/v1`). Each router carries its own `prefix` and `tags`.
2. **Authentication:** `context: AuthContext = Depends(require_csrf)` for anything that
   mutates; `current_user: User = Depends(require_auth)` for reads. `require_csrf` already
   depends on `get_auth_context`, so it authenticates too — do not stack both.
3. **Authorization:** filter by owner in the same query, never afterwards:

   ```python
   project = await db.scalar(
       select(Project).where(Project.id == project_id, Project.owner_id == user_id)
   )
   ```

   Use the existing `get_owned_project` / `get_owned_conversation` helpers rather than
   writing a new one. A route that loads by id and then compares ownership in Python is a
   BOLA finding waiting to happen.
4. **Request and response models** go in `schemas.py`. Do not return ORM objects directly;
   follow the `serialize_*` functions in the router.
5. **Eager loading:** use the module-level `selectinload` tuples (`PROJECT_LOAD_OPTIONS`)
   rather than lazy access — the session is async and lazy loads will fail.
6. **Audit:** call `add_audit_log(...)` from `services.py` for state changes, matching the
   surrounding calls.
7. **Rate limiting:** `await rate_limit(redis, key, limit, window_seconds)`. Limits are
   `Settings` fields with `ge`/`le` bounds — add a bounded field rather than a literal.

## Conventions that matter

- Everything is `async`. `db` is an `AsyncSession` from `Depends(get_db)`. Use
  `await db.scalar(...)` / `await db.scalars(...)` / `await db.execute(...)`.
- Times: `utc_now()` and `ensure_utc()` from `services.py`. Never bare `datetime.now()`.
- Errors: `raise HTTPException(status_code=status.HTTP_..., detail="...")` with a message
  safe to show an unauthenticated caller. Never leak internals or whether an account
  exists.
- Config: add a typed field to `Settings` with a default and bounds. Read it via
  `get_settings()`, never `os.environ` in a router.
- Ruff (`E, F, I, UP, B`) with `line-length = 100`. `B008` and `E501` are ignored on
  purpose — `B008` because `Depends()` in a default is the FastAPI idiom.
- Comments in this codebase explain *why*, often at some length. Match that, and do not
  add narration of *what* the line does.

## Middleware order is load-bearing

`main.py` adds `TrustedHost` → `RequestSizeLimit` → `SecurityHeaders` → `CORS`. Starlette
applies middleware outermost-last, so inserting one changes what runs before the body is
read. `RequestSizeLimitMiddleware` gives `POST .../documents` its own larger ceiling
(`document_max_bytes`) while everything else stays at `request_max_bytes` — do not raise
the global limit to accommodate an upload.

## Never

- Read `.env`. `.env.example` documents every variable.
- Log or return a secret, a session token, a CSRF token or a password hash.
- Widen `allow_origins`, `allow_methods` or `allow_headers` without an explicit approval.
- Expose `/docs` in production — `expose_api_docs` gates it deliberately.

## Validation

```
cd apps/api && python -m ruff check .
cd apps/api && python -m pytest -q
```
