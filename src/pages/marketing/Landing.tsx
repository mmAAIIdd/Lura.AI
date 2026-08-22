import { authUrl } from '@/lib/authUrl';
import { ReleaseReadout } from '@/components/ReleaseReadout';

/**
 * The first screen carries the wordmark and a single way in. Below it sits one
 * worked example — the claim above is abstract until someone sees what the
 * product actually hands back.
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
          <p className="eyebrow">Пример разбора</p>
          <h2 className="section-title mt-4 max-w-[18ch]">Так выглядит один готовый вывод</h2>
          <p className="lead mt-5 max-w-[62ch]">
            Релиз, метрики, которые сдвинулись следом, причина и следующая проверка —
            вместе, со ссылками на данные, из которых это собрано.
          </p>
          <div className="mt-10">
            <ReleaseReadout />
          </div>
        </div>
      </section>
    </>
  );
}
