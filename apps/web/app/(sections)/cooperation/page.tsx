import type { Metadata } from "next";
import Link from "next/link";

import { ArrowRightIcon } from "@/components/sections/icons";

export const metadata: Metadata = {
  title: "Сотрудничество — Lura",
  description: "Как команда начинает работать с Lura: контекст, рабочее пространство, проверка выводов.",
};

const STEPS = [
  ["Подготовьте контекст", "Соберите историю релизов, обратную связь, метрики и документы продукта."],
  ["Откройте рабочее пространство", "Регистрация через Google создаёт единую точку для анализа данных."],
  ["Проверяйте выводы вместе", "Факты, корреляции, гипотезы и рекомендации остаются разделёнными."],
] as const;

export default function CooperationPage() {
  return (
    <div className="public-page">
      <section className="public-page-hero">
        <div className="site-container public-page-hero-inner">
          <p className="public-kicker">Сотрудничество</p>
          <h1>Общий контекст для продуктовой команды</h1>
          <p className="public-lead">
            Начните с одного рабочего пространства и данных, которые у команды уже есть.
          </p>
        </div>
      </section>

      <section className="public-section public-section-soft">
        <div className="site-container public-output-grid">
          <div>
            <p className="public-kicker">Как начать</p>
            <h2 className="public-section-title">Три понятных шага</h2>
          </div>
          <div className="public-output-list">
            {STEPS.map(([title, text]) => (
              <div key={title}>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="public-cta-section">
        <div className="site-container public-cta-section-inner">
          <h2>Рабочее пространство — главная страница Lura</h2>
          <div className="public-cta-row">
            <Link href="/register" className="public-button public-button-primary public-button-large">
              Продолжить с Google <ArrowRightIcon />
            </Link>
            <Link href="/docs" className="public-button public-button-outline public-button-large">
              Документация
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
