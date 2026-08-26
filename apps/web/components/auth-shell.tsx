import type { ReactNode } from "react";

import { LuraLogo } from "@/components/lura-logo";
import { marketingUrl } from "@/lib/marketing-url";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const home = marketingUrl();
  const capabilitiesUrl = home ? `${home}/capabilities` : undefined;
  const questionsUrl = home ? `${home}/#questions` : undefined;
  const documentationUrl = home ? `${home}/docs` : undefined;

  return (
    <div className="auth-page">
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
