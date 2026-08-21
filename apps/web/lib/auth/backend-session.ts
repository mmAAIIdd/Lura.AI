const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Exchanges a verified Supabase access token for a `apps/api` session.
 *
 * Supabase owns identity; the FastAPI backend still owns projects, documents
 * and conversations and authenticates those with its own HttpOnly cookie. This
 * hands the backend the Supabase token so it can mint that cookie for the same
 * person, which is what keeps the workspace reachable after a Supabase login.
 *
 * Returns the raw `Set-Cookie` header lines so a route handler can forward them
 * to the browser verbatim, attributes and all.
 */
export async function linkBackendSession(accessToken: string): Promise<string[]> {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/supabase/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((payload: { detail?: string }) => payload.detail)
      .catch(() => undefined);
    throw new Error(detail ?? `Backend session request failed with ${response.status}`);
  }

  // Cookies are not port-scoped, so a cookie the browser receives from this
  // origin (localhost:3001) is also sent to the API on localhost:8000.
  return response.headers.getSetCookie();
}
