---
name: nextjs-frontend
description: Rules for changing the Lura Next.js app in apps/web — App Router layout, server vs client component boundaries, route handlers under app/api/studio, the Supabase SSR client trio, middleware, the NEXT_PUBLIC secret rule, and styling conventions. Use when editing pages, components, route handlers, middleware or frontend configuration.
---

# Lura Next.js frontend

Next.js 15 (App Router), React 19, TypeScript `strict`, no CSS framework and no component
library. Dev server runs on port **3001** (`npm run dev`).

## Layout

```
app/(sections)/      public product sections (route group, no URL segment)
app/login, register, forgot-password, reset-password, verify-email, auth/
app/settings/, app/workspace/
app/studio/          Lura Studio workspace UI
app/api/studio/      route handlers: run, documents, files, artifacts, threads, workspace
components/          auth-shell, google-sign-in, lura-logo, sections/, studio/
lib/studio/          Studio domain logic — see the lura-ai-runtime-rag skill
lib/supabase/        client.ts (browser) · server.ts (RSC/actions) · middleware.ts · config.ts
lib/auth/errors.ts   auth error normalization
middleware.ts        root middleware
app/globals.css      all styling
```

Import alias: `@/*` maps to the app root (`@/lib/studio/store`). Use it; do not write deep
relative chains.

## Server / client boundary

- Components are **server components by default**. Add `"use client"` only when the file
  needs state, effects, refs or browser APIs — and push it as far down the tree as it will
  go, so pages stay server-rendered.
- Anything reading a server-only secret must stay on the server. `geminiKey()` and
  `databaseUrl()` read `process.env` in `lib/studio/` and must never be imported into a
  client component — the import graph is what leaks a key, not the usage.
- Pick the right Supabase client: `lib/supabase/client.ts` in browser code,
  `lib/supabase/server.ts` in server components and actions, `lib/supabase/middleware.ts`
  in middleware. They are separate because their cookie handling differs; mixing them
  produces sessions that silently do not refresh.
- `middleware.ts` runs in the **edge runtime**. No `node:` imports there, directly or
  transitively. `lib/studio/access.ts` exists as a standalone file for exactly this
  reason — it holds `studioIsOpen()` with no `node:path` import, unlike `config.ts`.

## The NEXT_PUBLIC rule

Any `NEXT_PUBLIC_*` variable is inlined into the browser bundle.

Public by design: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
optionally `NEXT_PUBLIC_SITE_URL`.

Server-only, never prefixed: `GEMINI_API_KEY`, `STUDIO_DATABASE_URL`, `BRAVE_API_KEY`,
`TAVILY_API_KEY`. Adding `NEXT_PUBLIC_` to one of these is a critical security defect.

## Route handlers

`app/api/studio/*/route.ts`. They are the server boundary for Studio, so they validate
input themselves — a `route.ts` that trusts its request body is the hole. `studioIsOpen()`
decides whether Studio is reachable without a session: open in development, behind auth in
production unless `STUDIO_PUBLIC=true`.

`app/api/studio/run/route.ts` streams for 20 seconds to several minutes and sets
`maxDuration = 300`. Do not lower it, and do not convert the stream to a buffered response.

## TypeScript

`strict` is on, `noEmit`, `isolatedModules`, `moduleResolution: bundler`. No `any` to
silence an error — model the type. `npm run lint` **is the typecheck** (`tsc --noEmit`);
there is no eslint configured in this repo.

## Styling

Plain CSS in `app/globals.css` with `st-`-prefixed class names for Studio. No Tailwind, no
CSS modules, no styled-components. Fonts come from `@fontsource-variable/inter` and
`@fontsource-variable/source-serif-4`. Do not introduce a styling dependency.

## Never

- Add a UI or state-management dependency without explicit approval — the dependency list
  in `package.json` is deliberately short.
- Render a raw provider model name in the UI. Studio exposes only `lura-pro` and
  `lura-fast`.
- Read `.env.local` or print an environment value.

## Validation

```
cd apps/web && npm run lint
cd apps/web && npm run build
```
