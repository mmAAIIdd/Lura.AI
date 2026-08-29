/**
 * Команды в поле ввода.
 *
 * Разбор по пайплайну — тяжёлый режим: он занимает минуты, обязан сходить в
 * сеть и обязан выдать отчёт из шести разделов. Включать его на каждое «привет»
 * бессмысленно, а угадывать намерение по тексту — значит иногда угадывать
 * неверно. Поэтому режим включается явной командой, а всё остальное время
 * Lura остаётся обычным собеседником.
 */

import type { RunMode } from "@/lib/studio/types";

export type { RunMode };

export const REPORT_COMMAND = "/lur manager-dev start";

/* Пробелы внутри команды могут прийти любыми: из вставки — неразрывные, из
   переноса строки — сразу несколько. Сверяем по нормализованному виду. */
const REPORT_PATTERN = /^\/lur\s+manager-dev\s+start\b[:\-—]?\s*/i;

export type ParsedPrompt = {
  mode: RunMode;
  /** Текст задачи без командного префикса — именно он уходит в модель. */
  text: string;
  /** Исходная строка целиком: её видит пользователь в истории диалога. */
  raw: string;
};

export function parsePrompt(prompt: string): ParsedPrompt {
  const raw = prompt.trim();
  const normalized = raw.replace(/\u00a0/g, " ");
  const match = REPORT_PATTERN.exec(normalized);
  if (!match) return { mode: "chat", text: raw, raw };
  return { mode: "report", text: normalized.slice(match[0].length).trim(), raw };
}

/** Заголовок треда: команда в списке разборов не нужна, нужен предмет. */
export function titleFrom(prompt: string): string {
  const parsed = parsePrompt(prompt);
  const line = (parsed.text || parsed.raw).split("\n")[0].trim() || "Новый разбор";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}
