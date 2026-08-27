# Lura

Lura is a B2B product intelligence platform that connects releases, user feedback, support signals, documentation, and product metrics. It helps product teams understand what changed, what happened afterward, which evidence supports a finding, and what hypothesis should be tested next.

## Applications

- `apps/web/` is the whole product: public sections, Google sign-in, account settings and the Lura Studio workspace. There is no landing page and no separate marketing site — the root path redirects to registration.
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

## Lura Studio — рабочее пространство с агентом

`/studio` в приложении `apps/web` — рабочее пространство, где агент разбирает продукт по данным команды. Оно не зависит от `apps/api`: ни Postgres, ни Redis, ни Python ему не нужны. Всё состояние лежит в папке `.lura-studio` рядом с приложением, а единственная внешняя зависимость — Gemini API.

```powershell
# apps/web/.env.local
GEMINI_API_KEY=<ключ из Google AI Studio>

cd apps/web
npm run dev     # http://localhost:3001/studio
```

**Как это устроено.** Слева — загрузка документов и переключатель двух режимов вывода: «Отчёты» (разбор по данным с поиском и доказательством) и «Обновления» (отчёты по релизам). Один документ помечается как документ о бизнесе: он целиком уходит в системную инструкцию на каждом запросе, поэтому агент всегда знает, чей продукт разбирает. Остальные документы режутся на фрагменты, индексируются эмбеддингами `gemini-embedding-001` и ищутся косинусной близостью; если эмбеддинги недоступны, поиск переключается на ключевые слова, а не отключается.

**Пайплайн.** Агент отвечает строго шестью разделами — что изменилось, что произошло после, какие проблемы найдены, почему это могло произойти, что стоит сделать, как проверить результат. Сначала факты, потом анализ, потом гипотезы и только затем рекомендации. Инструменты у него три: `search_documents`, `web_search`, `fetch_url`.

### Deploy на Vercel

Рабочее пространство разворачивается отдельным проектом: в корне репозитория лежит конфиг маркетингового сайта на Vite, а студия живёт в Next.js-приложении.

1. **Проект.** Vercel → Add New Project → этот репозиторий → **Root Directory = `apps/web`**. Ссылка получится `https://<проект>.vercel.app/studio`.

2. **Хранилище.** На бессерверной площадке файловая система доступна только для чтения, поэтому состояние должно уйти в Postgres. В Supabase откройте **Connect → Transaction pooler** (порт 6543) и положите строку в `STUDIO_DATABASE_URL`. Схему `studio` и таблицы приложение создаст само при первом обращении; если у роли нет прав на DDL, примените вручную `apps/web/supabase/studio.sql`. Расширение `vector` должно быть включено — Supabase → Database → Extensions.

   Схема называется `studio`, а не `public`, намеренно: PostgREST публикует только `public`, а публикуемый ключ проекта уходит в браузерный бандл — документы команды в `public` читал бы кто угодно с этим ключом.

3. **Переменные.** `GEMINI_API_KEY` (только серверная, без `NEXT_PUBLIC_`), `STUDIO_DATABASE_URL`, уже существующие `NEXT_PUBLIC_SUPABASE_*`. По желанию `BRAVE_API_KEY` для поиска и `STUDIO_PUBLIC=true`, если студию нужно открыть без входа — по умолчанию в продакшене она за авторизацией.

4. **Время функции.** Разбор с поиском и чтением страниц идёт от 20 секунд до нескольких минут, в коде стоит `maxDuration = 300`. На Hobby-плане потолок короче, и длинный разбор оборвётся на середине.

**Поиск в интернете.** `STUDIO_SEARCH=auto` пробует провайдеров по порядку: Brave (по `BRAVE_API_KEY`), Tavily (по `TAVILY_API_KEY`), googleSearch у Gemini (включается вместе с биллингом проекта) и DuckDuckGo без ключа. Если не отвечает никто, агент не выдумывает ссылки: он пишет в отчёте, что внешние источники собрать не удалось.

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

## Развёртывание

Приложение одно: `apps/web`. Разделы сайта, регистрация и рабочее пространство
живут в нём вместе, поэтому и деплой один — отдельного проекта под маркетинг
больше нет.

**Куда ставить.** Рабочее пространство держит потоковое соединение всё время
разбора — от двадцати секунд до нескольких минут. На бессерверной площадке это
упирается в лимит времени функции: на Vercel Hobby он около минуты, на Pro —
300 секунд. Всегда включённый контейнер такого ограничения не имеет и обычно
стоит дешевле: в [apps/web/Dockerfile](apps/web/Dockerfile) уже лежит сборка
standalone-сервера Next, готовая для Railway, Fly, Render или своего сервера.

**Если всё-таки Vercel.** Root Directory — `apps/web`; остальное берётся из
[apps/web/vercel.json](apps/web/vercel.json), и переопределения в панели надо
выключить, иначе они его перебивают. Файловая система там доступна только для
чтения, поэтому обязателен `STUDIO_DATABASE_URL` — состояние уходит в Postgres.

**Переменные.** `GEMINI_API_KEY` и `STUDIO_DATABASE_URL` — только серверные.
`NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` нужны для
входа. `NEXT_PUBLIC_SITE_URL` необязателен: без него ссылки подтверждения
падают на собственный домен проекта.

**Supabase.** В **Authentication → URL Configuration** укажите домен приложения
как Site URL и добавьте `https://этот-домен/**` в Redirect URLs. Неизвестный
Supabase адрес не отвергается громко — ссылка просто уходит на Site URL.

`apps/api/` — контейнер, на Vercel не разворачивается; ему нужен хост с Docker.

## Current application foundation

Creating an account and signing in are separate screens. `/register` collects a name, address and password and sends a confirmation letter; `/login` only signs an existing account in. Following the emailed link lands on `/auth/confirm`, which establishes the session and opens `/workspace`. The current backend provides authentication, project isolation, server-side provider access, persistent conversations, component catalogs, rate limiting, and audit events.

Open a project to create persistent conversations. Set one of `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY` in `.env` to activate the corresponding project model. Keys are not sent to the browser. Release ingestion, feedback clustering, metric comparison, RAG retrieval, and evidence-backed analysis remain product modules to implement; the marketing copy does not present them as already available integrations.

## Google sign-in

Google is the only way in. `apps/web` has no password form: `/login` offers one
button, a first sign-in creates the account, and `/register` redirects there
because with OAuth the two are the same action.

The exchange runs through Supabase Auth, not through `apps/api` — which is why
sign-in works with the backend offline. Two dashboards have to agree:

1. **Google Cloud Console** — create an OAuth 2.0 Client ID of type **Web
   application**, and add Supabase's callback as an authorized redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback`. This is the only
   redirect Google needs; the app's own URL never appears here.
2. **Supabase → Authentication → Providers → Google** — enable it and paste the
   client ID and secret. The secret stays in Supabase and never reaches a
   `.env` file or a browser bundle.

Until the provider is enabled, `/login` says so instead of showing the button:
`signInWithOAuth` does not check that a provider exists, it just hands the
browser to an authorize URL that answers with raw JSON, so the screen asks the
project what it has enabled before offering to use it.

The `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` belong to
`apps/api`'s own OAuth endpoints and are unrelated to the sign-in above.

## CAPTCHA setup

1. Create a Cloudflare Turnstile widget for the frontend hostname.
2. Set `CAPTCHA_PROVIDER=turnstile`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY` in `.env`.
3. Restart both applications.

The site key is intentionally public. The secret remains backend-only. Production startup rejects disabled or incomplete CAPTCHA configuration.
