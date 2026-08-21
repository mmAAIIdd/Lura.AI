import { Link } from 'react-router-dom';
import { ArrowRight, BrainCircuit, Check, Clock, FileSearch, LineChart, Minus, Shield, Users, Zap } from 'lucide-react';

const authAppUrl = import.meta.env.VITE_AUTH_APP_URL ?? 'http://localhost:3001';

const VALUE = [
  {
    icon: Clock,
    title: 'Часы разбора превращаются в минуты',
    text: 'Вместо ручного перечитывания сотен отзывов после релиза — готовые кластеры проблем с частотой, динамикой и привязкой к версии.',
    metric: '120 отзывов → 5 реальных проблем',
  },
  {
    icon: LineChart,
    title: 'Просадка видна до того, как станет дорогой',
    text: 'Сравнение до и после релиза по сегментам показывает, где именно упал показатель — на мобильных, на web или у конкретной когорты.',
    metric: '80.7% → 54.1% на мобильных',
  },
  {
    icon: FileSearch,
    title: 'Ответ со ссылкой на источник',
    text: 'Загруженные документы индексируются и подставляются в контекст. Ассистент отвечает по вашим данным и указывает, из какого файла взят факт.',
    metric: 'Каждый вывод прослеживается',
  },
  {
    icon: BrainCircuit,
    title: 'Скрытые проблемы, а не только явные',
    text: '«Долго искал кнопку», «раньше было проще», «не понял куда нажать» — разные слова про одну UX-проблему объединяются в один паттерн.',
    metric: 'Слабые сигналы собираются вместе',
  },
];

const PLANS = [
  {
    name: 'Старт',
    price: 'Бесплатно',
    note: 'Одно рабочее пространство',
    cta: 'Начать сейчас',
    highlight: false,
    features: [
      ['Загрузка источников и индексация', true],
      ['Разбор обратной связи по темам', true],
      ['Сравнение до и после релиза', true],
      ['Готовые команды анализа', true],
      ['История продукта без ограничений', false],
      ['Совместная работа команды', false],
      ['Приоритетная поддержка', false],
    ],
  },
  {
    name: 'Команда',
    price: 'По запросу',
    note: 'Для продуктовых команд',
    cta: 'Обсудить внедрение',
    highlight: true,
    features: [
      ['Загрузка источников и индексация', true],
      ['Разбор обратной связи по темам', true],
      ['Сравнение до и после релиза', true],
      ['Готовые команды анализа', true],
      ['История продукта без ограничений', true],
      ['Совместная работа команды', true],
      ['Приоритетная поддержка', true],
    ],
  },
];

export default function Capabilities() {
  return (
    <div>
      <section className="section relative overflow-hidden">
        <div className="page-aura" aria-hidden="true" />
        <div className="site-container relative py-20 sm:py-24">
          <p className="eyebrow">Возможности</p>
          <h1 className="section-title mt-5 max-w-4xl">
            Что команда получает <span className="text-gradient">на следующий день</span> после релиза
          </h1>
          <p className="lead mt-7 max-w-3xl">
            Не набор функций, а ответы на вопросы, которые продуктовая команда задаёт себе каждую неделю.
          </p>
        </div>
      </section>

      <section className="section section-alt">
        <div className="site-container py-16 sm:py-20">
          <div className="grid gap-4 lg:grid-cols-2">
            {VALUE.map(({ icon: Icon, title, text, metric }) => (
              <article key={title} className="card p-6 sm:p-7">
                <span className="card-icon"><Icon className="h-5 w-5" /></span>
                <h2 className="mt-5 text-xl font-bold leading-snug">{title}</h2>
                <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{text}</p>
                <p className="mt-5 inline-block rounded-lg border border-[var(--line-strong)] bg-[var(--raise-hover)] px-3 py-2 font-mono text-xs text-[var(--accent)]">
                  {metric}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Why it pays off */}
      <section className="section">
        <div className="site-container py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <p className="eyebrow">Экономика</p>
              <h2 className="section-title mt-4">Когда подписка окупается</h2>
              <p className="lead mt-5">
                Один вовремя пойманный откат метрики обычно стоит дороже годового плана.
                Остальное — сэкономленное время команды.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['~6 ч', 'ручного разбора отзывов после релиза'],
                ['2 дня', 'типичная задержка, пока просадку заметят'],
                ['1 клик', 'до готового разбора с доказательствами'],
              ].map(([value, label]) => (
                <div key={label} className="card p-5 text-center">
                  <p className="stat-value text-gradient">{value}</p>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Plans */}
      <section className="section section-alt grid-lines">
        <div className="site-container py-16 sm:py-20">
          <p className="eyebrow">Планы</p>
          <h2 className="section-title mt-4 max-w-3xl">Начните бесплатно, расширяйтесь при необходимости</h2>

          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {PLANS.map((plan) => (
              <article key={plan.name} className={plan.highlight ? 'card card-glow p-7' : 'card p-7'}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold">{plan.name}</h3>
                  {plan.highlight && (
                    <span className="rounded-full border border-[var(--line-strong)] bg-[var(--raise-hover)] px-2.5 py-1 text-[11px] font-bold text-[var(--text)]">
                      рекомендуем
                    </span>
                  )}
                </div>
                <p className="stat-value mt-4">{plan.price}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{plan.note}</p>

                <a
                  href={`${authAppUrl}/register`}
                  className={`mt-6 w-full ${plan.highlight ? 'gh-button gh-button-primary gh-button-lg' : 'gh-button gh-button-ghost gh-button-lg'}`}
                >
                  {plan.cta} <ArrowRight className="h-4 w-4" />
                </a>

                <ul className="mt-7 grid gap-2.5">
                  {plan.features.map(([label, included]) => (
                    <li key={label as string} className="flex items-start gap-2.5 text-sm leading-6">
                      {included
                        ? <Check className="mt-1 h-4 w-4 shrink-0 text-[var(--text)]" />
                        : <Minus className="mt-1 h-4 w-4 shrink-0 text-[var(--muted-soft)]" />}
                      <span className={included ? 'text-[var(--text)]' : 'text-[var(--muted-soft)]'}>{label as string}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              [Shield, 'Данные изолированы по владельцу, ключи только на сервере'],
              [Users, 'Роли и участники — на плане «Команда»'],
              [Zap, 'Никакой карты для старта'],
            ].map(([Icon, text]) => {
              const RowIcon = Icon as typeof Shield;
              return (
                <div key={text as string} className="flex items-center gap-3 rounded-lg border border-[var(--line)] p-4 text-xs leading-5 text-[var(--muted)]">
                  <RowIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  {text as string}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section relative overflow-hidden">
        <div className="site-container relative py-20 text-center">
          <h2 className="section-title mx-auto max-w-3xl">Проверьте на своём последнем релизе</h2>
          <p className="lead mx-auto mt-5 max-w-xl">
            Загрузите отзывы и историю изменений — разбор появится в тот же день.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={`${authAppUrl}/register`} className="gh-button gh-button-primary gh-button-lg">
              Начать бесплатно <ArrowRight className="h-4 w-4" />
            </a>
            <Link to="/docs" className="gh-button gh-button-ghost gh-button-lg">Документация</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
