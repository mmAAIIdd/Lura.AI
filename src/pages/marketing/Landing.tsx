import { authUrl } from '@/lib/authUrl';

/**
 * One screen, nothing else. The three sections live in the top bar, so the
 * landing carries only the wordmark and a single way in.
 */
export default function Landing() {
  return (
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
        <a href={authUrl('/register')} className="hero-cta mt-14">
          Начать сейчас
        </a>
      </div>
    </section>
  );
}
