import { LIMITS } from "@/lib/studio/config";

/**
 * Разбиение документа на фрагменты для поиска.
 *
 * Границы ищутся по абзацам, затем по предложениям: фрагмент, обрезанный
 * посреди слова, потом всплывает в ответе обрывком и выглядит как ошибка
 * модели, хотя виноват индекс.
 */
export function splitIntoChunks(
  text: string,
  size = LIMITS.chunkChars,
  overlap = LIMITS.chunkOverlap,
): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);

    if (end < clean.length) {
      const window = clean.slice(start, end);
      const paragraph = window.lastIndexOf("\n\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
      const cut = paragraph > size * 0.5 ? paragraph : sentence > size * 0.5 ? sentence + 1 : -1;
      if (cut > 0) end = start + cut;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  laquo: "«", raquo: "»", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * HTML → читаемый текст.
 *
 * Своя реализация вместо библиотеки: приложению не нужен полноценный парсер,
 * нужен текст статьи без навигации и скриптов. Блочные теги превращаются в
 * переводы строк, чтобы у модели остались абзацы, а не одна простыня.
 */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 200) : null;

  let body = html;
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) body = bodyMatch[1];

  const text = body
    .replace(/<(script|style|noscript|svg|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n## ")
    .replace(/<\/(h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n— ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|ul|ol|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return {
    title,
    text: decodeEntities(text)
      .replace(/[ \t ]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/** Обрезка по границе слова — с явной пометкой, что текст неполный. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > limit * 0.8 ? cut.slice(0, boundary) : cut}\n\n[…текст обрезан, показано ${limit} из ${text.length} символов]`;
}

/** Похоже ли содержимое на текст, а не на бинарный файл. */
export function looksTextual(sample: string): boolean {
  if (!sample) return false;
  let control = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code === 0) return false;
    if (code < 9 || (code > 13 && code < 32)) control += 1;
  }
  return control / sample.length < 0.02;
}
