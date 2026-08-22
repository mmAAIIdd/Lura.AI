import { Link } from 'react-router-dom';

import { authUrl } from '@/lib/authUrl';

/* Stated as the situation, without the fix appended to each one — the block
   below already says what Lura does, and repeating it here was the same
   sentence twice. */
const PROBLEMS = [
  [
    'Причина просадки',
    'Показатель падает, замечают это через несколько дней. К тому моменту вышло ещё два релиза, и какой из них причина — восстанавливают по памяти.',
  ],
  [
    'Единичные жалобы',
    'Одну проблему описывают разными словами в поддержке, в чате и в отзывах. По отдельности каждое обращение выглядит частным случаем.',
  ],
  [
    'Непроверяемый вывод',
    'Языковая модель подаёт предположение тем же тоном, что и расчёт. Перепроверять каждый вывод вручную дороже, чем не спрашивать.',
  ],
];

/* The full list is on /capabilities; four lines here only have to say what kind
   of thing this is. Nothing below claims an integration that is not built. */
const CAPABILITIES = [
  ['Событие изменения', 'Релиз с составом, целью и датой. К нему привязываются метрики и обращения.'],
  ['Разбор обратной связи', 'Разные формулировки одной проблемы сводятся в тему с частотой и динамикой.'],
  ['Сравнение до и после', 'Показатели по сегментам на двух отрезках вокруг релиза.'],
  ['Источник под выводом', 'Факт, корреляция, гипотеза и рекомендация помечены отдельно. Под каждым — данные, из которых он собран.'],
];

/**
 * The first screen carries the wordmark and a single way in. Below it: the
 * situation a team is already in, then what the product does with it.
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
          <p className="eyebrow">Задача</p>
          <h2 className="section-title mt-4 max-w-[24ch]">Что мешает связать релиз с его последствиями</h2>
          <p className="lead mt-5 max-w-[58ch]">
            Метрики, обращения и состав релиза лежат в разных системах. Сопоставляют их вручную.
          </p>

          <div className="problems mt-12">
            {PROBLEMS.map(([term, text]) => (
              <article className="problem" key={term}>
                <h3 className="problem-pain">{term}</h3>
                <p className="problem-detail">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt section-deferred">
        <div className="site-container py-16 sm:py-20">
          <p className="eyebrow">Возможности</p>
          <h2 className="section-title mt-4 max-w-[24ch]">Разбор строится вокруг события изменения</h2>

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
