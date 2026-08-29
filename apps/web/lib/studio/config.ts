import path from "node:path";

import type { LuraModel } from "@/lib/studio/types";

/**
 * Настройки рабочего пространства Lura Studio.
 *
 * Здесь нет ни базы, ни очереди: всё состояние лежит в папке на диске, а
 * единственная внешняя зависимость — провайдер моделей. Так рабочее
 * пространство поднимается одной командой на localhost и не тянет за собой
 * Postgres, Redis и Python-сервис.
 */

/** Где лежат документы, индексы, треды и готовые отчёты. */
export function studioDir(): string {
  return process.env.STUDIO_DATA_DIR || path.join(process.cwd(), ".lura-studio");
}

/** Ключ провайдера моделей. Только на сервере — в браузер он не попадает никогда. */
export function geminiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key ? key : null;
}

/* ---------- Модели Lura ---------- */

/**
 * Наружу видны ровно два имени: lura-pro и lura-fast.
 *
 * Какие модели стоят за ними — деталь инфраструктуры. В интерфейс, в события
 * потока, в скачиваемый отчёт и в ответы агента уходит только публичное имя:
 * иначе смена провайдера превращается в смену продукта на глазах у команды.
 */
export type { LuraModel };

export const LURA_MODELS: LuraModel[] = ["lura-pro", "lura-fast"];
export const DEFAULT_MODEL: LuraModel = "lura-pro";

export function isLuraModel(value: unknown): value is LuraModel {
  return value === "lura-pro" || value === "lura-fast";
}

/** Публичное имя из чего угодно: пусто и мусор превращаются в модель по умолчанию. */
export function asLuraModel(value: unknown): LuraModel {
  return isLuraModel(value) ? value : DEFAULT_MODEL;
}

function fallbackModels(): string[] {
  return (process.env.GEMINI_FALLBACK_MODELS?.trim() || "gemini-3-flash-preview,gemini-3.6-flash,gemini-3.1-flash-lite")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Цепочка провайдерских моделей за публичным именем.
 *
 * У головной модели lura-pro на бесплатном тарифе дневная квота равна нулю,
 * поэтому при 429/404 клиент спускается по цепочке. Наружу подмена не
 * просачивается: пользователь выбрал lura-pro и видит lura-pro.
 */
export function modelChain(model: LuraModel = DEFAULT_MODEL): string[] {
  const head =
    model === "lura-pro"
      ? process.env.LURA_PRO_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-3.1-pro-preview"
      : process.env.LURA_FAST_MODEL?.trim() || "gemini-3-flash-preview";
  return [head, ...fallbackModels().filter((name) => name !== head)];
}

/** Все известные модели без повторов — для служебных вызовов вроде grounding. */
export function allModels(): string[] {
  return [...new Set([...modelChain("lura-pro"), ...modelChain("lura-fast")])];
}

export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL?.trim() || "gemini-embedding-001";

export const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Сколько раундов инструментов агент может отработать за один запрос.
 *
 * В разговоре предел ниже: обычный вопрос не стоит десяти походов в сеть, а
 * ждать ответа минуту в чате нельзя.
 */
export const MAX_TOOL_ROUNDS = Number(process.env.STUDIO_MAX_TOOL_ROUNDS || 8);
export const MAX_CHAT_TOOL_ROUNDS = Number(process.env.STUDIO_MAX_CHAT_TOOL_ROUNDS || 4);

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
