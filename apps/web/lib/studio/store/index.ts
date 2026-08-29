import { createFileStore } from "@/lib/studio/store/files";
import { createPostgresStore, databaseUrl } from "@/lib/studio/store/postgres";
import type { StudioDocument, StudioStore, StudioThread } from "@/lib/studio/store/contract";
import { newId } from "@/lib/studio/store/ids";

/**
 * Выбор хранилища.
 *
 * Есть строка подключения — состояние живёт в Postgres, и рабочее
 * пространство разворачивается на площадке без диска. Нет — файлы рядом с
 * приложением, и локальный запуск не требует вообще никакой подготовки.
 * Переключатель один и на уровне окружения: смешивать два хранилища в одном
 * запуске нечем и незачем.
 */

let store: StudioStore | null = null;

export function studioStore(): StudioStore {
  if (!store) store = databaseUrl() ? createPostgresStore() : createFileStore();
  return store;
}

export function storeLabel(): string {
  return studioStore().label;
}

/* ---------- Документы ---------- */

export const listDocuments = () => studioStore().listDocuments();
export const readDocumentText = (id: string) => studioStore().readDocumentText(id);
export const saveDocument = (...args: Parameters<StudioStore["saveDocument"]>) => studioStore().saveDocument(...args);
export const updateDocument = (...args: Parameters<StudioStore["updateDocument"]>) => studioStore().updateDocument(...args);
export const deleteDocument = (id: string) => studioStore().deleteDocument(id);
export const saveChunks = (...args: Parameters<StudioStore["saveChunks"]>) => studioStore().saveChunks(...args);
export const searchChunks = (...args: Parameters<StudioStore["searchChunks"]>) => studioStore().searchChunks(...args);

/**
 * Делает документ основным — тем, что всегда лежит в контексте агента.
 * Основной ровно один: два «главных» документа означали бы, что агент сам
 * решает, чей бизнес он разбирает.
 */
export async function setBusinessDocument(id: string): Promise<void> {
  const documents = await listDocuments();
  for (const document of documents) {
    if (document.id === id && document.kind !== "business") await updateDocument(document.id, { kind: "business" });
    else if (document.id !== id && document.kind === "business") await updateDocument(document.id, { kind: "source" });
  }
}

export async function businessDocument(): Promise<StudioDocument | null> {
  const documents = await listDocuments();
  return documents.find((document) => document.kind === "business") ?? null;
}

/* ---------- Треды ---------- */

export const listThreads = () => studioStore().listThreads();
export const readThread = (id: string) => studioStore().readThread(id);
export const saveThread = (thread: StudioThread) => studioStore().saveThread(thread);
export const deleteThread = (id: string) => studioStore().deleteThread(id);

export function emptyThread(title: string): StudioThread {
  const now = new Date().toISOString();
  return { id: newId(), title, createdAt: now, updatedAt: now, messages: [] };
}

/* ---------- Готовые отчёты ---------- */

export const saveArtifact = (id: string, markdown: string) => studioStore().saveArtifact(id, markdown);
export const readArtifact = (id: string) => studioStore().readArtifact(id);

export { newId };
export { StorageUnavailableError } from "@/lib/studio/store/contract";
export type { ChunkHit, StudioStore } from "@/lib/studio/store/contract";
export type {
  DocumentKind,
  StudioDocument,
  StudioMessage,
  StudioThread,
  ThreadSummary,
  ToolTrace,
} from "@/lib/studio/types";
