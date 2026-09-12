import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getLoginPath } from "@/lib/navigation";
import { studioIsOpen } from "@/lib/studio/access";
import { isSupabaseConfigured, readSupabaseConfig } from "@/lib/supabase/config";

/** Screens a signed-out visitor is allowed to reach. */
const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/auth",
  "/capabilities",
  "/cooperation",
  "/docs",
  "/faq",
  "/pricing",
  "/privacy",
];

/**
 * Адреса, которые приложение вообще обслуживает.
 *
 * Проверка идёт до проверки прав и отвечает на другой вопрос: существует ли
 * такая страница. Без неё опечатка в адресе выглядела для посетителя как
 * «страница под паролем» — middleware отправлял на вход любой неизвестный
 * путь, а `app/not-found.tsx` не открывался вообще никогда.
 *
 * Список ведётся вручную и должен повторять состав `app/`. **Новый закрытый
 * раздел обязательно добавить сюда**: путь, которого здесь нет, считается
 * несуществующим и отдаётся Next как 404, а не защищается входом.
 */
const KNOWN_PREFIXES = [...PUBLIC_PREFIXES, "/studio", "/api/studio"];

/**
 * Корень сравнивается точно, а не префиксом: `/` — это перенаправление на
 * регистрацию в `app/page.tsx`, и если пускать по префиксу, открытым станет
 * весь сайт.
 */
function isRoot(pathname: string): boolean {
  return pathname === "/";
}

/**
 * Рабочее пространство Lura Studio живёт на своём хранилище и своём ключе
 * Gemini, без Supabase. На машине разработчика оно открывается сразу — иначе
 * локальная проверка упирается в круг по OAuth. В продакшене остаётся за
 * авторизацией, пока STUDIO_PUBLIC не разрешит обратное.
 */
function openPrefixes(): string[] {
  return studioIsOpen() ? [...PUBLIC_PREFIXES, "/studio", "/api/studio"] : PUBLIC_PREFIXES;
}

/** Screens that make no sense once signed in. */
const SIGNED_OUT_ONLY_PREFIXES = ["/login", "/register"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Repairs the `Origin: null` a plain form POST arrives with.
 *
 * `Referrer-Policy: no-referrer`, set for every response in next.config.ts,
 * makes Chrome send a literal `Origin: null` on an HTML form submission — the
 * path a form takes when it is submitted before React has hydrated. Next.js
 * then runs `new URL("null")` while checking the Server Action's origin and
 * answers 500 instead of running the action.
 *
 * Sec-Fetch-Site is written by the browser and cannot be set by page script, so
 * `same-origin` is independent proof the POST really came from this site.
 * Restoring the origin only under that proof keeps Next's CSRF check meaningful
 * while removing the crash. Requests that fail the proof are left untouched.
 */
function restoreSameOriginHeader(request: NextRequest): Headers | null {
  if (request.method !== "POST") return null;
  if (request.headers.get("origin") !== "null") return null;
  if (request.headers.get("sec-fetch-site") !== "same-origin") return null;

  const headers = new Headers(request.headers);
  headers.set("origin", request.nextUrl.origin);
  return headers;
}

/**
 * Hands the request on to the application with that repair applied.
 *
 * The repair used to be its own early return, and that return sat above
 * getClaims: a POST carrying `Origin: null` and `Sec-Fetch-Site: same-origin`
 * — two headers curl sets as easily as a browser does — left middleware
 * without ever reaching the authentication check. Sec-Fetch-Site is proof of
 * *provenance* and only inside a browser; it is never proof of identity, so it
 * must not be able to decide who gets in. Routing the repair through the
 * response that continues onwards keeps the pre-hydration form POST working
 * while every request still passes through getClaims below.
 *
 * Rebuilt on each call rather than captured once, because `setAll` writes the
 * refreshed session onto `request.cookies` — a copy of the headers taken
 * earlier would carry the stale cookie into the page.
 */
function passThrough(request: NextRequest): NextResponse {
  const headers = restoreSameOriginHeader(request);
  if (!headers) return NextResponse.next({ request });
  return NextResponse.next({ request: { headers } });
}

/**
 * Refreshes the Supabase session on every request and decides who may see what.
 *
 * The token has to be refreshed here because Server Components cannot write
 * cookies; without this, a session would silently expire mid-visit.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Without configuration there is no session to read. Let the request through
  // so the page itself can render the setup error rather than redirect-looping.
  if (!isSupabaseConfigured()) return NextResponse.next({ request });

  let supabaseResponse = passThrough(request);
  const { url, publishableKey } = readSupabaseConfig();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        supabaseResponse = passThrough(request);
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          supabaseResponse.headers.set(key, value);
        }
      },
    },
  });

  // Nothing may run between createServerClient and getClaims: an early return
  // here would skip the refresh and log people out at random. An early return
  // anywhere *above* is worse still — it skips the authorization branches
  // below, which is why header repair now travels with the response instead of
  // replacing it. getClaims (not getSession) is what makes this trustworthy —
  // it verifies the JWT signature against the project's published keys.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isRoot(pathname) && !matchesPrefix(pathname, openPrefixes())) {
    /* Такой страницы у приложения нет. Пропускаем дальше, чтобы Next отдал
       404 и свою not-found: отправлять на вход за несуществующим адресом —
       значит обещать посетителю страницу, которой не существует. */
    if (!matchesPrefix(pathname, KNOWN_PREFIXES)) return supabaseResponse;

    const redirectUrl = request.nextUrl.clone();
    const loginPath = getLoginPath(`${pathname}${search}`);
    const [loginPathname, loginQuery = ""] = loginPath.split("?");
    redirectUrl.pathname = loginPathname;
    redirectUrl.search = loginQuery;
    return copyCookies(supabaseResponse, NextResponse.redirect(redirectUrl));
  }

  if (signedIn && matchesPrefix(pathname, SIGNED_OUT_ONLY_PREFIXES)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/studio";
    redirectUrl.search = "";
    return copyCookies(supabaseResponse, NextResponse.redirect(redirectUrl));
  }

  return supabaseResponse;
}

/**
 * A redirect replaces the response object, so the refreshed auth cookies have
 * to be carried over by hand or the browser and server fall out of sync.
 */
function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}
