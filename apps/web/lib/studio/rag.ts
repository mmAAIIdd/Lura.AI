import { LIMITS } from "@/lib/studio/config";
import { embedTexts } from "@/lib/studio/gemini";
import { loadIndexes, saveIndex, updateDocument, type ChunkIndex } from "@/lib/studio/store";
import { splitIntoChunks } from "@/lib/studio/text";

/**
 * Минимальный RAG: фрагменты документов + косинусная близость.
 *
 * Векторная база сюда не ставится — рабочее пространство держит десятки
 * документов, а не миллионы, и перебор по массиву на таком объёме быстрее,
 * чем сетевой вызов к внешнему индексу.
 *
 * Если эмбеддинги недоступны (нет ключа, кончилась квота), документ всё равно
 * индексируется — поиск переключается на ключевые слова. Тихо остаться без
 * поиска по своим же документам хуже, чем искать грубее.
 */

export type Excerpt = { documentId: string; title: string; text: string; score: number };

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator ? dot / denominator : 0;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((token) => token.length > 2);
}

/** Доля слов запроса, встретившихся во фрагменте. Грубо, но предсказуемо. */
function keywordScore(query: string, chunk: string): number {
  const words = new Set(tokenize(query));
  if (!words.size) return 0;
  const haystack = tokenize(chunk);
  const present = new Set(haystack.filter((token) => words.has(token)));
  const density = haystack.length ? present.size / Math.sqrt(haystack.length) : 0;
  return present.size / words.size + density * 0.1;
}

export async function indexDocument(documentId: string, title: string, text: string): Promise<ChunkIndex> {
  const chunks = splitIntoChunks(text);
  const vectors = await embedTexts(chunks, "RETRIEVAL_DOCUMENT");
  const index: ChunkIndex = { documentId, title, chunks, vectors: vectors && vectors.length === chunks.length ? vectors : null };
  await saveIndex(index);
  await updateDocument(documentId, { chunks: chunks.length, indexed: index.vectors ? "embeddings" : "keywords" });
  return index;
}

export async function searchDocuments(query: string, limit = LIMITS.autoContextChunks): Promise<Excerpt[]> {
  const indexes = await loadIndexes();
  if (!indexes.length) return [];

  const vectorised = indexes.filter((index) => index.vectors);
  let queryVector: number[] | null = null;
  if (vectorised.length) {
    const embedded = await embedTexts([query], "RETRIEVAL_QUERY");
    queryVector = embedded?.[0] ?? null;
  }

  const scored: Excerpt[] = [];
  for (const index of indexes) {
    index.chunks.forEach((chunk, position) => {
      const vector = index.vectors?.[position];
      const score = queryVector && vector ? cosine(queryVector, vector) : keywordScore(query, chunk);
      if (score > 0) scored.push({ documentId: index.documentId, title: index.title, text: chunk, score });
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function renderExcerpts(excerpts: Excerpt[]): string {
  if (!excerpts.length) return "";
  return excerpts
    .map((excerpt, position) => `[${position + 1}] Документ «${excerpt.title}»\n${excerpt.text}`)
    .join("\n\n");
}
