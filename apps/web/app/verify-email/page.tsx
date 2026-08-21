import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { ConfirmationSent } from "@/components/auth-forms";

/**
 * Reachable when someone leaves the registration screen before the letter
 * arrives. The confirmation itself is handled by /auth/confirm.
 */
export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Подтвердите email"
      subtitle="Аккаунт станет активным сразу после перехода по ссылке из письма."
    >
      <ConfirmationSent />
      <p className="form-footer">Уже подтвердили? <Link href="/login">Войти</Link></p>
    </AuthShell>
  );
}
