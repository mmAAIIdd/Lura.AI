import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/sections/section-header";
import { SECTIONS } from "@/lib/sections";

import "./(sections)/sections.css";

export const metadata: Metadata = {
  title: "Страница не найдена — Lura",
};

/* Своя страница вместо стандартной от Next: 404 — это тоже экран продукта, и
   с него должен быть выход, а не только код ошибки. */
export default function NotFound() {
  return (
    <div className="site-shell public-site">
      <header className="public-header">
        <div className="site-container public-header-inner">
          <Brand />
          <nav className="public-nav" aria-label="Основная навигация">
            {SECTIONS.map(({ href, label }) => (
              <Link key={href} href={href} className="public-nav-link">
                {label}
              </Link>
            ))}
          </nav>
          <div className="public-actions">
            <Link href="/register" className="public-button public-button-primary">
              Продолжить с Google
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="public-status">
          <div className="site-container public-status-inner">
            <p className="public-kicker">404</p>
            <h1>Страница не найдена</h1>
            <p className="public-lead">Адрес мог измениться. Вернитесь к разделам или откройте рабочее пространство.</p>
            <div className="public-cta-row">
              <Link href="/register" className="public-button public-button-primary public-button-large">
                На главную
              </Link>
              <Link href="/docs" className="public-button public-button-outline public-button-large">
                Документация
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
