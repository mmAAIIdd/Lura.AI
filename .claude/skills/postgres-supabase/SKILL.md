---
name: postgres-supabase
description: Rules for Lura's three separate Postgres surfaces — the Alembic-managed application database in apps/api, the Studio schema in apps/web/supabase/studio.sql, and the Supabase-managed public schema with RLS in supabase/migrations. Use when writing migrations, changing models, writing SQL, or touching row-level security policies.
---

# Lura database surfaces

Three distinct surfaces. Changing one never implies changing another — identify which one
the task is about before writing anything.

| Surface | Migrations | Managed by |
|---|---|---|
| Application DB | `apps/api/alembic/versions/` | Alembic, models in `apps/api/app/models.py` |
| Studio state | `apps/web/supabase/studio.sql` | the app creates the `studio` schema on first use |
| Supabase public | `supabase/migrations/*.sql` | Supabase, RLS-enforced |

## Application database (Alembic)

Chained, sequentially named revisions: `0001_auth_foundation` … `0007_workspace_rag`. Each
file sets `revision` and `down_revision` explicitly.

- A new migration continues the chain: `revision = "0008_<slug>"`,
  `down_revision = "0007_workspace_rag"`. Never fork the chain or renumber an existing one.
- Model change and migration are one change. A `models.py` edit without a migration leaves
  the deployed database behind.
- Write a real `downgrade()`. If a downgrade genuinely cannot restore data, say so in the
  docstring rather than leaving an empty body.
- Postgres-specific types come from `sqlalchemy.dialects.postgresql`. The engine is
  `asyncpg`, but Alembic migrations are ordinary synchronous `op` calls.
- Data seeded by a migration (`0007` registers a default model row) uses a fixed UUID so
  re-running is idempotent. Follow that when seeding.
- Never edit a migration that has already been applied anywhere — add a new one.

## Studio schema

Deliberately named `studio`, **not** `public`. From `README.md`: PostgREST publishes only
`public`, and the project's publishable key ships in the browser bundle — team documents in
`public` would be readable by anyone holding that key. Do not move Studio tables to
`public` and do not expose the `studio` schema through the Data API.

Requires the `vector` extension. `STUDIO_DATABASE_URL` should be the Supabase transaction
pooler (port 6543). If the role cannot run DDL, `apps/web/supabase/studio.sql` is applied
by hand.

## Supabase public schema and RLS

`supabase/migrations/20260820145959_create_profiles_with_auth_user_sync.sql` is the
reference for how this repository writes policies. Follow its patterns:

- `alter table ... enable row level security;` on every table in an exposed schema.
- Policies target a role explicitly: `to authenticated`. Do not use `auth.role()` — it is
  deprecated, and it passes for anonymous sign-ins because they also carry the
  `authenticated` Postgres role.
- Wrap the identity call: `(select auth.uid()) = id`. The subquery form lets the planner
  evaluate it once per statement instead of once per row.
- Grant only what is used: `grant select, update on public.profiles to authenticated`.
- **Omit a policy you do not want.** That file has no insert or delete policy on purpose —
  rows arrive by trigger and leave by cascade. Absence of a policy is the denial.
- An `update` also needs a `select` policy to match rows; without one the update silently
  affects zero rows and raises no error.
- Privileged helpers live in a `private` schema with `revoke all ... from anon,
  authenticated`, so `security definer` code is not reachable as a PostgREST endpoint.
- Views bypass RLS. Create them `with (security_invoker = true)` or keep them out of an
  exposed schema.

## Never

- Put a `service_role` or secret key anywhere reachable from the browser. Publishable keys
  only in frontend code.
- Use `user_metadata` / `raw_user_meta_data` in an authorization decision — it is
  user-editable. Authorization data belongs in `app_metadata`.
- Build SQL by string concatenation. Use SQLAlchemy constructs or bound parameters.
- Run a migration against a live database as part of an investigation.
- Loosen or drop a constraint or policy as a fix without routing it through the approval
  gate — that is a security change.

## Validation

There is no migration test harness. After a model or migration change run
`cd apps/api && python -m pytest -q` (the suite builds its schema from `Base.metadata` on
in-memory SQLite, so it validates the models, **not** the migration) and state plainly that
the migration itself was not executed.
