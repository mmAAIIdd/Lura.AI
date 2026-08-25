import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";

/**
 * Where /auth/confirm sends anyone whose sign-in did not complete.
 *
 * The three reasons have three different fixes, and the copy says which is
 * which instead of offering one generic apology. Supabase's own description of
 * the failure is printed underneath when there is one: it names things this
 * page cannot guess — a client secret that does not match, an address missing
 * from the tester list, a code already redeemed.
 */
const REASONS: Record<string, string> = {
  provider: "Google не завершил вход. Обычно это значит, что вход отменили в окне Google, либо аккаунт не допущен к приложению.",
  exchange: "Подтверждение не удалось обменять на сессию. Так бывает, когда страницу обновили после входа — код действует один раз — или когда вход открывали в другом браузере.",
  missing: "В адресе возврата нет кода подтверждения. Попробуйте начать вход заново.",
};

const FALLBACK = "Вход не завершился. Попробуйте ещё раз.";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; detail?: string }>;
}) {
  const { reason, detail } = await searchParams;

  return (
    <AuthShell
      title="Вход не завершился"
      subtitle="Ничего не потеряно — можно начать заново."
    >
      <div className="auth-form">
        <p className="form-error" role="alert">{REASONS[reason ?? ""] ?? FALLBACK}</p>
        {detail ? <p className="error-detail">{detail}</p> : null}
        <Link className="button button-primary" href="/login">Попробовать снова</Link>
      </div>
    </AuthShell>
  );
}
