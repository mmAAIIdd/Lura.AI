import type { Metadata } from "next";
// Self-hosted, and the same face the marketing site uses. The `opsz` build
// carries the optical-size axis, so large and small text take different shapes.
import "@fontsource-variable/inter/opsz.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lura — вход и регистрация",
  description: "Безопасный вход в Lura — платформу анализа изменений продукта, обратной связи и метрик.",
};

/**
 * Resolve the theme before first paint, the way the marketing site does in its
 * index.html. Two differences follow from this being a separate origin: the
 * marketing site's stored choice is not readable here, so it is carried in a
 * `?theme=` parameter on the link that brought the visitor over, and there is
 * no toggle on these screens to write one of our own.
 */
const THEME_BOOT = `(function () {
  try {
    var fromLink = new URLSearchParams(location.search).get('theme');
    var stored = fromLink === 'light' || fromLink === 'dark' ? fromLink : localStorage.getItem('lura-theme');
    if (fromLink === 'light' || fromLink === 'dark') localStorage.setItem('lura-theme', fromLink);
    var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    document.documentElement.dataset.theme = stored || (prefersLight ? 'light' : 'dark');
  } catch (error) {
    document.documentElement.dataset.theme = 'dark';
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
