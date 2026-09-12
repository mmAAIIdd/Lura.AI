---
name: lura-project-context
description: Load first for any work on the Lura repository. Establishes the two-application layout (apps/web Next.js, apps/api FastAPI), the two independent AI runtimes, the ownership and auth invariants, the real validation commands, and the hard boundary between the Claude developer-agent infrastructure and the Lura product. Use whenever a task needs to know where something lives or which subsystem owns it.
---

# Lura — project context

Lura is a B2B product intelligence platform: it connects releases, user feedback, support
signals, documentation and product metrics.

## Layout

```
apps/web/     Next.js 15 + React 19 + TypeScript. The whole product surface:
              public sections, auth screens, account settings, Lura Studio.
              Root path redirects to registration — there is no landing page.
apps/api/     FastAPI backend: users, server-side sessions, OAuth, projects,
              conversations, documents, component catalogs.
supabase/     One SQL migration for the Supabase-side profiles table.
infra/nginx/  Reverse proxy config.
.claude/      Claude developer-agent infrastructure. NOT product code.
.agents/      Vendored third-party skill packs. Inert — see "Vendor skills" below.
```

`docker-compose.yml` defines `postgres`, `redis`, `api`, `web`.

## Two AI runtimes — do not conflate them

| | Studio runtime | API runtime |
|---|---|---|
| Code | `apps/web/lib/studio/**` | `apps/api/app/ai_runtime.py`, `app/rag.py` |
| Provider | Gemini (`GEMINI_API_KEY`) | provider-configurable; `openai_api_key`, `gemini_api_key`, `anthropic_api_key` all exist in `app/config.py` |
| Storage | `.lura-studio/` on disk, **or** Postgres `studio` schema when `STUDIO_DATABASE_URL` is set | the main Postgres database via SQLAlchemy |
| Depends on `apps/api`? | **No.** Studio needs no Postgres, Redis or Python | — |

Studio's storage backend is chosen once at runtime in
`apps/web/lib/studio/store/index.ts`: a connection string means Postgres, otherwise files.
The two are never mixed in one run.

## Invariants

1. **Ownership filtering.** Every query for a user-owned row filters on the owner in the
   same `where` clause as the id — `Project.id == project_id, Project.owner_id == user_id`
   (`apps/api/app/routers/projects.py:69`), same shape in `conversations.py:56`. Fetching
   by id and checking ownership afterwards is the bug this pattern exists to prevent.
2. **Server-side sessions.** Auth is an opaque session cookie whose HMAC hash is stored in
   the database, not a JWT. See the `auth-security` skill.
3. **Public model names.** Studio exposes exactly `lura-pro` and `lura-fast`
   (`apps/web/lib/studio/config.ts`). Which provider model backs them is infrastructure
   detail and must not leak into the UI, stream events, reports or agent answers.
4. **Secrets are server-only.** `GEMINI_API_KEY` and `STUDIO_DATABASE_URL` must never
   carry a `NEXT_PUBLIC_` prefix. Only `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are intentionally public.
5. **API docs are environment-gated.** `/docs`, `/redoc` and `/openapi.json` are served
   only outside production (`apps/api/app/main.py`).

## Validation commands (verified to exist)

```
cd apps/api && python -m pytest -q         # 32 tests, in-memory SQLite + fake Redis
cd apps/api && python -m ruff check .
cd apps/web && npm run lint                # this is tsc --noEmit, not eslint
cd apps/web && npm run build
docker compose up --build postgres redis api
```

`npm run lint` being a typecheck is a real trap — there is no eslint in this repo.

## Documentation

- `README.md` — setup, Supabase configuration, Studio architecture, deployment.
- `AUTH_ARCHITECTURE.md` — data model, security boundaries, endpoints.

Both are partly in Russian, as are many Studio source comments. Match the language of the
file you are editing.

## Developer infrastructure vs product

`.claude/**` configures the Claude agents that build Lura. They are Claude-only, local,
and network-free. That restriction is about the **developer agents** and says nothing
about the product: never remove OpenAI, Gemini or Anthropic support from `apps/**`
because of it.

## Vendor skills

`.agents/skills/` holds third-party packs installed from GitHub (`skills-lock.json`):
twelve Remotion skills and two Supabase ones. **Remotion is not a dependency of Lura** —
`apps/web/package.json` does not reference it. Claude Code does not read `.agents/` at all,
and a deny rule keeps agents out of it. Treat that directory as inert vendor state, never
as project knowledge.
