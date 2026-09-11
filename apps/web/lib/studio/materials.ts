import type { StudioDocument } from "@/lib/studio/types";

/**
 * Материалы: что можно загрузить и о чём спросить.
 *
 * Живёт отдельно от config.ts: тот тянет node:path и в браузер не попадает, а
 * форматы и предел нужно показывать прямо у кнопки загрузки — теми же
 * значениями, что проверяет сервер. Обещать на экране формат, который сервер
 * отвергнет, хуже, чем не обещать ничего.
 */

/** Совпадает с LIMITS.uploadBytes: сервер откажет ровно на этой границе. */
export const MATERIAL_MAX_BYTES = 4 * 1024 * 1024;
export const MATERIAL_MAX_LABEL = "4 МБ";
export const MATERIAL_ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.xml,.html,.htm";
export const MATERIAL_FORMATS = "TXT, MD, CSV, TSV, JSON, LOG, YAML, XML, HTML";

/**
 * Загрузка, видимая в интерфейсе. Файл хранится при ней, чтобы сорвавшуюся
 * загрузку можно было повторить, не выбирая файл заново.
 */
export type MaterialUpload = {
  key: string;
  name: string;
  state: "working" | "failed";
  error?: string;
  file: File;
};

/**
 * Примеры вопросов под загруженные материалы.
 *
 * Подбираются по названиям: пример про отзывы рядом с одной таблицей метрик
 * учит спрашивать о том, чего в данных нет. Если по названиям ничего не
 * понятно, остаётся один общий вопрос, а не три выдуманных.
 */
export function exampleQuestions(documents: StudioDocument[]): string[] {
  const titles = documents.map((document) => document.title.toLowerCase()).join(" | ");
  const out: string[] = [];
  if (/отзыв|review|feedback|обращен|тикет|ticket|support|поддержк|жалоб|nps/.test(titles)) {
    out.push("Какие проблемы чаще всего встречаются в отзывах и как они менялись после релиза?");
  }
  if (/релиз|release|changelog|верси|обновлен/.test(titles)) {
    out.push("Как пользователи отреагировали на последний релиз?");
  }
  if (/метрик|metric|показател|analytics|аналитик|kpi|конверси|retention|удержан/.test(titles)) {
    out.push("Какие показатели изменились после последнего релиза, а какие остались прежними?");
  }
  if (/инцидент|incident|сбо[йи]|outage|авари/.test(titles)) {
    out.push("Совпадают ли инциденты по времени с просадкой показателей?");
  }
  if (!out.length) out.push("Какие проблемы продукта видны в этих материалах?");
  return out.slice(0, 3);
}

/** «1 материал», «3 материала», «5 материалов». */
export function materialsWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return "материалов";
  switch (count % 10) {
    case 1:
      return "материал";
    case 2:
    case 3:
    case 4:
      return "материала";
    default:
      return "материалов";
  }
}
