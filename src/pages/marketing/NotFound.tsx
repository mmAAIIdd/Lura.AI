import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="public-status">
      <div className="site-container public-status-inner">
        <p className="public-kicker">404</p>
        <h1>Страница не найдена</h1>
        <p className="public-lead">Адрес мог измениться. Вернитесь на главную или откройте документацию.</p>
        <div className="public-cta-row">
          <Link to="/" className="public-button public-button-primary public-button-large">
            <ArrowLeft aria-hidden="true" /> На главную
          </Link>
          <Link to="/docs" className="public-button public-button-outline public-button-large">Документация</Link>
        </div>
      </div>
    </section>
  );
}
