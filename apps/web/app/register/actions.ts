"use server";

import { describeAuthError } from "@/lib/auth/errors";
import { validateEmail, validateName, validatePasswordPair } from "@/lib/auth/policy";
import { authError, authSuccess, type AuthActionState } from "@/lib/auth/state";
import { getSiteUrl } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getSafeNextPath } from "@/lib/api";

/**
 * Neutral on purpose: it reads the same whether or not the address is already
 * registered, so this form cannot be used to enumerate accounts. It matches the
 * wording policy `apps/api` already uses for its own registration endpoint.
 */
const CHECK_YOUR_INBOX =
  "Если этот адрес ещё не зарегистрирован, мы отправили письмо со ссылкой подтверждения. Проверьте входящие и папку «Спам».";

/**
 * Creates the account. Supabase requires email confirmation on this project, so
 * a successful call sends a letter and returns no session — the visitor becomes
 * signed in only after following the link, which lands on /auth/confirm.
 */
export async function signUpWithEmail(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const passwordConfirmation = String(formData.get("passwordConfirmation") ?? "");
  const next = getSafeNextPath(String(formData.get("next") ?? ""));

  const invalid =
    validateName(name) ?? validateEmail(email) ?? validatePasswordPair(password, passwordConfirmation);
  if (invalid) return authError(invalid, email);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Read back by the trigger on auth.users to seed public.profiles.
        data: { full_name: name },
        emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) return authError(describeAuthError(error, "Не удалось создать аккаунт."), email);

    // Supabase answers a duplicate signup with a user carrying no identities
    // instead of an error, so this branch is a taken address, not a failure.
    // The neutral message above covers both cases.
    if (data.user && (data.user.identities?.length ?? 0) === 0) return authSuccess(CHECK_YOUR_INBOX, email);

    return authSuccess(CHECK_YOUR_INBOX, email);
  } catch (caught) {
    return authError(describeAuthError(caught, "Не удалось создать аккаунт."), email);
  }
}

/** Resends the confirmation letter for an address that has not been verified yet. */
export async function resendConfirmationEmail(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const invalidEmail = validateEmail(email);
  if (invalidEmail) return authError(invalidEmail, email);

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=%2Fworkspace` },
    });
    if (error) return authError(describeAuthError(error, "Не удалось отправить письмо."), email);
    return authSuccess("Письмо отправлено повторно. Проверьте входящие и папку «Спам».", email);
  } catch (caught) {
    return authError(describeAuthError(caught, "Не удалось отправить письмо."), email);
  }
}
