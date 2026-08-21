"use server";

import { revalidatePath } from "next/cache";

import { describeAuthError } from "@/lib/auth/errors";
import { validatePasswordPair } from "@/lib/auth/policy";
import { authError, authSuccess, type AuthActionState } from "@/lib/auth/state";
import { createClient } from "@/lib/supabase/server";

/**
 * Sets a new password for the recovery session established by /auth/confirm.
 * Without that session there is nothing to update, which is what makes the
 * emailed link the only way in.
 */
export async function updatePassword(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");
  const passwordConfirmation = String(formData.get("passwordConfirmation") ?? "");

  const invalid = validatePasswordPair(password, passwordConfirmation);
  if (invalid) return authError(invalid);

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    if (!claims?.claims) {
      return authError("Ссылка для смены пароля недействительна или устарела. Запросите новую.");
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) return authError(describeAuthError(error, "Не удалось изменить пароль."));

    revalidatePath("/", "layout");
    return authSuccess("Пароль изменён.");
  } catch (caught) {
    return authError(describeAuthError(caught, "Не удалось изменить пароль."));
  }
}
