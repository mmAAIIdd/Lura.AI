import path from "node:path";

/**
 * Настройки рабочего пространства Lura Studio.
 *
 * Здесь нет ни базы, ни очереди: всё состояние лежит в папке на диске, а
 * единственная внешняя зависимость — Gemini API. Так рабочее пространство
 * поднимается одной командой на localhost и не тянет за собой Postgres,
 * Redis и Python-сервис.
 */

/** Где лежат документы, индексы, треды и готовые отчёты. */
export function studioDir(): string {
  return process.env.STUDIO_DATA_DIR || path.join(process.cwd(), ".lura-studio");
}

/** Ключ Gemini. Только на сервере — в браузер он не попадает никогда. */
export function geminiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key ? key : null;
}

/**
 * Модель по умолчанию и запасные.
 *
 * gemini-3.1-pro-preview — то, на чём Lura должна работать. У бесплатного
 * тарифа его дневная квота равна нулю, поэтому при 429/404 клиент спускается
 * по цепочке и честно сообщает наверх, какая модель ответила на самом деле,
 * вместо того чтобы молча притвориться, будто отвечала pro.
 */
export function modelChain(): string[] {
  const preferred = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-pro-preview";
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS?.trim() || "gemini-3-flash-preview,gemini-3.6-flash,gemini-3.1-flash-lite")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return [preferred, ...fallbacks.filter((name) => name !== preferred)];
}

export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL?.trim() || "gemini-embedding-001";

export const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

/** Сколько раундов инструментов агент может отработать за один запрос. */
export const MAX_TOOL_ROUNDS = Number(process.env.STUDIO_MAX_TOOL_ROUNDS || 8);

/** Ограничения контекста. Подобраны так, чтобы окно модели не переполнялось. */
export const LIMITS = {
  /** Документ о бизнесе идёт в системную инструкцию целиком до этого предела. */
  businessDocChars: 12000,
  /** Столько текста возвращает fetch_url за один вызов. */
  fetchedPageChars: 14000,
  /** Размер и перекрытие фрагмента для поиска по документам. */
  chunkChars: 1200,
  chunkOverlap: 160,
  /** Сколько фрагментов подставляется в контекст автоматически. */
  autoContextChunks: 6,
  /** Сколько сообщений истории уходит в модель. */
  historyMessages: 16,
  /** Предел на загружаемый файл. Тело запроса на бессерверной площадке
      ограничено примерно 4.5 МБ, и файл крупнее не доедет до обработчика —
      отказ с понятным текстом лучше, чем 413 без объяснений. */
  uploadBytes: 4 * 1024 * 1024,
};

export { studioIsOpen } from "@/lib/studio/access";
