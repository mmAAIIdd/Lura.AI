import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSupabaseConfig } from "@/lib/supabase/config";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Ends both sessions: the Supabase one that proves who you are, and the
 * `apps/api` one the workspace runs on. Leaving either behind would let the
 * next page load quietly sign the visitor back in.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });

  // The cookie adapter writes straight onto the response being returned. Going
  // through next/headers would not do: those writes land on the implicit
  // response, not on this one.
  const { url, publishableKey } = readSupabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });
  await supabase.auth.signOut();

  await endBackendSession(request, response);
  return response;
}

/**
 * Revokes the backend session through its normal, CSRF-protected logout, then
 * passes the cookie-clearing headers on to the browser. Best effort: a backend
 * that is down must not leave the visitor stuck signed in to Supabase.
 */
async function endBackendSession(request: NextRequest, response: NextResponse): Promise<void> {
  const cookie = request.headers.get("cookie");
  if (!cookie) return;

  try {
    const csrfResponse = await fetch(`${apiBaseUrl}/api/v1/auth/csrf`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!csrfResponse.ok) return;
    const { csrf_token: csrfToken } = (await csrfResponse.json()) as { csrf_token: string };

    const logoutResponse = await fetch(`${apiBaseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
      cache: "no-store",
    });
    for (const setCookie of logoutResponse.headers.getSetCookie()) {
      response.headers.append("set-cookie", setCookie);
    }
  } catch {
    // The backend cookie is useless without a Supabase session and expires on
    // its own; the sign-out above is the part that has to succeed.
  }
}
