import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
        /* Бандлы и шрифты под /_next/static неизменяемы: в имени файла лежит
           хеш содержимого, и при любой правке меняется имя. Общее правило
           ниже накрывало их `no-store`, из-за чего браузер выкачивал весь
           JavaScript заново на каждый заход. */
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
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
