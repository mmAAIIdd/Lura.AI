import { useState } from 'react';
import { Check, Database, FileText, GitCommitHorizontal, LineChart, MessageSquareText, Terminal } from 'lucide-react';

const SECTIONS = [
  ['start', 'Быстрый старт'],
  ['data', 'Модель данных'],
  ['formats', 'Форматы загрузки'],
  ['commands', 'Команды'],
  ['contract', 'Контракт вывода'],
  ['limits', 'Ограничения'],
];

function Heading({ index, children }: { index: string; children: string }) {
  return (
    <>
      <p className="eyebrow">{index}</p>
      <h2 className="section-title mt-3 text-[clamp(24px,3vw,36px)]">{children}</h2>
    </>
  );
}

export default function Docs() {
  const [current, setCurrent] = useState('start');

  return (
    <div>
      <section className="section">
        <div className="site-container py-16 sm:py-20">
          <p className="eyebrow">Документация</p>
          <h1 className="section-title mt-5 max-w-4xl">Модель данных и правила анализа</h1>
          <p className="lead mt-6 max-w-3xl">
            Какие данные нужны системе, в каком виде их загружать и из чего состоит проверяемый вывод.
          </p>
        </div>
      </section>

      <div className="site-container grid border-t border-[var(--line)] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b border-[var(--line)] py-5 lg:border-b-0 lg:border-r lg:py-12 lg:pr-6">
          <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-24 lg:flex-col" aria-label="Разделы документации">
            {SECTIONS.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={() => setCurrent(id)}
                className={`shrink-0 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                  current === id
                    ? 'bg-[var(--raise-hover)] text-[var(--accent)]'
                    : 'text-[var(--muted)] hover:bg-[var(--raise-hover)] hover:text-[var(--text)]'
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 py-12 lg:py-16 lg:pl-12">
          <div className="max-w-3xl space-y-16">
            <section id="start" className="scroll-mt-24">
              <Heading index="01 / Старт">С чего начать</Heading>
              <ol className="mt-6 grid gap-3">
                {[
                  'Создайте аккаунт — рабочее пространство появится автоматически.',
                  'Загрузите источники: отзывы, changelog, заметки, выгрузку тикетов.',
                  'Добавьте релизы и метрики, если они есть — так станет доступно сравнение до/после.',
                  'Откройте панель ассистента и нажмите «/» для готового разбора.',
                ].map((step, index) => (
                  <li key={step} className="flex gap-4 rounded-xl border border-[var(--line)] bg-[var(--raise)] p-4">
                    <span className="font-mono text-xs font-bold text-[var(--accent)]">0{index + 1}</span>
                    <span className="text-sm leading-6 text-[var(--text)]">{step}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section id="data" className="scroll-mt-24">
              <Heading index="02 / Данные">Что хранит система</Heading>
              <p className="lead mt-5 text-base">
                Качество анализа зависит от доступного контекста. Нехватка данных не скрывается — она видна в результате.
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {[
                  [GitCommitHorizontal, 'Релизы', 'Версия, заголовок, описание, статус, дата выпуска.'],
                  [MessageSquareText, 'Сигналы', 'Источник, текст, тональность, тема, дата, связь с релизом.'],
                  [LineChart, 'Метрики', 'Ключ, значение, единица, сегмент, момент замера.'],
                  [FileText, 'Документы', 'Текст разбивается на фрагменты и индексируется для поиска.'],
                ].map(([Icon, title, text]) => {
                  const CardIcon = Icon as typeof Database;
                  return (
                    <article key={title as string} className="card p-5">
                      <span className="card-icon"><CardIcon className="h-5 w-5" /></span>
                      <h3 className="mt-4 font-bold">{title as string}</h3>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{text as string}</p>
                    </article>
                  );
                })}
              </div>
            </section>

            <section id="formats" className="scroll-mt-24">
              <Heading index="03 / Форматы">Как загружать</Heading>
              <p className="lead mt-5 text-base">
                Поддерживаются текстовые форматы. Можно приложить файл или просто вставить текст.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {['txt', 'md', 'csv', 'tsv', 'json', 'log', 'yaml', 'xml', 'html'].map((format) => (
                  <span key={format} className="rounded-lg border border-[var(--line-strong)] bg-[var(--raise)] px-3 py-1.5 font-mono text-xs text-[var(--muted)]">
                    .{format}
                  </span>
                ))}
              </div>
              <div className="mt-6 overflow-hidden rounded-xl border border-[var(--line)]">
                {[
                  ['Размер документа', 'до 2 МБ на файл'],
                  ['Разбиение', '≈1400 символов на фрагмент с перекрытием'],
                  ['Индексация', 'векторные представления, поиск по смыслу'],
                  ['Подстановка', 'наиболее релевантные фрагменты в контекст ответа'],
                ].map(([label, value]) => (
                  <div key={label} className="grid gap-1 border-b border-[var(--line)] p-4 last:border-0 sm:grid-cols-[220px_1fr]">
                    <strong className="text-sm text-[var(--text)]">{label}</strong>
                    <span className="text-sm text-[var(--muted)]">{value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section id="commands" className="scroll-mt-24">
              <Heading index="04 / Команды">Готовые разборы</Heading>
              <p className="lead mt-5 text-base">
                В панели ассистента клавиша «/» открывает список команд. Команда подставляет
                посчитанные по вашей базе цифры и требует от модели разделять уровни вывода.
              </p>
              <div className="mt-6 grid gap-2.5">
                {[
                  ['/анализ фидбека', 'Разбор обратной связи по темам и релизам', true],
                  ['/обзор обновлений', 'Что изменилось в релизах и что произошло после', true],
                  ['/аналитика покупок', 'Требует подключённого источника о покупках', false],
                  ['/внешняя оценка', 'Требует подключённых внешних площадок', false],
                ].map(([slug, text, enabled]) => (
                  <div
                    key={slug as string}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border p-4 ${
                      enabled ? 'border-[var(--line)] bg-[var(--raise)]' : 'border-[var(--line)] opacity-55'
                    }`}
                  >
                    <Terminal className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                    <code className="font-mono text-sm text-[var(--text)]">{slug as string}</code>
                    <span className="text-sm text-[var(--muted)]">{text as string}</span>
                  </div>
                ))}
              </div>
            </section>

            <section id="contract" className="scroll-mt-24">
              <Heading index="05 / Результат">Из чего состоит вывод</Heading>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {[
                  ['Finding', 'Наблюдение, посчитанное по данным.'],
                  ['Evidence', 'Источники и конкретные значения.'],
                  ['Affected area', 'Затронутая функция или релиз.'],
                  ['Impact', 'Влияние на пользователей и бизнес.'],
                  ['Confidence', 'Насколько вывод подтверждён и почему.'],
                  ['Hypotheses', 'Возможные объяснения.'],
                  ['Contradicting evidence', 'Что говорит против гипотезы.'],
                  ['Recommendation', 'Что имеет смысл проверить.'],
                  ['Validation', 'Метрика и период оценки.'],
                ].map(([title, text]) => (
                  <article key={title} className="rounded-xl border border-[var(--line)] p-4">
                    <strong className="font-mono text-xs text-[var(--accent)]">{title}</strong>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{text}</p>
                  </article>
                ))}
              </div>
            </section>

            <section id="limits" className="scroll-mt-24">
              <Heading index="06 / Ограничения">Что система не подменяет</Heading>
              <div className="mt-6 grid gap-2.5">
                {[
                  'Не заменяет CRM, трекер задач или продуктовую аналитику.',
                  'Не доказывает причинность по совпадению во времени.',
                  'Не скрывает источники за резюме.',
                  'Не принимает решение вместо команды.',
                  'Не делает уверенный вывод при недостатке данных.',
                ].map((item) => (
                  <div key={item} className="flex gap-3 rounded-xl border border-[var(--line)] bg-[var(--raise)] p-4 text-sm leading-6 text-[var(--muted)]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text)]" />
                    {item}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
