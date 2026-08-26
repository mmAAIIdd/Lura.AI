import type { ReactNode } from "react";

import { LuraLogo } from "@/components/lura-logo";
import { marketingUrl } from "@/lib/marketing-url";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  variant?: "login" | "register";
};

export function AuthShell({ title, subtitle, children, variant = "login" }: AuthShellProps) {
  const home = marketingUrl();

  if (variant === "login") {
    return (
      <main className="auth-page auth-page-login">
        <section className="auth-hero" aria-labelledby="auth-title">
          {home ? (
            <a href={home} className="brand auth-brand" aria-label="Lura — на главную">
              <span className="brand-mark">L</span>
              <span>Lura</span>
            </a>
          ) : (
            <span className="brand auth-brand">
              <span className="brand-mark">L</span>
              <span>Lura</span>
            </span>
          )}
          <div className="auth-heading">
            <h1 id="auth-title">{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="auth-panel">{children}</div>
          <p className="auth-security-note">
            Пароль Lura не хранит и не запрашивает: вход подтверждает Google.
          </p>
        </section>
      </main>
    );
  }

  const capabilitiesUrl = home ? `${home}/capabilities` : undefined;
  const questionsUrl = home ? `${home}/#questions` : undefined;
  const documentationUrl = home ? `${home}/docs` : undefined;

  return (
    <div className="auth-page auth-page-register">
      <header className="auth-header">
        {home ? (
          <a href={home} className="brand auth-brand" aria-label="Lura — на главную">
            <LuraLogo className="auth-brand-logo" />
            <span>Lura</span>
          </a>
        ) : (
          <span className="brand auth-brand">
            <LuraLogo className="auth-brand-logo" />
            <span>Lura</span>
          </span>
        )}

        <nav className="auth-nav" aria-label="Основная навигация">
          <a href={capabilitiesUrl} aria-disabled={!capabilitiesUrl}>Возможности</a>
          <a href={questionsUrl} aria-disabled={!questionsUrl}>Вопросы</a>
        </nav>
      </header>

      <main className="auth-main">
        <section className="auth-hero" aria-labelledby="auth-title">
          <div className="auth-heading">
            <h1 id="auth-title">{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="auth-panel">
            {children}
            <p className="auth-legal">
              Продолжая, вы подтверждаете, что ознакомились с{" "}
              {documentationUrl ? (
                <a href={documentationUrl}>документацией Lura</a>
              ) : (
                <span>документацией Lura</span>
              )}.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
