import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AuthUnavailable() {
  return (
    <section className="public-status">
      <div className="site-container public-status-inner">
        <p className="public-kicker">Аккаунты</p>
        <h1>Вход пока не подключён</h1>
        <p className="public-lead">
          Приложение авторизации не настроено для этого адреса. Публичные страницы и документация доступны без входа.
        </p>
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
