/**
 * Типы рабочего пространства, общие для сервера и браузера.
 *
 * Вынесены из store.ts, потому что тот открывает файлы через node:fs: даже
 * импорт типов оттуда в клиентский компонент — это приглашение затащить
 * серверный модуль в браузерный бандл.
 */

export type DocumentKind = "business" | "source";

/** Публичные имена моделей. За ними стоят разные модели провайдера. */
export type LuraModel = "lura-pro" | "lura-fast";

/** Разговор или полный разбор по пайплайну — зависит от команды в запросе. */
export type RunMode = "chat" | "report";

export type StudioDocument = {
  id: string;
  title: string;
  kind: DocumentKind;
  origin: { type: "file" | "url" | "text"; name?: string; url?: string };
  chars: number;
  chunks: number;
  indexed: "embeddings" | "keywords";
  createdAt: string;
};

export type ToolTrace = {
  name: string;
  argument: string;
  summary: string;
  ok: boolean;
  sources?: { title: string; url: string }[];
};

export type StudioMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  createdAt: string;
  model?: LuraModel;
  mode?: RunMode;
  tools?: ToolTrace[];
  attachments?: { name: string; mime: string }[];
  artifactId?: string;
};

export type StudioThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StudioMessage[];
};

export type ThreadSummary = { id: string; title: string; updatedAt: string; messages: number };

export type WorkspaceState = {
  documents: StudioDocument[];
  threads: ThreadSummary[];
  runtime: {
    ready: boolean;
    models: LuraModel[];
    search: "google" | "gemini" | "brave" | "tavily" | "duckduckgo" | null;
    storage: string;
    /** Состояние не переживёт перезапуск — интерфейс обязан предупредить. */
    ephemeral: boolean;
  };
};

/**
 * Узел проекта: папка или файл отчёта.
 *
 * Дерево хранится плоским списком со ссылкой на родителя, а не вложенными
 * объектами: так переименование и перенос — правка одной записи, а не
 * пересборка всей ветки, и порядок обхода задаёт интерфейс, а не хранилище.
 */
export type StudioNode = {
  id: string;
  parentId: string | null;
  kind: "folder" | "file";
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Размер содержимого в символах. Для папки — null. */
  chars: number | null;
};
