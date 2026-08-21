import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getSafeNextPath } from "@/lib/api";
import { linkBackendSession } from "@/lib/auth/backend-session";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for every emailed link: signup confirmation, password recovery
 * and email-change confirmation.
 *
 * Two link shapes are accepted so the flow works whichever email template the
 * project uses:
 *   - `token_hash` + `type`, from a template using `{{ .TokenHash }}`. This one
 *     also works when the link is opened in a different browser.
 *   - `code`, from the stock `{{ .ConfirmationURL }}` template, which relies on
 *     the PKCE verifier cookie set when the form was submitted.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = getSafeNextPath(searchParams.get("next"));

  // Supabase reports an unusable link with these instead of a token.
  const linkError = searchParams.get("error_description") ?? searchParams.get("error");
  if (linkError) return errorRedirect(request, "link");

  const supabase = await createClient();

  let verified = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    verified = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  } else {
    return errorRedirect(request, "missing");
  }

  if (!verified) return errorRedirect(request, "link");

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

function errorRedirect(request: NextRequest, reason: "link" | "missing") {
  const url = request.nextUrl.clone();
  url.pathname = "/auth/error";
  url.search = `?reason=${reason}`;
  return NextResponse.redirect(url);
}
