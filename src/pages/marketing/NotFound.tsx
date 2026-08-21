import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="relative grid min-h-[calc(100vh-var(--header-h))] place-items-center overflow-hidden py-20 text-center">
      <div className="page-aura" aria-hidden="true" />
      <div className="relative mx-auto max-w-2xl px-5">
        <p className="font-mono text-sm font-bold text-[var(--accent)]">404</p>
        <h1 className="hero-title mt-5 text-[clamp(44px,8vw,84px)]">Страница не найдена</h1>
        <p className="lead mx-auto mt-6 max-w-lg">
          Адрес мог измениться. Вернитесь на главную или откройте документацию.
        </p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/" className="gh-button gh-button-primary gh-button-lg">
            <ArrowLeft className="h-4 w-4" />На главную
          </Link>
          <Link to="/docs" className="gh-button gh-button-ghost gh-button-lg">Документация</Link>
        </div>
      </div>
    </section>
  );
}
