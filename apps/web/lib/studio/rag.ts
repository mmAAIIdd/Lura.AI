import { LIMITS } from "@/lib/studio/config";
import { embedTexts } from "@/lib/studio/gemini";
import { saveChunks, searchChunks, updateDocument } from "@/lib/studio/store";
import { splitIntoChunks } from "@/lib/studio/text";

/**
 * Минимальный RAG: фрагменты документов и поиск по ним.
 *
 * Сам поиск выполняет хранилище — файловое считает косинус в приложении,
 * Postgres делает это внутри базы через pgvector. Здесь остаётся только то,
 * что от хранилища не зависит: нарезка документа, эмбеддинги и подготовка
 * фрагментов для контекста.
 *
 * Если эмбеддинги недоступны (нет ключа, кончилась квота), документ всё равно
 * индексируется — поиск переключается на слова. Тихо остаться без поиска по
 * своим же документам хуже, чем искать грубее.
 */

export type Excerpt = { documentId: string; title: string; text: string; score: number };

export async function indexDocument(
  documentId: string,
  title: string,
  text: string,
): Promise<{ chunks: number; vectors: boolean }> {
  const chunks = splitIntoChunks(text);
  const vectors = await embedTexts(chunks, "RETRIEVAL_DOCUMENT");
  const usable = vectors && vectors.length === chunks.length ? vectors : null;

  await saveChunks(documentId, title, chunks, usable);
  await updateDocument(documentId, { chunks: chunks.length, indexed: usable ? "embeddings" : "keywords" });

  return { chunks: chunks.length, vectors: Boolean(usable) };
}

/**
 * Поиск фрагментов, при необходимости — только по выбранным материалам.
 *
 * Хранилище фильтровать по документам не умеет, поэтому при выборе фрагменты
 * берутся с запасом и отсеиваются здесь. Если выбранные материалы — малая доля
 * всех, часть подходящих фрагментов может не попасть в запас; для десятков
 * документов, с которыми работает команда, это приемлемо.
 */
export async function searchDocuments(
  query: string,
  limit = LIMITS.autoContextChunks,
  only?: ReadonlySet<string> | null,
): Promise<Excerpt[]> {
  if (only && !only.size) return [];
  const embedded = await embedTexts([query], "RETRIEVAL_QUERY");
  const vector = embedded?.[0] ?? null;
  if (!only) return searchChunks({ text: query, vector }, limit);
  const hits = await searchChunks({ text: query, vector }, limit * 6);
  return hits.filter((hit) => only.has(hit.documentId)).slice(0, limit);
}

export function renderExcerpts(excerpts: Excerpt[]): string {
  if (!excerpts.length) return "";
  return excerpts
    .map((excerpt, position) => `[${position + 1}] Документ «${excerpt.title}»\n${excerpt.text}`)
    .join("\n\n");
}
