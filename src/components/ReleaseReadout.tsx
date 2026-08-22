/**
 * One finding, rendered the way the workspace renders it: the release that
 * shipped, the metrics that moved after it, what the evidence says that was,
 * and the next thing to test.
 *
 * Built from the site's own tokens rather than dropped in as a screenshot, so
 * it follows the theme and cannot quietly fall out of date with the product.
 */

type Metric = {
  name: string;
  value: string;
  delta: string;
  direction: 'down' | 'up' | 'flat';
};

/* Wording matters here: a drop in activation is bad and a rise in support
   volume is bad too, so the colour follows the reading, not the arithmetic. */
const METRICS: Metric[] = [
  { name: 'Активация за 7 дней', value: '31,4%', delta: '−6,8 п.п.', direction: 'down' },
  { name: 'Доходят до шага «Источник»', value: '54%', delta: '−19 п.п.', direction: 'down' },
  { name: 'Обращения в поддержку', value: '128', delta: '+64%', direction: 'down' },
];

export function ReleaseReadout() {
  return (
    <div className="readout">
      <header className="readout-head">
        <div className="readout-release">
          <span className="tag">Релиз</span>
          <strong>4.18.0 — новый онбординг</strong>
        </div>
        <span className="readout-meta">Сравнение: 14 дней до и после</span>
      </header>

      <div className="readout-metrics">
        {METRICS.map((metric) => (
          <div className="metric" key={metric.name}>
            <p className="metric-name">{metric.name}</p>
            <p className="metric-row">
              <span className="metric-value">{metric.value}</span>
              <span className={`metric-delta metric-delta-${metric.direction}`}>{metric.delta}</span>
            </p>
          </div>
        ))}
      </div>

      <div className="readout-findings">
        <article className="finding">
          <p className="finding-label finding-label-problem">Что произошло</p>
          <p className="finding-text">
            Шаг «Подключить источник» проходят 54% вместо 73%. В обращениях после релиза
            повторяется один вопрос — где взять API-ключ. Ссылку на инструкцию убрали
            из шага вместе со старым онбордингом.
          </p>
          <p className="finding-evidence">
            <span>42 обращения</span>
            <span>17 сессий</span>
            <span>Коммит e4c1a90</span>
          </p>
        </article>

        <article className="finding">
          <p className="finding-label finding-label-action">Что проверить</p>
          <p className="finding-text">
            Вернуть ссылку на инструкцию в сам шаг и снять прохождение на когорте
            за 7 дней. Если причина в ней, активация отыграет 4—6 п.п.; если нет —
            остаётся гипотеза о новом порядке шагов.
          </p>
          <p className="finding-evidence">
            <span>Гипотеза</span>
            <span>Окно проверки: 7 дней</span>
          </p>
        </article>
      </div>
    </div>
  );
}
