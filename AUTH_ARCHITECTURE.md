# Lura Authentication Foundation

Supabase Auth is the authority for **identity**: it owns email registration, address confirmation, passwords and password recovery. `apps/api` remains the authority for **the application**: projects, documents, conversations and every other protected endpoint, guarded by its own server-side session. `apps/web` is a Next.js client; it never stores a password, API key, JWT, or authorization state in local storage.

## Request flow

```text
Sign-in:  Browser -> Supabase Auth -> Supabase session cookie (HttpOnly, set by @supabase/ssr)
                  -> POST /auth/backend-session -> FastAPI verifies the token with Supabase
                  -> Lura session cookie

Requests: Browser -> HttpOnly session cookie -> FastAPI AuthContext -> Session -> User -> protected endpoint
```

Two cookies therefore exist side by side, and both are HttpOnly. The Supabase one answers "who is this person"; the Lura one answers "may this request touch this data". Signing out ends both.

## Supabase identity

`apps/web` talks to Supabase through `@supabase/ssr`, so every token lives in an HttpOnly cookie rather than in local storage, and `middleware.ts` refreshes it on each request. Sign-up, sign-in, recovery and password change all run as Server Actions, so a password is posted once and never reaches client JavaScript.

- `supabase/migrations/` holds the Supabase-side schema; the local Postgres behind `apps/api` is still managed by Alembic and is a separate database.
- `public.profiles` holds one row per `auth.users` record, created by an `after insert` trigger that reads `full_name` out of the sign-up metadata. Row-level security limits both reading and updating to the owner; there is no insert or delete policy, because rows arrive from the trigger and leave with the cascade.
- The trigger functions live in the unexposed `private` schema with `execute` revoked from `anon` and `authenticated`, so nothing security-definer is reachable through the Data API.
- `POST /api/v1/auth/supabase/session` is how a Supabase identity becomes a Lura session. It validates the access token by asking Supabase's own `/auth/v1/user` endpoint, which keeps signing keys out of this service entirely, then refuses any address Supabase has not confirmed. First use creates the local `users` row and an `oauth_accounts` link with provider `supabase`; later calls reuse it.
- The browser never calls that endpoint directly. `POST /auth/backend-session` in the Next.js app does, using the session it already holds, and forwards the backend's cookies. The API client also retries through it once on a `401`, so a live Supabase session with an expired Lura cookie heals itself instead of bouncing the visitor to the login screen.

Password strength is enforced identically on both sides — at least 12 characters with an upper-case letter, a lower-case letter and a digit — so Supabase can never mint an account the backend would have rejected.

Abuse control for registration and sign-in now comes from Supabase's own rate limits rather than Cloudflare Turnstile. Turnstile is still wired into the backend's own `/auth/register` and `/auth/login`; to protect the Supabase-backed screens as well, enable CAPTCHA under **Authentication -> Attack Protection** in the Supabase dashboard.

The database stores only HMAC-SHA256 hashes of session, verification, reset, and CSRF tokens. Passwords are hashed with Argon2id. Both browser cookies are `HttpOnly`; the frontend requests a stable, session-bound CSRF token from `GET /auth/csrf` and keeps it only in memory. State-changing authenticated requests require `X-CSRF-Token`.

## Data model

- `users`: identity, verification status, global role, password-update time, last login, failed-attempt count, and cooldown state.
- `sessions`: independently revocable browser sessions with expiry and CSRF secret.
- `oauth_accounts`: external account links, beginning with Google.
- `verification_tokens` and `password_reset_tokens`: one-time, expiry-bound secrets.
- `audit_logs`: registration, verification, sign-in, password reset, and OAuth events.
- `ai_models`, `skills`, and `tools`: independently managed Lura component catalogs.
- `projects`: user-owned AI system configurations including model, system prompt, and memory state.
- `project_skills` and `project_tools`: explicit component bindings that keep project composition modular.
- `conversations` and `conversation_messages`: durable project chat history, isolated by owner and project.

Workspace roles and permissions are intentionally separate from global user roles. Add `workspaces`, `workspace_members`, `roles`, and `permissions` in the next migration so a person can hold a different role in each workspace.

## Local startup

```powershell
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env.local
docker compose up --build
```

The API starts at `http://localhost:8000`, the Next.js app at `http://localhost:3001`, and API docs at `http://localhost:8000/docs`.

One piece of configuration lives in the Supabase dashboard and has no equivalent in this repository: **Authentication -> URL Configuration**. Supabase already permits any `localhost` redirect, so local development needs nothing, but every other origin has to be added to **Redirect URLs**, and the **Site URL** should name the origin the auth app answers on. An unrecognised redirect is not rejected loudly — the link goes to the Site URL instead.

For a production deployment, serve both applications behind one HTTPS site, set `ENVIRONMENT=production`, `COOKIE_SECURE=true`, set the real `FRONTEND_URL`, and configure Resend, Google OAuth, and Cloudflare Turnstile credentials. Production configuration fails closed when these controls or HTTPS origins are missing. Do not expose database, Redis, CAPTCHA secrets, or provider secrets as `NEXT_PUBLIC_*` variables.

## Auth endpoints

Supabase-backed (called by `apps/web`):

- `POST /api/v1/auth/supabase/session` — exchange a Supabase access token for a Lura session
- `GET /api/v1/auth/supabase/status` — whether the server has Supabase credentials

Next.js route handlers:

- `GET /auth/confirm` — the landing point for every emailed link
- `POST /auth/backend-session` — open or renew the Lura session from the Supabase one
- `POST /auth/signout` — end both sessions

The original password endpoints below remain in place and unchanged:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/csrf`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/sessions`
- `POST /api/v1/auth/sessions/{session_id}/revoke`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/auth/oauth/google/start`
- `GET /api/v1/auth/oauth/google/callback`
- `GET /api/v1/auth/captcha/status`

`require_auth()` and `require_csrf()` are the backend dependencies for protected endpoints. Redis-backed limits apply per IP and per normalized-account HMAC. Repeated login failures trigger Turnstile, exponential cooldown, and audit events. Registration and password reset always require backend-verified Turnstile when enabled. A user can keep at most the configured number of active sessions; password reset revokes them all.

Google uses the authorization-code flow with state and PKCE. A verified Google email may link to the matching internal account; database constraints prevent duplicate provider links. Verification and reset links carry opaque one-time tokens in the URL fragment so web-server access logs do not receive them.

The API rejects oversized request bodies, does not trust forwarded client IP headers unless the direct proxy is allowlisted, returns neutral registration/reset/login responses, and adds no-store and basic hardening headers. In production, retain upstream WAF limits and add a durable email retry queue.

## Verification

```powershell
Set-Location apps/api
python -m pip install -e ".[dev]"
ruff check app alembic tests
pytest -q

Set-Location ../web
npm run lint
npm run build
```

## Lura project endpoints

- `GET /api/v1/catalog/models`
- `GET /api/v1/catalog/skills`
- `GET /api/v1/catalog/tools`
- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/{project_id}`
- `PATCH /api/v1/projects/{project_id}`
- `DELETE /api/v1/projects/{project_id}`

Catalog reads require an active session. Project writes also require `X-CSRF-Token`. The API verifies the project owner and checks that every chosen model, Skill and Tool is enabled before persisting changes.

## Conversation runtime

- `GET /api/v1/projects/{project_id}/conversations`
- `POST /api/v1/projects/{project_id}/conversations`
- `GET /api/v1/conversations/{conversation_id}`
- `POST /api/v1/conversations/{conversation_id}/messages`
- `DELETE /api/v1/conversations/{conversation_id}`

The runtime assembles the project system prompt and enabled Skill instructions on the backend, then sends the bounded message history to the selected provider. It supports server-side OpenAI Responses, Gemini `generateContent`, and Anthropic Messages adapters. Provider credentials are read only from `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`; they are never returned by an API endpoint or exposed as frontend variables. Configured Lura Tools are declared in the project model, but tool execution is deliberately not simulated until each integration has an authorized executor and result-validation contract.
