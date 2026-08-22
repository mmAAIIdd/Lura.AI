import { Link } from 'react-router-dom';

import { authUrl } from '@/lib/authUrl';

/* Written as the problem, not as a feature list. Every line here describes work
   teams already do by hand — none of it claims an integration that is not built
   yet, which is the line the rest of the site holds too. */
const PROBLEMS = [
  {
    pain: 'Метрика упала, и никто не помнит, что менялось',
    detail:
      'Между падением и релизом, который его вызвал, проходит неделя переписки. К моменту, когда связь находят, поверх уехали ещё два релиза, и уже непонятно, какой из них считать причиной.',
    answer: 'Lura держит эту связь с самого начала: что изменилось, когда, и что случилось после.',
  },
  {
    pain: 'Жалобы приходят по одной и выглядят единичными',
    detail:
      'Три обращения в поддержку, реплика в чате, строка в отзыве на сторе. По отдельности каждое — мелочь, которую закрывают ответом. Вместе это одна проблема, но увидеть её так некому.',
    answer: 'Одинаковые сигналы собираются вместе, и видно, сколько людей столкнулось с одним и тем же.',
  },
  {
    pain: 'Вывод звучит уверенно, а проверить его нечем',
    detail:
      'Сводка от языковой модели не отличает то, что посчитано по данным, от того, что она предположила. Доверять такому выводу в решении о продукте нельзя, а перепроверять всё вручную — дороже, чем не спрашивать.',
    answer: 'Факт, корреляция, гипотеза и рекомендация подписаны отдельно, и под каждым выводом — данные, из которых он собран.',
  },
];

/* Four sentences, not a feature table — the full list lives on /capabilities and
   this only has to say what kind of thing Lura is. Worded as what the platform
   does with material a team gives it, which is what it does today. */
const CAPABILITIES = [
  ["Событие изменения", "Релиз с составом, целью и датой — та единица, к которой привязывается всё остальное."],
  ["Разбор обратной связи", "Разные формулировки одной проблемы сводятся в одну тему с частотой и динамикой."],
  ["Сравнение до и после", "Показатели по сегментам на двух отрезках вокруг релиза, а не одно число по продукту."],
  ["Ответ со ссылкой на источник", "Загруженные документы попадают в контекст, и в ответе видно, откуда взят факт."],
];

/**
 * The first screen carries the wordmark and a single way in. Below it, the
 * problem the product exists for — stated as the situation a team is already
 * in, because that is what a visitor recognises before they know what Lura is.
 */
export default function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-stage" aria-hidden="true">
          <div className="hero-plane hero-roof" />
          <div className="hero-plane hero-floor" />
        </div>
        <div className="hero-pattern" aria-hidden="true" />

        <div className="gas gas-1" aria-hidden="true" />
        <div className="gas gas-2" aria-hidden="true" />
        <div className="gas gas-3" aria-hidden="true" />

        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-grain" aria-hidden="true" />
        <div className="hero-vignette" aria-hidden="true" />

        <div className="relative flex flex-col items-center px-5 text-center">
          <h1 className="hero-headline">
            Lura — ваш аналитик данных: следит за каждым релизом и превращает сигналы о продукте в решения
          </h1>
          <a href={authUrl('/register')} className="hero-cta mt-12">
            Начать сейчас
          </a>
        </div>
      </section>

      <section className="section section-deferred">
        <div className="site-container py-16 sm:py-20">
          <p className="eyebrow">Зачем это нужно</p>
          <h2 className="section-title mt-4 max-w-[20ch]">
            Данные о продукте есть у всех. Связать их между собой — некому
          </h2>
          <p className="lead mt-5 max-w-[64ch]">
            Метрики живут в аналитике, жалобы — в поддержке, состав релиза — в трекере.
            Каждый источник по отдельности понятен. Вопрос, ради которого их и собирали —
            что изменилось и к чему это привело — не задан ни одному из них.
          </p>

          <div className="problems mt-12">
            {PROBLEMS.map((item) => (
              <article className="problem" key={item.pain}>
                <h3 className="problem-pain">{item.pain}</h3>
                {/* One cell, so the answer follows its own paragraph rather than
                    waiting for a three-line heading in the column beside it. */}
                <div className="problem-body">
                  <p className="problem-detail">{item.detail}</p>
                  <p className="problem-answer">{item.answer}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt section-deferred">
        <div className="site-container py-16 sm:py-20">
          <p className="eyebrow">Что она делает</p>
          <h2 className="section-title mt-4 max-w-[22ch]">Одна история изменения вместо четырёх разрозненных источников</h2>

          <dl className="capabilities mt-10">
            {CAPABILITIES.map(([term, text]) => (
              <div className="capability" key={term}>
                <dt className="capability-term">{term}</dt>
                <dd className="capability-text">{text}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-10">
            <Link to="/capabilities" className="gh-button gh-button-ghost gh-button-lg">
              Подробнее о возможностях
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
