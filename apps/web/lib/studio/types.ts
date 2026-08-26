/**
 * Типы рабочего пространства, общие для сервера и браузера.
 *
 * Вынесены из store.ts, потому что тот открывает файлы через node:fs: даже
 * импорт типов оттуда в клиентский компонент — это приглашение затащить
 * серверный модуль в браузерный бандл.
 */

export type DocumentKind = "business" | "source";
export type StudioMode = "reports" | "updates";

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
  mode: StudioMode;
  text: string;
  createdAt: string;
  model?: string;
  tools?: ToolTrace[];
  attachments?: { name: string; mime: string }[];
  artifactId?: string;
};

export type StudioThread = {
  id: string;
  mode: StudioMode;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StudioMessage[];
};

export type ThreadSummary = { id: string; mode: StudioMode; title: string; updatedAt: string; messages: number };

export type WorkspaceState = {
  documents: StudioDocument[];
  threads: ThreadSummary[];
  runtime: {
    ready: boolean;
    models: string[];
    search: "gemini" | "brave" | "tavily" | "duckduckgo" | null;
    storage: string;
  };
};
