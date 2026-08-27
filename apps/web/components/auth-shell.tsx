import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

import { LuraLogo } from "@/components/lura-logo";
import { SECTIONS } from "@/lib/sections";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  variant?: "login" | "register";
};

export function AuthShell({ title, subtitle, children, variant = "login" }: AuthShellProps) {
  return (
    <div className={`auth-page auth-page-${variant}`}>
      <header className="auth-header">
        <Link href="/register" className="brand auth-brand" aria-label="Lura — на главную">
          <LuraLogo className="auth-brand-logo" />
          <span>Lura</span>
        </Link>

        <nav className="auth-nav" aria-label="Основная навигация">
          {SECTIONS.map(({ href, label }) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
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
                <Link href="/docs">документацией Lura</Link>.
              </p>
            ) : (
              <p className="auth-legal">
                Lura не запрашивает и не хранит пароль: вход подтверждает Google.
              </p>
            )}
          </div>

          {/* Первый экран должен отвечать на «что я с этого получу», иначе
              кнопка входа висит без причины. Только на регистрации: на экране
              ошибки этот текст отвлекал бы от того, что делать дальше. */}
          {variant === "register" ? (
            <section className="auth-pitch" aria-label="О продукте">
              <p className="auth-pitch-lead">
                Вы выпускаете обновления, а клиенты отвечают — отзывами, оценками, тем, как
                они пользуются продуктом. Lura слушает этот ответ за вас и показывает, что из
                сделанного сработало.
              </p>
              <ul className="auth-pitch-list">
                <li>
                  <strong>Видно, что изменилось после релиза</strong>
                  <span>Не «выкатили и надеемся»: где клиенту стало легче, а где вы задели живое.</span>
                </li>
                <li>
                  <strong>Сотни отзывов — в несколько понятных тем</strong>
                  <span>Люди пишут об одном и том же разными словами. Lura собирает это в проблемы и показывает, какие из них растут.</span>
                </li>
                <li>
                  <strong>Понятно, за что браться завтра</strong>
                  <span>Факт, догадка и рекомендация не свалены в кучу — решение остаётся за вами, но уже с опорой.</span>
                </li>
              </ul>
            </section>
          ) : null}
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
