import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getSafeNextPath } from "@/lib/api";
import { linkBackendSession } from "@/lib/auth/backend-session";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for the sign-in round trip: Google hands the visitor to
 * Supabase, Supabase hands them here.
 *
 * Two shapes are accepted. `code` is the PKCE one every OAuth sign-in uses,
 * redeemed against the verifier cookie stored when the button was pressed.
 * `token_hash` + `type` is kept because Supabase still uses it for anything it
 * mails out, and it costs four lines to keep working.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = getSafeNextPath(searchParams.get("next"));

  // Supabase reports a failed hand-off with these instead of a code. The text
  // it sends is the only account of what actually went wrong — Google refusing
  // the client, a secret that does not match, an address not on the tester
  // list — so it travels to the error screen rather than being replaced there
  // with a guess.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) return errorRedirect(request, "provider", providerError);

  const supabase = await createClient();

  let failure: string | null = null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failure = error?.message ?? null;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failure = error?.message ?? null;
  } else {
    return errorRedirect(request, "missing");
  }

  if (failure) return errorRedirect(request, "exchange", failure);

  const destination = request.nextUrl.clone();
  destination.pathname = next.split("?")[0];
  destination.search = next.includes("?") ? `?${next.split("?").slice(1).join("?")}` : "";
  const response = NextResponse.redirect(destination);

  // A recovery link must not also open a backend session: the visitor still has
  // to choose a new password before that counts as a real sign-in.
  if (type !== "recovery" && next !== "/reset-password") {
    await attachBackendSession(response);
  }
  return response;
}

/** Best-effort: a backend that is unavailable must not break email confirmation. */
async function attachBackendSession(response: NextResponse): Promise<void> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return;
    for (const cookie of await linkBackendSession(accessToken)) {
      response.headers.append("set-cookie", cookie);
    }
  } catch {
    // The workspace retries this on its first unauthorized backend call.
  }
}

function errorRedirect(request: NextRequest, reason: "provider" | "exchange" | "missing", detail?: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/auth/error";
  url.search = "";
  url.searchParams.set("reason", reason);
  // Truncated because it lands in a URL, and it is a description rather than a
  // credential — Supabase does not put tokens in these.
  if (detail) url.searchParams.set("detail", detail.slice(0, 200));
  return NextResponse.redirect(url);
}
