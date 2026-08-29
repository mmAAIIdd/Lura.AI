"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { getSafeNextPath } from "@/lib/navigation";
import { describeAuthError } from "@/lib/auth/errors";
import { createClient } from "@/lib/supabase/client";
import { readSupabaseConfig } from "@/lib/supabase/config";

/** Google's mark, drawn rather than loaded: no request to a third party from a
 *  sign-in screen, and it stays sharp at any size. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * Three states worth telling apart, because each has a different fix and they
 * are indistinguishable from the button alone.
 */
type Availability = "unknown" | "ready" | "provider-off" | "unreachable";

const BLOCKED_MESSAGE: Record<string, string> = {
  "provider-off":
    "Вход через Google не подключён к этому проекту Supabase. Включите провайдера в Authentication → Providers.",
  unreachable:
    "Supabase не принял ключ проекта или недоступен. Проверьте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY в настройках развёртывания.",
};

/**
 * Asks the project what it has enabled.
 *
 * A rejected key and a disabled provider both leave the button useless, but
 * they are different problems: one is a wrong value in the deployment, the
 * other a switch in the Supabase dashboard. Reporting them as one thing is how
 * a truncated key spent an afternoon looking like a Google problem.
 */
async function readAvailability(): Promise<Availability> {
  try {
    const { url, publishableKey } = readSupabaseConfig();
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } });
    if (!response.ok) return "unreachable";
    const settings = await response.json();
    return settings?.external?.google ? "ready" : "provider-off";
  } catch {
    return "unreachable";
  }
}

/**
 * The whole of signing in. Google is the only provider, so there is no separate
 * registration: a first sign-in creates the account, and every later one finds
 * it by the same address.
 *
 * Supabase sends the browser back to /auth/confirm with a `code`, which that
 * route exchanges for the session cookies — the same path an emailed link used
 * to take, so nothing downstream had to change.
 */
export function GoogleSignIn({ mode = "login" }: { mode?: "login" | "register" }) {
  const params = useSearchParams();
  const nextPath = getSafeNextPath(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [availability, setAvailability] = useState<Availability>("unknown");
  const availabilityRef = useRef<Availability>("unknown");

  function remember(next: Availability) {
    availabilityRef.current = next;
    setAvailability(next);
  }

  // Answers before anyone reaches for the button, so a project that cannot
  // sign anyone in says so rather than offering a control that dead-ends.
  useEffect(() => {
    let cancelled = false;
    void readAvailability().then((result) => {
      if (!cancelled) remember(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function startSignIn() {
    setPending(true);
    setError(null);

    // Checked again here rather than trusted from mount: the answer may not
    // have arrived yet, and signInWithOAuth does not validate anything — it
    // builds an authorize URL and hands the browser over, so a provider that is
    // off answers with raw JSON that the browser renders as the page.
    let state = availabilityRef.current;
    if (state !== "ready") {
      state = await readAvailability();
      remember(state);
    }
    if (state !== "ready") {
      setPending(false);
      return;
    }

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(nextPath)}` },
      });
      // On success the browser leaves for Google and never returns to this
      // render, so only the failure path has anything to reset.
      if (signInError) {
        setError(describeAuthError(signInError, "Не удалось начать вход через Google."));
        setPending(false);
      }
    } catch (caught) {
      setError(describeAuthError(caught, "Не удалось начать вход через Google."));
      setPending(false);
    }
  }

  const blocked = BLOCKED_MESSAGE[availability];

  return (
    <AuthShell
      variant={mode}
      title={mode === "register" ? "Начните с Lura" : "Вход в Lura"}
      subtitle={mode === "register" ? "Твой менеджер для бизнеса" : "Продолжите работу со своими проектами."}
    >
      {blocked ? (
        <p className="form-error" role="alert">{blocked}</p>
      ) : (
        <button className="button button-google" type="button" onClick={startSignIn} disabled={pending} aria-busy={pending}>
          <GoogleMark />
          {pending ? "Открываем Google..." : "Продолжить с Google"}
        </button>
      )}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </AuthShell>
  );
}
