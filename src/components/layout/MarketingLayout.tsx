import { Suspense, lazy, useEffect, useState } from 'react';
import { Menu, Search, X } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { authUrl } from '@/lib/authUrl';

/* The overlay carries the whole FAQ text and is closed on arrival, so none of
   it belongs in the chunk that has to render the first screen. */
const SearchOverlay = lazy(() =>
  import('@/components/SearchOverlay').then((module) => ({ default: module.SearchOverlay })),
);

const NAV = [
  ['/platform', 'Платформа'],
  ['/docs', 'Документация'],
  ['/capabilities', 'Возможности'],
] as const;

function Brand() {
  return (
    <Link to="/" className="gh-brand" aria-label="Lura — на главную">
      <span className="gh-brand-mark">L</span>
      <span>Lura</span>
    </Link>
  );
}

export function MarketingLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const isLanding = location.pathname === '/';

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (location.hash === '#questions') setSearchOpen(true);
  }, [location.hash]);

  // Once the first screen is up and idle, pull the overlay chunk in the
  // background: off the critical path, but already there when "/" is pressed.
  useEffect(() => {
    const timer = window.setTimeout(() => { void import('@/components/SearchOverlay'); }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  // "/" opens search the way it does on GitHub, unless the user is typing somewhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (event.key === '/' && !typing && !searchOpen) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);

  return (
    <div className="site-shell">
      <header className="gh-header">
        <div className="site-container gh-header-inner">
          <Brand />

          <nav className="gh-nav" aria-label="Основная навигация">
            {NAV.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `gh-nav-link ${isActive ? 'gh-nav-link-active' : ''}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="gh-actions">
            <button className="gh-search hidden sm:flex" onClick={() => setSearchOpen(true)} aria-label="Открыть вопросы">
              <Search className="h-[22px] w-[22px]" />
              <span>Вопросы</span>
              <kbd className="gh-kbd">/</kbd>
            </button>
            <button className="gh-menu-button sm:hidden" onClick={() => setSearchOpen(true)} aria-label="Открыть вопросы">
              <Search className="h-[22px] w-[22px]" />
            </button>

            <a href={authUrl('/login')} className="gh-button gh-button-ghost">Вход</a>
            <a href={authUrl('/register')} className="gh-button gh-button-primary">Регистрация</a>

            <button
              className="gh-menu-button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
            >
              {menuOpen ? <X className="h-[22px] w-[22px]" /> : <Menu className="h-[22px] w-[22px]" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="gh-mobile-nav" aria-label="Мобильная навигация">
            <div className="site-container py-2">
              {NAV.map(([to, label]) => (
                <Link key={to} to={to} className="gh-mobile-link">{label}</Link>
              ))}
              {/* The narrowest layout drops the "Вход" button from the bar, so the
                  account links have to live somewhere the visitor can still reach. */}
              <p className="gh-mobile-section">Аккаунт</p>
              <a href={authUrl('/login')} className="gh-mobile-link">Вход</a>
              <a href={authUrl('/register')} className="gh-mobile-link">Регистрация</a>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">
        {/* Holds the viewport height while a route chunk arrives, so the header
            does not sit alone above a collapsed page for a frame. */}
        <Suspense fallback={<div className="route-fallback" />}>
          <Outlet />
        </Suspense>
      </main>

      {/* The landing is deliberately a single screen — a footer under it would
          give it something to scroll to. Every other page keeps one. */}
      {!isLanding && (
      <footer className="site-footer">
        <div className="site-container grid gap-8 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Brand />
            <p className="mt-4 max-w-sm text-sm leading-6 text-[var(--muted)]">
              Lura связывает релизы, обратную связь и метрики в проверяемую историю продукта.
            </p>
          </div>
          <div className="grid content-start gap-2.5">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-soft)]">Продукт</p>
            {NAV.map(([to, label]) => <Link key={to} to={to} className="footer-link">{label}</Link>)}
          </div>
          <div className="grid content-start gap-2.5">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-soft)]">Аккаунт</p>
            <a href={authUrl('/login')} className="footer-link">Вход</a>
            <a href={authUrl('/register')} className="footer-link">Регистрация</a>
            <button className="footer-link text-left" onClick={() => setSearchOpen(true)}>Частые вопросы</button>
          </div>
        </div>
        <div className="border-t border-[var(--line)] py-5 text-center text-xs text-[var(--muted-soft)]">
          © 2026 Lura. Выводы опираются на данные и отделяются от гипотез.
        </div>
      </footer>
      )}

      {/* The overlay renders null when closed anyway, so mounting it only while
          open costs nothing and keeps its chunk out of the first paint. */}
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchOverlay open onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
