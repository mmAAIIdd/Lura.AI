"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { LuraLogo } from "@/components/lura-logo";
import { SECTIONS } from "@/lib/sections";

/**
 * Шапка публичных разделов.
 *
 * Клиентская только из-за двух вещей: подсветки текущего раздела и меню на
 * узком экране. Сами разделы — обычные серверные страницы.
 */
export function SectionHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  /* Меню закрывается при переходе: иначе на телефоне новая страница
     открывается под уже развёрнутым списком. */
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="public-header">
      <div className="site-container public-header-inner">
        <Brand />

        <nav className="public-nav" aria-label="Основная навигация">
          {SECTIONS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`public-nav-link ${pathname === href ? "is-active" : ""}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="public-actions">
          <Link href="/register" className="public-button public-button-primary">
            Продолжить с Google
          </Link>
          <button
            className="public-menu-button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav className="public-mobile-nav" aria-label="Мобильная навигация">
          <div className="site-container">
            {SECTIONS.map(({ href, label }) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
            <Link href="/register">Продолжить с Google</Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

export function Brand() {
  return (
    <Link href="/register" className="public-brand" aria-label="Lura — на главную">
      <LuraLogo className="public-brand-logo" />
      <span>Lura</span>
    </Link>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
