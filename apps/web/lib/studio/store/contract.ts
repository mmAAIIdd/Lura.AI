import type {
  DocumentKind,
  StudioDocument,
  StudioMode,
  StudioThread,
  ThreadSummary,
} from "@/lib/studio/types";

/**
 * Контракт хранилища рабочего пространства.
 *
 * Реализаций две. Файловая — для машины разработчика и для сервера со своим
 * диском: ничего не нужно поднимать, документ лежит рядом текстом. Postgres —
 * для бессерверной площадки, где файловая система только для чтения.
 *
 * Поиск по фрагментам живёт здесь, а не в слое RAG, потому что у Postgres он
 * выполняется внутри базы: вытаскивать тысячи векторов по сети, чтобы
 * посчитать косинус в приложении, — это мегабайты трафика на каждый вопрос.
 */

export type ChunkHit = {
  documentId: string;
  title: string;
  text: string;
  score: number;
};

export type DocumentDraft = {
  id?: string;
  title: string;
  kind: DocumentKind;
  origin: StudioDocument["origin"];
};

export interface StudioStore {
  /** Как называть это хранилище в интерфейсе и в логах. */
  readonly label: string;

  listDocuments(): Promise<StudioDocument[]>;
  readDocumentText(id: string): Promise<string>;
  saveDocument(draft: DocumentDraft, text: string): Promise<StudioDocument>;
  updateDocument(id: string, patch: Partial<StudioDocument>): Promise<StudioDocument | null>;
  deleteDocument(id: string): Promise<void>;

  /** Фрагменты документа вместе с векторами. Векторов может не быть. */
  saveChunks(documentId: string, title: string, chunks: string[], vectors: number[][] | null): Promise<void>;

  /**
   * Поиск фрагментов. Вектор задан — ищем по смыслу, нет — по словам.
   * Обе ветки обязаны работать: эмбеддинги могут быть недоступны по квоте.
   */
  searchChunks(query: { text: string; vector: number[] | null }, limit: number): Promise<ChunkHit[]>;

  listThreads(): Promise<ThreadSummary[]>;
  readThread(id: string): Promise<StudioThread | null>;
  saveThread(thread: StudioThread): Promise<void>;
  deleteThread(id: string): Promise<void>;

  saveArtifact(id: string, markdown: string): Promise<void>;
  readArtifact(id: string): Promise<string | null>;
}

/**
 * Хранилище недоступно для записи.
 *
 * Отдельный тип, потому что причина почти всегда одна: приложение развернули
 * туда, где файловая система только для чтения, и не задали внешнее
 * хранилище. Сырая EROFS из mkdir выглядит как поломка кода, хотя это
 * несовпадение хранилища и площадки.
 */
export class StorageUnavailableError extends Error {}

export type { DocumentKind, StudioDocument, StudioMode, StudioThread, ThreadSummary };
