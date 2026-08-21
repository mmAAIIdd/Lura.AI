import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, BarChart3, Check, Database, Lightbulb, MessageSquareText, Search, ShieldCheck } from 'lucide-react';

const authAppUrl = import.meta.env.VITE_AUTH_APP_URL ?? 'http://localhost:3001';

const stages = [
  [Database, 'Контекст', 'История продукта задаёт точку сравнения.'],
  [MessageSquareText, 'Реакция', 'Отзывы группируются по теме и времени.'],
  [BarChart3, 'Метрики', 'Показатели сравниваются до и после.'],
  [Search, 'Связь', 'Система ищет подтверждения и противоречия.'],
  [Lightbulb, 'Действие', 'Формируется гипотеза и способ проверки.'],
];
export default function HowItWorks() {

  return (
    <div>
      <section className="lura-hero-background lura-hero-background--method relative overflow-hidden border-b border-[var(--line)]">
        <div className="lura-dot-grid absolute inset-0 opacity-45" aria-hidden="true" />
        <div className="site-container relative py-12 sm:py-16">
          <div className="mb-7 h-1 w-32 bg-gradient-to-r from-[var(--chocolate)] via-[#a58572] to-[#9299a3]" />
          <p className="eyebrow">Метод Lura</p>
          <h1 className="display-title mt-5 max-w-5xl text-[48px] leading-[.98] sm:text-[72px]">От разрозненных сигналов к проверяемому выводу.</h1>
          <p className="mt-7 max-w-3xl text-xl leading-9 text-[#55585e]">Lura проходит фиксированные этапы анализа и показывает ограничения, если данных недостаточно.</p>
        </div>
      </section>

      <section className="lura-light-surface py-12 sm:py-16">
        <div className="site-container grid gap-8 lg:grid-cols-[.7fr_1.3fr]">
          <div className="lg:sticky lg:top-28 lg:self-start"><p className="eyebrow">Pipeline</p><h2 className="section-title mt-4">Пять этапов анализа</h2></div>
          <div className="border-t border-[var(--line)]">
            {stages.map(([Icon,title,text],index)=>{ const StageIcon=Icon as typeof Database; return <article key={title as string} className="grid gap-4 border-b border-[var(--line)] py-5 sm:grid-cols-[42px_46px_.75fr_1.25fr] sm:items-center"><span className="font-mono text-xs font-semibold text-[var(--chocolate-soft)]">0{index+1}</span><span className="grid h-10 w-10 place-items-center bg-[var(--paper-deep)] text-[var(--chocolate)]"><StageIcon className="h-4 w-4" /></span><h3 className="text-base font-extrabold">{title as string}</h3><span className="text-base leading-7 text-[var(--muted)]">{text as string}</span></article>;})}
          </div>
        </div>
      </section>

      <section className="navy-section lura-panel-grid py-12 sm:py-16">
        <div className="site-container grid gap-8 lg:grid-cols-[.8fr_1.2fr]">
          <div><p className="text-xs font-black uppercase text-[#aebbe0]">Связь данных</p><h2 className="section-title mt-4">Единая временная линия продукта</h2><p className="mt-5 text-lg leading-8 text-[#b8bfce]">Изменение, реакция и последствия смотрятся вместе.</p></div>
          <div className="border border-white/15 bg-black/10 p-5 sm:p-7">
            {[
              ['Изменение','Release 6.0: новый интерфейс поиска'],
              ['Реакция','Новые жалобы на выбор режима'],
              ['Поведение','Рост повторных запросов'],
              ['Проверка','Сигнал отсутствовал до релиза'],
              ['Гипотеза','Интерфейс не объясняет различие режимов'],
            ].map(([label,value],index)=><div key={label}><div className="grid gap-2 border border-white/10 bg-white/[.035] p-4 sm:grid-cols-[100px_1fr]"><strong className="text-xs font-black uppercase text-[#9faed4]">{label}</strong><p className="text-base text-[#e8eaf0]">{value}</p></div>{index<4&&<ArrowDown className="mx-auto my-2 h-4 w-4 text-[#7f899e]" />}</div>)}
          </div>
        </div>
      </section>

      <section className="lura-light-surface py-12 sm:py-16">
        <div className="site-container grid gap-8 lg:grid-cols-[1.2fr_.8fr] lg:items-start">
          <div>
            <p className="eyebrow">Формат результата</p><h2 className="section-title mt-4 max-w-3xl">Факты отделены от интерпретации.</h2>
            <div className="mt-8 overflow-hidden border border-[var(--line)] bg-[var(--white)]">
              {[
                ['Finding','Наблюдаемый факт или устойчивый сигнал.'],
                ['Evidence','Конкретные изменения, сообщения и метрики.'],
                ['Hypothesis','Возможное объяснение и уровень уверенности.'],
                ['Recommendation','Действие, которое имеет смысл проверить.'],
                ['Validation','Показатель и период оценки результата.'],
              ].map(([title,text],index)=><div key={title} className="grid gap-3 border-b border-[var(--line)] p-4 last:border-0 sm:grid-cols-[40px_150px_1fr] sm:items-center"><span className="font-mono text-xs font-semibold text-[var(--chocolate-soft)]">0{index+1}</span><strong className="text-base">{title}</strong><span className="text-base text-[var(--muted)]">{text}</span></div>)}
            </div>
          </div>
          <aside className="border border-[var(--line)] bg-[var(--white)] p-6 sm:p-7">
            <ShieldCheck className="h-7 w-7 text-[var(--chocolate)]" />
            <h3 className="display-title mt-5 text-3xl">Границы анализа видны.</h3>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">Связь между событиями не выдаётся за доказанную причинность.</p>
            <div className="mt-6 space-y-3">{['Источники указаны у каждого вывода.','Гипотеза маркируется отдельно.','Недостающий контекст сохраняется.','Есть критерий проверки.'].map(item=><div key={item} className="flex gap-3 text-base text-[#4c4f54]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--chocolate-soft)]" />{item}</div>)}</div>
          </aside>
        </div>
      </section>

      <section className="chocolate-section py-12 text-center sm:py-16"><div className="mx-auto max-w-3xl px-5"><h2 className="display-title text-4xl sm:text-6xl">Начните с одного релиза.</h2><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><a href={`${authAppUrl}/register`} className="inline-flex min-h-12 items-center justify-center gap-2 bg-[var(--white)] px-6 text-sm font-bold text-[var(--chocolate)]">Начать работу <ArrowRight className="h-4 w-4" /></a><Link to="/docs" className="inline-flex min-h-12 items-center justify-center border border-white/30 px-6 text-sm font-bold text-white">Документация</Link></div></div></section>
    </div>
  );
}
