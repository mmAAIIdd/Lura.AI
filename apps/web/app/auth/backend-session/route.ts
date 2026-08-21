import { NextResponse } from "next/server";

import { linkBackendSession } from "@/lib/auth/backend-session";
import { createClient } from "@/lib/supabase/server";

/**
 * Opens (or renews) the `apps/api` session for the currently signed-in Supabase
 * user, and forwards the backend's cookies to the browser.
 *
 * Called right after sign-in, and again by the workspace if its first backend
 * call comes back unauthorized — which is what makes a returning visitor with a
 * live Supabase session but an expired backend cookie heal itself.
 */
export async function POST() {
  const supabase = await createClient();

  // getClaims verifies the JWT signature; getSession alone would trust a cookie.
  const { data: verified } = await supabase.auth.getClaims();
  if (!verified?.claims) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    return NextResponse.json({ error: "No active session" }, { status: 401 });
  }

  try {
    const cookiesToForward = await linkBackendSession(accessToken);
    const response = NextResponse.json({ ok: true });
    for (const cookie of cookiesToForward) response.headers.append("set-cookie", cookie);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backend session failed" },
      { status: 502 },
    );
  }
}
