"use server";

import { describeAuthError } from "@/lib/auth/errors";
import { validateEmail } from "@/lib/auth/policy";
import { authError, authSuccess, type AuthActionState } from "@/lib/auth/state";
import { getSiteUrl } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/** Neutral for the same anti-enumeration reason as the registration message. */
const RESET_SENT =
  "Если аккаунт с таким адресом существует, мы отправили письмо со ссылкой для смены пароля.";

export async function requestPasswordReset(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const invalidEmail = validateEmail(email);
  if (invalidEmail) return authError(invalidEmail, email);

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // The link lands on /auth/confirm, which establishes the recovery session
      // and only then forwards to the form where the new password is chosen.
      redirectTo: `${getSiteUrl()}/auth/confirm?next=%2Freset-password`,
    });
    // A rate limit is worth showing; anything else stays neutral.
    if (error && error.status === 429) {
      return authError(describeAuthError(error, "Слишком много попыток."), email);
    }
    return authSuccess(RESET_SENT, email);
  } catch (caught) {
    return authError(describeAuthError(caught, "Не удалось отправить ссылку."), email);
  }
}
