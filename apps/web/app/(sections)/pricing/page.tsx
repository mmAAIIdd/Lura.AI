import type { Metadata } from "next";
import Link from "next/link";

import { ArrowRightIcon } from "@/components/sections/icons";

export const metadata: Metadata = {
  title: "Планы — Lura",
  description: "Что входит в Lura сейчас и на каких условиях команда получает доступ.",
};

/*
 * ЦЕНЫ СЮДА НЕ ВПИСАНЫ НАМЕРЕННО.
 *
 * Тарифы — решение владельца продукта, а не разработчика: придуманная цифра
 * на живом сайте либо обманет клиента, либо свяжет команду обещанием, которого
 * она не давала. Когда цифры появятся, заменяется массив PLANS ниже: у каждого
 * плана есть поле price, и вёрстка уже под него готова.
 */
const PLANS = [
  {
    name: "Ранний доступ",
    price: "по договорённости",
    note: "Для первых команд, которые разбирают свой продукт вместе с нами.",
    includes: [
      "Рабочее пространство с агентом",
      "Документ о бизнесе всегда в контексте",
      "Загрузка документов и ссылок, поиск по ним",
      "Оба режима: «Отчёты» и «Обновления»",
      "Поиск в интернете и чтение источников",
      "Отчёты файлом .md",
    ],
    highlighted: true,
  },
  {
    name: "Команда",
    price: "уточняется",
    note: "Общее пространство, история разборов, объёмы под регулярную работу.",
    includes: [
      "Всё из раннего доступа",
      "Общие документы и разборы внутри команды",
      "Больше документов и запросов",
    ],
    highlighted: false,
  },
  {
    name: "На своей инфраструктуре",
    price: "уточняется",
    note: "Для тех, кому данные нельзя выносить наружу.",
    includes: [
      "Развёртывание в вашем контуре",
      "Своя база и своё хранилище документов",
      "Свой ключ модели",
    ],
    highlighted: false,
  },
] as const;

export default function PricingPage() {
  return (
    <div className="public-page">
      <section className="public-page-hero">
        <div className="site-container public-page-hero-inner">
          <p className="public-kicker">Планы</p>
          <h1>Lura в раннем доступе</h1>
          <p className="public-lead">
            Тарифы ещё не зафиксированы: мы подбираем их вместе с первыми командами. Ниже — что
            входит в продукт сегодня.
          </p>
        </div>
      </section>

      <section className="public-section">
        <div className="site-container public-plans">
          {PLANS.map((plan) => (
            <article key={plan.name} className={`public-plan ${plan.highlighted ? "is-current" : ""}`}>
              <h2>{plan.name}</h2>
              <p className="public-plan-price">{plan.price}</p>
              <p className="public-plan-note">{plan.note}</p>
              <ul>
                {plan.includes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section public-section-soft">
        <div className="site-container public-output-grid">
          <div>
            <p className="public-kicker">Честно</p>
            <h2 className="public-section-title">Что это значит на практике</h2>
          </div>
          <div className="public-output-list">
            <div>
              <strong>Продукт работает</strong>
              <span>Рабочее пространство, разбор по данным, поиск и отчёты доступны прямо сейчас.</span>
            </div>
            <div>
              <strong>Цена обсуждается</strong>
              <span>Мы смотрим на объём данных и частоту разборов, а не берём фиксированную ставку вслепую.</span>
            </div>
            <div>
              <strong>Без сюрпризов</strong>
              <span>Условия фиксируются до начала работы и не меняются задним числом.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="public-cta-section">
        <div className="site-container public-cta-section-inner">
          <h2>Начните с разбора последнего релиза</h2>
          <div className="public-cta-row">
            <Link href="/register" className="public-button public-button-primary public-button-large">
              Продолжить с Google <ArrowRightIcon />
            </Link>
            <Link href="/faq" className="public-button public-button-outline public-button-large">
              Вопросы
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
