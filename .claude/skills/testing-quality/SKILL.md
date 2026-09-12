---
name: testing-quality
description: Lura's real validation commands and test conventions — pytest against in-memory SQLite with a fake Redis, ruff, the tsc-based npm run lint, and the Next.js build. Use when running or writing tests, choosing what to validate after a change, or interpreting a failure.
---

# Lura validation

## The commands that exist

| Purpose | Command |
|---|---|
| Backend tests | `cd apps/api && python -m pytest -q` |
| One file | `cd apps/api && python -m pytest tests/test_auth_flows.py -q` |
| One test | `cd apps/api && python -m pytest -k "fragment" -q` |
| Backend lint | `cd apps/api && python -m ruff check .` |
| Frontend typecheck | `cd apps/web && npm run lint` |
| Frontend build | `cd apps/web && npm run build` |
| Full stack | `docker compose up --build postgres redis api` |

Two traps worth knowing:

- **`npm run lint` is `tsc --noEmit`**, not eslint. There is no eslint in this repo, so
  "lint passes" here means "types check".
- There is **no frontend test runner**. Frontend verification is typecheck plus build plus
  reasoning about the code. Do not claim frontend tests ran.

## Backend test environment

`apps/api/tests/conftest.py` sets the environment before importing the app:
`ENVIRONMENT=test`, in-memory SQLite (`sqlite+aiosqlite:///:memory:`), a `FakeRedis` class,
and fixture credentials.

Consequences:

- `pytest` needs **no Docker, no Postgres, no Redis**. It is fast; run it.
- The schema is built from `Base.metadata`, so the tests validate `models.py` but **never
  execute an Alembic migration**. A migration is unverified by the suite — say so.
- SQLite is not Postgres. Postgres-specific SQL, `JSONB` operators and dialect types may
  pass here and fail in production. Flag that rather than treating green as proof.
- The env values in `conftest.py` are fake fixtures, not secrets.

Current suite: 32 tests across `test_auth_flows.py`, `test_captcha.py`,
`test_oauth_security_database.py`, `test_supabase_session.py`. `pytest-asyncio` runs in
`asyncio_mode = "auto"`, so `async def test_*` needs no decorator.

## Writing tests

- New backend tests go in `apps/api/tests/`, following existing fixtures and
  `helpers.py`. Use the httpx client fixture rather than building your own.
- Test the behaviour, not the implementation. Auth tests here assert real outcomes —
  a revoked session is refused, an unconfirmed address cannot open a session.
- A security-relevant change needs a test that fails without the fix. A test written to
  match whatever the code does proves nothing.

## Choosing what to run

| Change touches | Run |
|---|---|
| `apps/api/app/auth/**`, `dependencies.py`, `security.py`, `models.py`, `middleware.py` | full `pytest` + `ruff` |
| a single backend router | targeted tests, then full `pytest` + `ruff` |
| `apps/web/**` | `npm run lint`; add `npm run build` for routing, config or server/client boundary changes |
| migrations | `pytest` (models only) and state explicitly that the migration was not executed |

## Reporting

- Paste real output. Counts, failure names, tracebacks.
- Never claim a command passed unless it ran.
- Separate a new regression from a failure that was already there — check before blaming
  the change.
- If a test fails for an environmental reason (no Docker, missing service), say that
  rather than recording a product failure.
- Never weaken or skip an assertion to get green. A test that looks wrong is a finding to
  report, not an obstacle to remove.
