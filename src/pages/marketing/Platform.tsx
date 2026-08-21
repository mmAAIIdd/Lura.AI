import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowRight, Boxes, CheckCircle2, Database, GitCommitHorizontal, LineChart, MessageSquareText, Search } from 'lucide-react';

const authAppUrl = import.meta.env.VITE_AUTH_APP_URL ?? 'http://localhost:3001';

const LEVELS = [
  { label: 'Факт', text: 'После версии 4.1 выросло число жалоб на onboarding.', note: 'Считается по базе. Не может быть выдумано моделью.' },
  { label: 'Корреляция', text: 'Рост начался в течение суток после релиза.', note: 'Совпадение во времени. Это ещё не причина.' },
  { label: 'Гипотеза', text: 'Новый обязательный шаг вызывает непонимание.', note: 'Помечена как гипотеза, с уровнем уверенности.' },
  { label: 'Рекомендация', text: 'Проверить упрощённый экран на части аудитории.', note: 'Действие, у которого есть критерий успеха.' },
];

const SIGNALS = [
  [MessageSquareText, 'Обратная связь', 'Отзывы, обращения в поддержку, интервью, опросы.'],
  [LineChart, 'Продуктовые метрики', 'Completion, активация, удержание, отток — по сегментам.'],
  [GitCommitHorizontal, 'События изменений', 'Релизы: состав, цель, дата, затронутая функция.'],
  [Database, 'Ваши документы', 'Changelog, заметки, выгрузки — попадают в контекст через поиск.'],
];

export default function Platform() {
  return (
    <div>
      <section className="section relative overflow-hidden">
        <div className="page-aura" aria-hidden="true" />
        <div className="site-container relative py-20 sm:py-24">
          <p className="eyebrow">Платформа</p>
          <h1 className="section-title mt-5 max-w-4xl">
            Единица анализа — не отзыв и не релиз, а <span className="text-gradient">событие изменения</span>
          </h1>
          <p className="lead mt-7 max-w-3xl">
            Lura постоянно держит контекст продукта: какой была функция до изменения, что именно
            изменила команда, когда это произошло и что случилось после. Всё остальное строится
            вокруг этого события.
          </p>
        </div>
      </section>

      {/* Four levels — the core idea */}
      <section className="section section-alt">
        <div className="site-container py-16 sm:py-20">
          <p className="eyebrow">Главное правило</p>
          <h2 className="section-title mt-4 max-w-3xl">Четыре уровня, которые нельзя смешивать</h2>
          <p className="lead mt-5 max-w-2xl">
            Обычная языковая модель легко выдаёт предположение за доказанную причину.
            Здесь каждый уровень подписан и проверяем отдельно.
          </p>

          <div className="mt-10 grid gap-3 md:grid-cols-2">
            {LEVELS.map((level, index) => (
              <article key={level.label} className="card p-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-[var(--muted-soft)]">0{index + 1}</span>
                  {/* The label names the level, so it carries the distinction on its
                      own — no need to spend colour on what the word already says. */}
                  <span className="rounded-full border border-[var(--line-strong)] bg-[var(--raise-hover)] px-2.5 py-1 text-[11px] font-bold text-[var(--text)]">
                    {level.label}
                  </span>
                </div>
                <p className="mt-4 text-base leading-7 text-[var(--text)]">{level.text}</p>
                <p className="mt-3 text-sm leading-6 text-[var(--muted-soft)]">{level.note}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Signals */}
      <section className="section">
        <div className="site-container py-16 sm:py-20">
          <p className="eyebrow">Что собирает система</p>
          <h2 className="section-title mt-4 max-w-3xl">Сигналы вокруг изменения</h2>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SIGNALS.map(([Icon, title, text]) => {
              const CardIcon = Icon as typeof Database;
              return (
                <article key={title as string} className="card p-5">
                  <span className="card-icon"><CardIcon className="h-5 w-5" /></span>
                  <h3 className="mt-5 text-base font-bold">{title as string}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{text as string}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Chain */}
      <section className="section section-alt grid-lines">
        <div className="site-container grid gap-10 py-16 sm:py-20 lg:grid-cols-[.85fr_1.15fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="eyebrow">Цепочка</p>
            <h2 className="section-title mt-4">Единая временная линия продукта</h2>
            <p className="lead mt-5">
              Изменение, реакция и последствия рассматриваются вместе, а не по отдельности.
            </p>
          </div>

          <div className="card p-5 sm:p-7">
            {[
              ['Изменение', 'Release 4.1: переработан onboarding, добавлен обязательный шаг'],
              ['Реакция', '19 сигналов по теме, 15 из них негативные'],
              ['Поведение', 'Completion на мобильных: 80.7% → 54.1%'],
              ['Проверка', 'До релиза сигнал практически отсутствовал'],
              ['Контраргумент', 'На web показатель почти не изменился'],
              ['Гипотеза', 'Новый шаг не помещается на узком экране'],
            ].map(([label, value], index, all) => (
              <div key={label}>
                <div className="grid gap-2 rounded-xl border border-[var(--line)] bg-[var(--raise)] p-4 sm:grid-cols-[130px_1fr] sm:items-center">
                  <strong className="text-[11px] font-black uppercase tracking-wider text-[var(--muted-soft)]">{label}</strong>
                  <p className="text-sm leading-6 text-[var(--text)]">{value}</p>
                </div>
                {index < all.length - 1 && <ArrowDown className="mx-auto my-2 h-4 w-4 text-[var(--muted-soft)]" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Memory */}
      <section className="section">
        <div className="site-container py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="eyebrow">Память продукта</p>
              <h2 className="section-title mt-4">Со временем накапливается контекст</h2>
              <p className="lead mt-5">
                Система помнит историю: какая проблема возникала, что команда сделала и помогло ли это.
                Это позволяет отвечать на вопросы, которые не решаются одним разбором.
              </p>
              <div className="mt-7 grid gap-2.5">
                {[
                  'Мы уже сталкивались с похожей проблемой?',
                  'Какие прошлые решения действительно помогли?',
                  'Какие типы релизов чаще вызывают негатив?',
                ].map((item) => (
                  <div key={item} className="flex gap-3 text-sm text-[var(--muted)]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text)]" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="card card-glow p-6">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--muted-soft)]">
                <Boxes className="h-4 w-4" /> Организационный вывод
              </div>
              <p className="mt-5 text-base leading-7 text-[var(--text)]">
                «Три раза подряд команда меняла checkout без постепенной раскатки — и каждый раз
                резко росло число обращений в поддержку».
              </p>
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                Это уже не разбор одного релиза, а закономерность процесса. Такие выводы
                становятся видимыми только на длинной истории.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Boundaries */}
      <section className="section section-alt">
        <div className="site-container py-16 sm:py-20">
          <div className="card p-7 sm:p-9">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--muted-soft)]">
              <AlertTriangle className="h-4 w-4 text-[var(--text)]" /> Границы анализа
            </div>
            <h2 className="section-title mt-5 max-w-3xl text-[clamp(24px,3vw,36px)]">
              Что Lura сознательно не делает
            </h2>
            <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
              {[
                'Не выдаёт совпадение во времени за доказанную причину.',
                'Не заменяет CRM, трекер задач и продуктовую аналитику.',
                'Не скрывает источники за красивым резюме.',
                'Не делает уверенный вывод при нехватке данных.',
                'Не принимает решение вместо команды.',
                'Не придумывает числа, которых нет в данных.',
              ].map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border border-[var(--line)] bg-[var(--raise)] p-4 text-sm leading-6 text-[var(--muted)]">
                  <Search className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-soft)]" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-center">
            <a href={`${authAppUrl}/register`} className="gh-button gh-button-primary gh-button-lg">
              Попробовать <ArrowRight className="h-4 w-4" />
            </a>
            <Link to="/capabilities" className="gh-button gh-button-ghost gh-button-lg">
              Смотреть возможности
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
