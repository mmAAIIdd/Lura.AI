import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { studioDir } from "@/lib/studio/config";
import type { DocumentKind, StudioDocument, StudioMode, StudioThread, ThreadSummary } from "@/lib/studio/types";

/**
 * Файловое хранилище рабочего пространства.
 *
 * Одна папка на диске вместо базы: документ — это .txt рядом с .json, тред —
 * один .json. Такой формат читается глазами и переживает перезапуск, а
 * поднимать под локальное рабочее пространство Postgres смысла нет.
 */

export type {
  ThreadSummary,
  DocumentKind,
  StudioDocument,
  StudioMessage,
  StudioMode,
  StudioThread,
  ToolTrace,
} from "@/lib/studio/types";

type Paths = ReturnType<typeof paths>;

function paths() {
  const root = studioDir();
  return {
    root,
    documents: path.join(root, "documents"),
    index: path.join(root, "index"),
    threads: path.join(root, "threads"),
    artifacts: path.join(root, "artifacts"),
  };
}

async function ensure(dirs: Paths): Promise<void> {
  await Promise.all(
    [dirs.root, dirs.documents, dirs.index, dirs.threads, dirs.artifacts].map((dir) =>
      fs.mkdir(dir, { recursive: true }),
    ),
  );
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

export function newId(): string {
  return randomUUID().slice(0, 12);
}

/* ---------- Документы ---------- */

export async function listDocuments(): Promise<StudioDocument[]> {
  const dirs = paths();
  await ensure(dirs);
  const files = await fs.readdir(dirs.documents).catch(() => [] as string[]);
  const documents = await Promise.all(
    files.filter((name) => name.endsWith(".json")).map((name) => readJson<StudioDocument>(path.join(dirs.documents, name))),
  );
  return documents
    .filter((doc): doc is StudioDocument => Boolean(doc))
    /* Документ о бизнесе всегда первый: он же и в контексте всегда первый. */
    .sort((a, b) => (a.kind === b.kind ? a.createdAt.localeCompare(b.createdAt) : a.kind === "business" ? -1 : 1));
}

export async function readDocumentText(id: string): Promise<string> {
  const dirs = paths();
  return fs.readFile(path.join(dirs.documents, `${id}.txt`), "utf8").catch(() => "");
}

export async function saveDocument(
  meta: Omit<StudioDocument, "id" | "createdAt" | "chars" | "chunks" | "indexed"> & { id?: string },
  text: string,
): Promise<StudioDocument> {
  const dirs = paths();
  await ensure(dirs);
  const document: StudioDocument = {
    id: meta.id ?? newId(),
    title: meta.title,
    kind: meta.kind,
    origin: meta.origin,
    chars: text.length,
    chunks: 0,
    indexed: "keywords",
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dirs.documents, `${document.id}.txt`), text, "utf8");
  await writeJson(path.join(dirs.documents, `${document.id}.json`), document);
  return document;
}

export async function updateDocument(id: string, patch: Partial<StudioDocument>): Promise<StudioDocument | null> {
  const dirs = paths();
  const file = path.join(dirs.documents, `${id}.json`);
  const current = await readJson<StudioDocument>(file);
  if (!current) return null;
  const next = { ...current, ...patch, id: current.id };
  await writeJson(file, next);
  return next;
}

export async function deleteDocument(id: string): Promise<void> {
  const dirs = paths();
  await Promise.all([
    fs.rm(path.join(dirs.documents, `${id}.json`), { force: true }),
    fs.rm(path.join(dirs.documents, `${id}.txt`), { force: true }),
    fs.rm(path.join(dirs.index, `${id}.json`), { force: true }),
  ]);
}

/**
 * Делает документ основным — тем самым, что всегда лежит в контексте агента.
 * Основной ровно один: два «главных» документа означали бы, что агент сам
 * решает, чей бизнес он анализирует.
 */
export async function setBusinessDocument(id: string): Promise<void> {
  const documents = await listDocuments();
  await Promise.all(
    documents.map((doc) =>
      doc.id === id
        ? doc.kind === "business" ? null : updateDocument(doc.id, { kind: "business" })
        : doc.kind === "business" ? updateDocument(doc.id, { kind: "source" }) : null,
    ),
  );
}

export async function businessDocument(): Promise<StudioDocument | null> {
  const documents = await listDocuments();
  return documents.find((doc) => doc.kind === "business") ?? null;
}

/* ---------- Индекс фрагментов ---------- */

export type ChunkIndex = {
  documentId: string;
  title: string;
  /** null, когда эмбеддинги недоступны и поиск идёт по ключевым словам. */
  vectors: number[][] | null;
  chunks: string[];
};

export async function saveIndex(index: ChunkIndex): Promise<void> {
  const dirs = paths();
  await ensure(dirs);
  await writeJson(path.join(dirs.index, `${index.documentId}.json`), index);
}

export async function loadIndexes(): Promise<ChunkIndex[]> {
  const dirs = paths();
  await ensure(dirs);
  const files = await fs.readdir(dirs.index).catch(() => [] as string[]);
  const indexes = await Promise.all(
    files.filter((name) => name.endsWith(".json")).map((name) => readJson<ChunkIndex>(path.join(dirs.index, name))),
  );
  return indexes.filter((index): index is ChunkIndex => Boolean(index));
}

/* ---------- Треды ---------- */

export async function listThreads(): Promise<ThreadSummary[]> {
  const dirs = paths();
  await ensure(dirs);
  const files = await fs.readdir(dirs.threads).catch(() => [] as string[]);
  const threads = await Promise.all(
    files.filter((name) => name.endsWith(".json")).map((name) => readJson<StudioThread>(path.join(dirs.threads, name))),
  );
  return threads
    .filter((thread): thread is StudioThread => Boolean(thread))
    .map((thread) => ({
      id: thread.id,
      mode: thread.mode ?? "reports",
      title: thread.title,
      updatedAt: thread.updatedAt,
      messages: thread.messages.length,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readThread(id: string): Promise<StudioThread | null> {
  const dirs = paths();
  return readJson<StudioThread>(path.join(dirs.threads, `${id}.json`));
}

export async function saveThread(thread: StudioThread): Promise<void> {
  const dirs = paths();
  await ensure(dirs);
  await writeJson(path.join(dirs.threads, `${thread.id}.json`), thread);
}

export async function deleteThread(id: string): Promise<void> {
  const dirs = paths();
  await fs.rm(path.join(dirs.threads, `${id}.json`), { force: true });
}

export function emptyThread(title: string, mode: StudioMode): StudioThread {
  const now = new Date().toISOString();
  return { id: newId(), mode, title, createdAt: now, updatedAt: now, messages: [] };
}

/* ---------- Готовые отчёты ---------- */

export async function saveArtifact(id: string, markdown: string): Promise<void> {
  const dirs = paths();
  await ensure(dirs);
  await fs.writeFile(path.join(dirs.artifacts, `${id}.md`), markdown, "utf8");
}

export async function readArtifact(id: string): Promise<string | null> {
  const dirs = paths();
  return fs.readFile(path.join(dirs.artifacts, `${id}.md`), "utf8").catch(() => null);
}
