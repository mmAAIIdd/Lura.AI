import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";

const REASONS: Record<string, string> = {
  link: "Ссылка недействительна, устарела или уже была использована. Ссылки действуют ограниченное время и только один раз.",
  missing: "В ссылке нет кода подтверждения. Возможно, почтовый клиент обрезал адрес — откройте письмо целиком и скопируйте ссылку полностью.",
};

const FALLBACK = "Не удалось завершить подтверждение. Попробуйте запросить новую ссылку.";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <AuthShell
      title="Ссылка не сработала"
      subtitle="Ничего страшного — запросите новое письмо и попробуйте ещё раз."
    >
      <div className="auth-form">
        <p className="form-error" role="alert">{REASONS[reason ?? ""] ?? FALLBACK}</p>
        <Link className="button button-primary" href="/verify-email">Отправить письмо снова</Link>
        <Link className="button button-secondary" href="/forgot-password">Сбросить пароль</Link>
      </div>
      <p className="form-footer"><Link href="/login">Назад ко входу</Link></p>
    </AuthShell>
  );
}
