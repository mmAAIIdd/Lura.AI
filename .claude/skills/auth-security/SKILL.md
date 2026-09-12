---
name: auth-security
description: Lura's authentication and authorization model and its security invariants — the Supabase-identity / FastAPI-session split, two HttpOnly cookies, HMAC token hashing, Argon2id passwords, CSRF, rate limiting and lockout, owner-scoped authorization, and the secret-exposure rules. Use for any change touching auth, sessions, cookies, OAuth, CSRF, CAPTCHA, permissions, uploads, secrets or user-owned resources.
---

# Lura auth and security

Authoritative narrative: `AUTH_ARCHITECTURE.md`. This skill is the invariant list.

## The split

**Supabase Auth owns identity** — email registration, address confirmation, passwords,
recovery. **`apps/api` owns the application** — projects, documents, conversations, every
protected endpoint, guarded by its own server-side session.

```
Sign-in:  Browser → Supabase Auth → Supabase cookie (HttpOnly, @supabase/ssr)
                  → POST /auth/backend-session → FastAPI verifies the token with Supabase
                  → Lura session cookie
Requests: Browser → HttpOnly Lura cookie → AuthContext → Session → User → endpoint
```

Two HttpOnly cookies coexist. The Supabase one answers *who is this person*; the Lura one
answers *may this request touch this data*. Signing out must end both.

`POST /api/v1/auth/supabase/session` validates an access token by asking Supabase's own
`/auth/v1/user`. That is deliberate: **no signing key is ever stored in this service.** Do
not "optimize" it into local JWT verification. It also refuses any address Supabase has not
confirmed.

The browser never calls that endpoint directly — `POST /auth/backend-session` in the
Next.js app does, forwarding the backend's cookies, and the API client retries through it
once on a `401` so an expired Lura cookie heals instead of bouncing the user to login.

## Invariants

1. **Nothing stores a raw secret.** The database keeps HMAC-SHA256 hashes of session,
   verification, reset and CSRF tokens (`apps/api/app/security.py`). Passwords are Argon2id
   (`time_cost=3, memory_cost=65536, parallelism=4`). Never persist, log or return a raw
   token.
2. **`hmac.compare_digest` for every secret comparison** — `compare_token()`. Never `==`.
3. **CSRF on every state-changing authenticated request.** `Depends(require_csrf)` checks
   `X-CSRF-Token` against the session-bound token. The frontend gets it from
   `GET /auth/csrf` and keeps it in memory only.
4. **Authorization is owner-scoped and in-query.** `Project.id == project_id,
   Project.owner_id == user_id` in one `where`. Loading by id then checking ownership in
   Python is the BOLA pattern this codebase avoids everywhere.
5. **Session validity is checked fully.** `get_auth_context` rejects missing, revoked and
   expired sessions, then requires `UserStatus.ACTIVE` and `email_verified`. A shortcut
   that only looks up the token hash is a hole.
6. **Login does not leak account existence.** `dummy_password_hash` keeps the timing of a
   nonexistent account indistinguishable. Error text must not reveal which factor failed.
7. **Password policy is enforced on both sides** — at least 12 characters with upper, lower
   and a digit — so Supabase cannot mint an account the backend would reject. Change one
   side only and the pair breaks.
8. **Rate limiting and lockout** are Redis-backed with bounded `Settings` fields:
   `login_ip_limit`, `login_account_limit`, `login_captcha_threshold`,
   `login_lock_threshold`, `login_lock_seconds`, and register/reset equivalents. Never
   remove a limit to make a test or a flow easier.
9. **Audit the security events.** `add_audit_log` for registration, verification, sign-in,
   password reset and OAuth.
10. **Production fails closed.** `config.py` raises when Google OAuth is unconfigured or
    the redirect URI is not HTTPS in production. `COOKIE_SECURE=true` and
    `ENVIRONMENT=production` are required. Do not relax a production guard for local
    convenience — use the development default instead.

## Secret rules

- Never read, print, copy or commit `.env` or `apps/web/.env.local`. `.env.example`
  documents every variable; use it.
- Never put a secret in a log line, an error response, a test fixture that is not obviously
  fake, a skill, or an agent's context.
- Never expose database, Redis, CAPTCHA or provider secrets as `NEXT_PUBLIC_*`. In Next.js
  that prefix ships the value to the browser.
- `service_role` keys never reach client code. Publishable keys only.
- Supabase `user_metadata` is user-editable — never use it for an authorization decision.
  Use `app_metadata`.

## Where things live

```
apps/api/app/security.py       Argon2, HMAC hashing, CSRF derivation, compare_token
apps/api/app/dependencies.py   AuthContext, require_auth, require_admin, require_csrf
apps/api/app/auth/             sessions.py, oauth.py, supabase.py, captcha.py
apps/api/app/routers/auth.py   registration, login, reset, OAuth, session management
apps/api/app/services.py       rate_limit, add_audit_log, create_session, tokens
apps/api/app/middleware.py     request size limits, security headers
apps/web/lib/supabase/         client / server / middleware Supabase clients
supabase/migrations/           RLS policies — see the postgres-supabase skill
```

Tests that encode these rules: `apps/api/tests/test_auth_flows.py`,
`test_oauth_security_database.py`, `test_supabase_session.py`, `test_captcha.py`. A change
here that does not run them is unverified.

## Known open item

`AUTH_ARCHITECTURE.md` records that workspace roles are intentionally separate from global
user roles, and that `workspaces`, `workspace_members`, `roles` and `permissions` are
planned for a future migration. They do not exist yet — do not assume a workspace
permission layer is available.
