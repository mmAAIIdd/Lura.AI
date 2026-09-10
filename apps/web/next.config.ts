import type { NextConfig } from "next";

/* В сборке имя файла под /_next/static содержит хеш содержимого, и вечный
   кеш там безопасен. В режиме разработки имена постоянные — chunks/main-app.js
   и chunks/app/<маршрут>/page.js не меняются между пересборками. Помеченные
   immutable на год, они оседают в кеше браузера навсегда: страница приходит
   свежая, а скрипт к ней — прошлой версии, и React сообщает о расхождении
   разметки при каждом открытии. Обычная перезагрузка это не лечит: она берёт
   подчинённые ресурсы из кеша. */
const immutableAssets = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  /* Значок разработки Next по умолчанию висит в левом нижнем углу — ровно
     поверх нижней панели проводника, и её кнопки перестают нажиматься. В
     сборке значка нет, поэтому дефект виден только на машине разработчика,
     что делает его особенно неприятным: «у меня не работает кнопка». */
  devIndicators: { position: "bottom-right" },
  /* Docker packaging, not a build mode every target wants: the Dockerfile is
     the only thing that consumes .next/standalone, and it asks for this
     explicitly. Left on unconditionally it made `npm run build` fail outright
     on Windows — the copy step cannot reproduce the tree under a path with
     non-ASCII segments — and put a step in front of Vercel that nothing there
     reads. */
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        /* Бандлы и шрифты под /_next/static в сборке неизменяемы: в имени
           файла лежит хеш содержимого, и при любой правке меняется имя. Общее
           правило ниже накрывало их `no-store`, из-за чего браузер выкачивал
           весь JavaScript заново на каждый заход. */
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: immutableAssets ? "public, max-age=31536000, immutable" : "no-store, must-revalidate",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        /* Всё остальное — без кеша: страницы приложения содержат данные
           конкретного пользователя. Статика исключена явно, иначе правило
           перекрыло бы её заголовок. */
        source: "/((?!_next/static|_next/image).*)",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
