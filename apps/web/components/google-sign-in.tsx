"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { getSafeNextPath } from "@/lib/api";
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
 * The whole of signing in. Google is the only provider, so there is no separate
 * registration: a first sign-in creates the account, and every later one finds
 * it by the same address.
 *
 * Supabase sends the browser back to /auth/confirm with a `code`, which that
 * route exchanges for the session cookies — the same path an emailed link used
 * to take, so nothing downstream had to change.
 */
export function GoogleSignIn() {
  const params = useSearchParams();
  const nextPath = getSafeNextPath(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [providerOff, setProviderOff] = useState(false);

  /* signInWithOAuth does not check that the provider exists — it builds a URL
     and hands the browser to it. With Google switched off in the Supabase
     project, that URL answers with a raw JSON error which the browser then
     displays as the page. Asking the project what it has enabled turns that
     dead end into a sentence. */
  useEffect(() => {
    let cancelled = false;
    try {
      const { url, publishableKey } = readSupabaseConfig();
      fetch(url + "/auth/v1/settings", { headers: { apikey: publishableKey } })
        .then((response) => (response.ok ? response.json() : null))
        .then((settings) => {
          if (!cancelled && settings?.external?.google === false) setProviderOff(true);
        })
        .catch(() => {
          // Unreachable settings prove nothing; leave the button up.
        });
    } catch {
      // Missing configuration is reported by the sign-in attempt itself.
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function startSignIn() {
    setPending(true);
    setError(null);
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

  return (
    <AuthShell
      title="Вход в Lura"
      subtitle="Аккаунт создаётся при первом входе — отдельная регистрация не нужна."
    >
      {providerOff ? (
        <p className="form-error" role="alert">
          Вход через Google ещё не подключён к этому проекту Supabase. Включите провайдера
          в Authentication → Providers, и кнопка заработает.
        </p>
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
