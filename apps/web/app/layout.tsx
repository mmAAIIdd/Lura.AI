import type { Metadata } from "next";
// Self-hosted, and the same face the marketing site uses. The `opsz` build
// carries the optical-size axis, so large and small text take different shapes.
import "@fontsource-variable/inter/opsz.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lura — вход и регистрация",
  description: "Безопасный вход в Lura — платформу анализа изменений продукта, обратной связи и метрик.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
