import type { ReactNode } from "react";

const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="auth-page">
{/* The marketing landing's halo, so arriving here reads as the same site
          rather than as a different product. */}
      <div className="auth-aura" aria-hidden="true" />

      <section className="auth-hero" aria-labelledby="auth-title">
        <a href={marketingUrl} className="brand auth-brand" aria-label="Lura — на главную">
          <span className="brand-mark">L</span>
          <span>Lura</span>
        </a>
        <div className="auth-heading">
          <h1 id="auth-title">{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="auth-panel">{children}</div>
        <p className="auth-security-note">Пароль Lura не хранит и не запрашивает: вход подтверждает Google. Сессия живёт в защищённой HttpOnly cookie.</p>
      </section>
    </main>
  );
}
