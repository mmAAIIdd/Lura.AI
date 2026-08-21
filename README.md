# Lura

Lura is a B2B product intelligence platform that connects releases, user feedback, support signals, documentation, and product metrics. It helps product teams understand what changed, what happened afterward, which evidence supports a finding, and what hypothesis should be tested next.

## Applications

- `src/` is the existing Vite marketing interface.
- `apps/web/` is the Next.js client for authentication, accounts, and project composition.
- `apps/api/` is the FastAPI backend for users, server-side sessions, OAuth, projects, and component catalogs.

## Supabase setup

Email sign-up and sign-in run on Supabase Auth. Three things have to line up.

1. **Credentials.** Copy the project URL and the publishable key from **Project Settings -> API Keys** into `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env`, and into `apps/web/.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Both values are public by design; no secret or service-role key belongs in either file.

2. **Redirect targets.** Supabase already accepts any `localhost` redirect, so local development works without touching this. For anything else — and before deploying — go to **Authentication -> URL Configuration**, set the **Site URL** to the origin the auth app answers on, and add that origin to **Redirect URLs** as `https://your-host/**`. A redirect Supabase does not recognise is not refused loudly; the link quietly goes to the Site URL instead.

   The Site URL is also worth correcting locally: it still holds the `http://localhost:3000` default, which is the marketing site, not the auth app. Set it to `http://localhost:3001`.

3. **Email template (recommended).** Once the Site URL points at the auth app, go to **Authentication -> Email Templates -> Confirm signup** and replace `{{ .ConfirmationURL }}` with:

   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
   ```

   The stock template works too, and `/auth/confirm` accepts both shapes. The difference is that the stock one carries a PKCE code that only the browser which submitted the form can redeem, so the link fails when it is opened on a phone after registering on a laptop. The token-hash form works from anywhere.

Supabase's built-in mail service is rate limited to a couple of messages an hour and is not meant for production. Configure custom SMTP under **Authentication -> Emails** — the `RESEND_API_KEY` already in `.env` is a natural fit — before real users arrive.

## Run locally

```powershell
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env.local
docker compose up --build postgres redis api
```

The API will be available at `http://localhost:8000` and its OpenAPI docs at `http://localhost:8000/docs`.

In a separate terminal, run the Next.js client:

```powershell
Set-Location apps/web
npm install
npm run dev
```

If port `3001` is already in use, start it on another port:

```powershell
npx next dev --port 3002
```

Read [AUTH_ARCHITECTURE.md](AUTH_ARCHITECTURE.md) for the data model, security boundaries, configuration, and available endpoints.

## Current application foundation

Creating an account and signing in are separate screens. `/register` collects a name, address and password and sends a confirmation letter; `/login` only signs an existing account in. Following the emailed link lands on `/auth/confirm`, which establishes the session and opens `/workspace`. The current backend provides authentication, project isolation, server-side provider access, persistent conversations, component catalogs, rate limiting, and audit events.

Open a project to create persistent conversations. Set one of `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY` in `.env` to activate the corresponding project model. Keys are not sent to the browser. Release ingestion, feedback clustering, metric comparison, RAG retrieval, and evidence-backed analysis remain product modules to implement; the marketing copy does not present them as already available integrations.

## Google OAuth setup

1. In Google Cloud Console create an OAuth 2.0 Client ID of type **Web application**.
2. Add `http://localhost:8000/api/v1/auth/oauth/google/callback` as an authorized redirect URI for local development.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, then restart the `api` container.

The Google sign-in button remains inactive until both backend values are present. Do not use `NEXT_PUBLIC_` or `VITE_` prefixes for either secret.

## CAPTCHA setup

1. Create a Cloudflare Turnstile widget for the frontend hostname.
2. Set `CAPTCHA_PROVIDER=turnstile`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY` in `.env`.
3. Restart both applications.

The site key is intentionally public. The secret remains backend-only. Production startup rejects disabled or incomplete CAPTCHA configuration.
