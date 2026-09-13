import { createFileStore, filesAreEphemeral } from "@/lib/studio/store/files";
import { createPostgresStore, databaseUrl } from "@/lib/studio/store/postgres";
import type { StudioDocument, StudioStore, StudioThread } from "@/lib/studio/store/contract";
import { newId } from "@/lib/studio/store/ids";
import type { OwnerId } from "@/lib/studio/owner";

/**
 * Выбор хранилища.
 *
 * Есть строка подключения — состояние живёт в Postgres, и рабочее
 * пространство разворачивается на площадке без диска. Нет — файлы рядом с
 * приложением, и локальный запуск не требует вообще никакой подготовки.
 * Переключатель один и на уровне окружения: смешивать два хранилища в одном
 * запуске нечем и незачем.
 *
 * Хранилище выдаётся только под владельца. Раньше здесь же лежали свободные
 * listDocuments(), saveThread() и прочие — по одной строке на метод, — и их
 * удаление и есть весь смысл этой правки: пока такая функция существует,
 * запрос без владельца пишется случайно и компилируется. Теперь его негде
 * написать: точка входа одна, и она требует проверенный OwnerId.
 */

export function studioStore(owner: OwnerId): StudioStore {
  return databaseUrl() ? createPostgresStore(owner) : createFileStore(owner);
}

/**
 * Переживёт ли состояние перезапуск.
 *
 * Postgres — да, файлы рядом с приложением — да, временная папка — нет.
 * Последний случай нужно показывать в интерфейсе: молча потерять загруженный
 * документ о бизнесе хуже, чем сразу сказать, что он не сохранится.
 */
export function storageIsEphemeral(): boolean {
  return databaseUrl() ? false : filesAreEphemeral();
}

/* ---------- Документы ---------- */

/**
 * Делает документ основным — тем, что всегда лежит в контексте агента.
 * Основной ровно один: два «главных» документа означали бы, что агент сам
 * решает, чей бизнес он разбирает.
 *
 * Чужой идентификатор сюда попасть может, но ничего не сделает: перебирается
 * список владельца, а в нём его нет.
 */
export async function setBusinessDocument(store: StudioStore, id: string): Promise<void> {
  const documents = await store.listDocuments();
  for (const document of documents) {
    if (document.id === id && document.kind !== "business") await store.updateDocument(document.id, { kind: "business" });
    else if (document.id !== id && document.kind === "business") await store.updateDocument(document.id, { kind: "source" });
  }
}

export async function businessDocument(store: StudioStore): Promise<StudioDocument | null> {
  const documents = await store.listDocuments();
  return documents.find((document) => document.kind === "business") ?? null;
}

/* ---------- Треды ---------- */

export function emptyThread(title: string): StudioThread {
  const now = new Date().toISOString();
  return { id: newId(), title, createdAt: now, updatedAt: now, messages: [] };
}

export { newId };
export { StorageUnavailableError } from "@/lib/studio/store/contract";
export type { ChunkHit, StudioStore } from "@/lib/studio/store/contract";
export type {
  DocumentKind,
  StudioDocument,
  StudioMessage,
  StudioNode,
  StudioThread,
  ThreadSummary,
  ToolTrace,
} from "@/lib/studio/types";
