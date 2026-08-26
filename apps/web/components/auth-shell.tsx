import type { ReactNode } from "react";
import Image from "next/image";

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
  const capabilitiesUrl = home ? `${home}/capabilities` : undefined;
  const documentationUrl = home ? `${home}/docs` : undefined;
  const cooperationUrl = home ? `${home}/cooperation` : undefined;

  return (
    <div className={`auth-page auth-page-register auth-page-${variant}`}>
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
          <a href={documentationUrl} aria-disabled={!documentationUrl}>Документация</a>
          <a href={capabilitiesUrl} aria-disabled={!capabilitiesUrl}>Возможности</a>
          <a href={cooperationUrl} aria-disabled={!cooperationUrl}>Сотрудничество</a>
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
            {variant === "register" ? (
              <p className="auth-legal">
                Продолжая, вы подтверждаете, что ознакомились с{" "}
                {documentationUrl ? (
                  <a href={documentationUrl}>документацией Lura</a>
                ) : (
                  <span>документацией Lura</span>
                )}.
              </p>
            ) : (
              <p className="auth-legal">
                Lura не запрашивает и не хранит пароль: вход подтверждает Google.
              </p>
            )}
          </div>
        </section>

        <figure className="auth-art">
          <div className="auth-art-frame">
            <Image
              className="auth-art-image"
              src="/images/work-smart-not-hard.png"
              alt="Человек работает за компьютером с большим камнем на плечах"
              width={543}
              height={730}
              priority
              sizes="(max-width: 900px) 88vw, 38vw"
            />
          </div>
          <figcaption>Work smart not hard</figcaption>
        </figure>
      </main>
    </div>
  );
}
