import { Suspense, useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { LuraLogo } from '@/components/LuraLogo';
import { authUrl } from '@/lib/authUrl';

const NAV = [
  ['/capabilities', 'Возможности'],
  ['/cooperation', 'Сотрудничество'],
  ['/docs', 'Документация'],
] as const;

function Brand() {
  /* Корень сайта — регистрация, туда же ведёт и знак. Ссылка сразу на
     приложение авторизации, чтобы не делать лишний переход через редирект. */
  return (
    <a href={authUrl('/register')} className="public-brand" aria-label="Lura — на главную">
      <LuraLogo className="public-brand-logo" />
      <span>Lura</span>
    </a>
  );
}

export function MarketingLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="site-shell public-site">
      <header className="public-header">
        <div className="site-container public-header-inner">
          <Brand />

          <nav className="public-nav" aria-label="Основная навигация">
            {NAV.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `public-nav-link ${isActive ? 'is-active' : ''}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="public-actions">
            <a href={authUrl('/register')} className="public-button public-button-primary">Продолжить с Google</a>
            <button
              className="public-menu-button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
            >
              {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="public-mobile-nav" aria-label="Мобильная навигация">
            <div className="site-container">
              {NAV.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
              <a href={authUrl('/register')}>Продолжить с Google</a>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Suspense fallback={<div className="route-fallback" />}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="public-footer">
        <div className="site-container public-footer-main">
          <div>
            <Brand />
            <p>Lura связывает релизы, обратную связь и метрики в проверяемую историю продукта.</p>
          </div>
          <div className="public-footer-links">
            {NAV.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
          </div>
        </div>
        <div className="public-footer-note">© 2026 Lura. Факты и гипотезы в выводах разделены.</div>
      </footer>
    </div>
  );
}
