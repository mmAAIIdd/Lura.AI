"use server";

import { revalidatePath } from "next/cache";

import { getSafeNextPath } from "@/lib/api";
import { describeAuthError } from "@/lib/auth/errors";
import { validateEmail } from "@/lib/auth/policy";
import { authError, authSuccess, type AuthActionState } from "@/lib/auth/state";
import { createClient } from "@/lib/supabase/server";

/**
 * Signs an existing account in. On success the Supabase session cookies are
 * written by this action; the form then links the backend session and
 * navigates, rather than redirecting from here, so a backend that is down
 * cannot swallow a successful sign-in.
 */
export async function signInWithEmail(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const invalidEmail = validateEmail(email);
  if (invalidEmail) return authError(invalidEmail, email);
  if (!password) return authError("Введите пароль.", email);

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return authError(describeAuthError(error, "Не удалось войти."), email);

    revalidatePath("/", "layout");
    return authSuccess(null, email);
  } catch (caught) {
    return authError(describeAuthError(caught, "Не удалось войти."), email);
  }
}

/** Only used to compute the post-login destination on the server. */
export async function resolveNextPath(next: string | null): Promise<string> {
  return getSafeNextPath(next);
}
