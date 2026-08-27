import type { Metadata } from "next";
import Link from "next/link";

import {
  ArrowRightIcon,
  FeedbackIcon,
  MetricsIcon,
  ReleaseIcon,
  SourceIcon,
} from "@/components/sections/icons";

export const metadata: Metadata = {
  title: "Возможности — Lura",
  description: "Что Lura делает с релизами, обратной связью и метриками продукта.",
};

const CAPABILITIES = [
  {
    Icon: ReleaseIcon,
    title: "Контекст каждого релиза",
    text: "Версия, дата, цель и состав изменения становятся точкой отсчёта для анализа.",
  },
  {
    Icon: FeedbackIcon,
    title: "Темы в обратной связи",
    text: "Похожие формулировки собираются в одну проблему с частотой и динамикой.",
  },
  {
    Icon: MetricsIcon,
    title: "Сравнение до и после",
    text: "Метрики сопоставляются по периодам и сегментам вокруг выбранного релиза.",
  },
  {
    Icon: SourceIcon,
    title: "Источник под выводом",
    text: "Ответ показывает, на каких данных основан, а нехватку контекста не скрывает.",
  },
] as const;

const OUTPUT = [
  ["Факт", "Рассчитан по данным"],
  ["Корреляция", "Совпадение во времени"],
  ["Гипотеза", "Требует проверки"],
  ["Рекомендация", "Имеет критерий результата"],
] as const;

export default function CapabilitiesPage() {
  return (
    <div className="public-page">
      <section className="public-page-hero">
        <div className="site-container public-page-hero-inner">
          <p className="public-kicker">Возможности</p>
          <h1>От релиза к следующему решению</h1>
          <p className="public-lead">
            Короткий разбор продукта без уверенного тона там, где данные дают только предположение.
          </p>
        </div>
      </section>

      <section className="public-section">
        <div className="site-container public-feature-list">
          {CAPABILITIES.map(({ Icon, title, text }, index) => (
            <article className="public-feature-row" key={title}>
              <span className="public-feature-number">0{index + 1}</span>
              <Icon className="public-feature-icon" />
              <h2>{title}</h2>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section public-section-soft">
        <div className="site-container public-output-grid">
          <div>
            <p className="public-kicker">Контракт вывода</p>
            <h2 className="public-section-title">Четыре уровня не смешиваются</h2>
          </div>
          <div className="public-output-list">
            {OUTPUT.map(([title, text]) => (
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
          <h2>Проверьте Lura на последнем релизе</h2>
          <div className="public-cta-row">
            <Link href="/register" className="public-button public-button-primary public-button-large">
              Начать <ArrowRightIcon />
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
