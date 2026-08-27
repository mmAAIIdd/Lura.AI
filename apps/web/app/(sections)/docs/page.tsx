import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Документация — Lura",
  description: "Модель данных, форматы загрузки, команды и контракт вывода Lura.",
};

const TOC = [
  ['start', 'Быстрый старт'],
  ['data', 'Модель данных'],
  ['formats', 'Форматы загрузки'],
  ['commands', 'Команды'],
  ['contract', 'Контракт вывода'],
  ['limits', 'Ограничения'],
] as const;

const START = [
  'Создайте аккаунт — рабочее пространство появится автоматически.',
  'Загрузите источники: отзывы, changelog, заметки, выгрузку тикетов.',
  'Добавьте релизы и метрики, если они есть — так станет доступно сравнение до и после.',
  'Откройте панель ассистента и нажмите «/» для готового разбора.',
] as const;

const DATA = [
  ['Релизы', 'Версия, заголовок, описание, статус, дата выпуска.'],
  ['Сигналы', 'Источник, текст, тональность, тема, дата, связь с релизом.'],
  ['Метрики', 'Ключ, значение, единица, сегмент, момент замера.'],
  ['Документы', 'Текст разбивается на фрагменты и индексируется для поиска.'],
] as const;

const FORMATS = ['txt', 'md', 'csv', 'tsv', 'json', 'log', 'yaml', 'xml', 'html'] as const;

const LIMITS_TABLE = [
  ['Размер документа', 'до 8 МБ на файл'],
  ['Разбиение', '≈1200 символов на фрагмент с перекрытием 160'],
  ['Индексация', 'gemini-embedding-001, 768 измерений, поиск по смыслу'],
  ['Подстановка', 'наиболее релевантные фрагменты в контекст ответа'],
] as const;

const COMMANDS = [
  ['/анализ фидбека', 'Разбор обратной связи по темам и релизам', true],
  ['/обзор обновлений', 'Что изменилось в релизах и что произошло после', true],
  ['/аналитика покупок', 'Требует подключённого источника о покупках', false],
  ['/внешняя оценка', 'Требует подключённых внешних площадок', false],
] as const;

const CONTRACT = [
  ['Finding', 'Наблюдение, посчитанное по данным.'],
  ['Evidence', 'Источники и конкретные значения.'],
  ['Affected area', 'Затронутая функция или релиз.'],
  ['Impact', 'Влияние на пользователей и бизнес.'],
  ['Confidence', 'Насколько вывод подтверждён и почему.'],
  ['Hypotheses', 'Возможные объяснения.'],
  ['Contradicting evidence', 'Что говорит против гипотезы.'],
  ['Recommendation', 'Что имеет смысл проверить.'],
  ['Validation', 'Метрика и период оценки.'],
] as const;

const LIMITS = [
  'Не заменяет CRM, трекер задач или продуктовую аналитику.',
  'Не доказывает причинность по совпадению во времени.',
  'Не скрывает источники за резюме.',
  'Не принимает решение вместо команды.',
  'Не делает уверенный вывод при недостатке данных.',
] as const;

export default function DocsPage() {
  return (
    <div className="public-page">
      <section className="public-page-hero">
        <div className="site-container public-page-hero-inner">
          <p className="public-kicker">Документация</p>
          <h1>Модель данных и правила анализа</h1>
          <p className="public-lead">
            Какие данные нужны системе, в каком виде их загружать и из чего состоит проверяемый вывод.
          </p>
        </div>
      </section>

      {/* Оглавление — обычные якоря. Подсветка активного раздела требовала бы
          слежения за прокруткой; на шести разделах она ничего не добавляет. */}
      <div className="site-container public-docs">
        <nav className="public-docs-nav" aria-label="Разделы документации">
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`}>{label}</a>
          ))}
        </nav>

        <div className="public-docs-body">
          <section id="start" className="public-docs-section">
            <p className="public-kicker">01 / Старт</p>
            <h2>С чего начать</h2>
            <ol className="public-docs-list">
              {START.map((step, index) => (
                <li key={step}>
                  <span className="public-docs-index">0{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <section id="data" className="public-docs-section">
            <p className="public-kicker">02 / Данные</p>
            <h2>Что хранит система</h2>
            <p>
              Качество анализа зависит от доступного контекста. Нехватка данных не скрывается — она видна в результате.
            </p>
            <dl className="public-docs-list">
              {DATA.map(([term, text]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="formats" className="public-docs-section">
            <p className="public-kicker">03 / Форматы</p>
            <h2>Как загружать</h2>
            <p>Поддерживаются текстовые форматы. Можно приложить файл или просто вставить текст.</p>
            <div className="public-tags">
              {FORMATS.map((format) => <span key={format}>.{format}</span>)}
            </div>
            <dl className="public-docs-list public-docs-list-wide">
              {LIMITS_TABLE.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="commands" className="public-docs-section">
            <p className="public-kicker">04 / Команды</p>
            <h2>Готовые разборы</h2>
            <p>
              В панели ассистента клавиша «/» открывает список команд. Команда подставляет посчитанные
              по вашей базе цифры и требует от модели разделять уровни вывода.
            </p>
            <dl className="public-docs-list public-docs-list-wide">
              {COMMANDS.map(([slug, text, enabled]) => (
                <div key={slug}>
                  <dt><code>{slug}</code></dt>
                  <dd className={enabled ? undefined : 'is-planned'}>{text}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="contract" className="public-docs-section">
            <p className="public-kicker">05 / Результат</p>
            <h2>Из чего состоит вывод</h2>
            <dl className="public-docs-list public-docs-list-wide">
              {CONTRACT.map(([term, text]) => (
                <div key={term}>
                  <dt><code>{term}</code></dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="limits" className="public-docs-section">
            <p className="public-kicker">06 / Ограничения</p>
            <h2>Что система не подменяет</h2>
            <ul className="public-docs-list">
              {LIMITS.map((item, index) => (
                <li key={item}>
                  <span className="public-docs-index">0{index + 1}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
