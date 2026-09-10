import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { studioDir } from "@/lib/studio/config";
import {
  StorageUnavailableError,
  type ChunkHit,
  type DocumentDraft,
  type StudioDocument,
  type StudioNode,
  type StudioStore,
  type StudioThread,
  type ThreadSummary,
} from "@/lib/studio/store/contract";
import { newId } from "@/lib/studio/store/ids";

/**
 * Файловое хранилище: одна папка на диске вместо базы.
 *
 * Документ — это .txt рядом с .json, тред — один .json. Формат читается
 * глазами и переживает перезапуск, а поднимать Postgres под локальное
 * рабочее пространство одной команды незачем.
 */

type Paths = {
  root: string;
  documents: string;
  index: string;
  threads: string;
  artifacts: string;
  project: string;
};

function paths(root: string): Paths {
  return {
    root,
    documents: path.join(root, "documents"),
    index: path.join(root, "index"),
    threads: path.join(root, "threads"),
    artifacts: path.join(root, "artifacts"),
    project: path.join(root, "project"),
  };
}

/**
 * Проверка папки на пригодность.
 *
 * Одного mkdir мало: он проходит и там, где потом падает запись, а на
 * бессерверной площадке каталог приложения вообще не существует и ошибка
 * приходит как ENOENT, а не как EROFS. Поэтому после создания папок сюда же
 * пишется и удаляется пробный файл — это единственный надёжный ответ на
 * вопрос «можно ли здесь хранить состояние».
 */
async function usable(root: string): Promise<Paths | null> {
  const dirs = paths(root);
  try {
    await Promise.all(
      [dirs.root, dirs.documents, dirs.index, dirs.threads, dirs.artifacts, dirs.project].map((dir) =>
        fs.mkdir(dir, { recursive: true }),
      ),
    );
    const probe = path.join(dirs.root, ".writable");
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    return dirs;
  } catch {
    return null;
  }
}

/* Куда в итоге легло состояние и пережило ли оно перезапуск. */
let ephemeral = false;
let pending: Promise<Paths> | null = null;

export function filesAreEphemeral(): boolean {
  return ephemeral;
}

/**
 * Корень хранилища, разрешаемый один раз за жизнь процесса.
 *
 * Если настроенная папка недоступна для записи, состояние уходит во временную
 * папку системы. Это не полноценная замена: на бессерверной площадке она своя
 * у каждого экземпляра и очищается между запусками — зато чат и разборы
 * работают вместо отказа на первом же запросе. Постоянное хранилище
 * включается переменной STUDIO_DATABASE_URL.
 */
async function resolveRoot(): Promise<Paths> {
  const wanted = studioDir();
  const direct = await usable(wanted);
  if (direct) {
    ephemeral = false;
    return direct;
  }

  const temporary = await usable(path.join(os.tmpdir(), "lura-studio"));
  if (temporary) {
    ephemeral = true;
    console.warn(
      `[studio] ${wanted} недоступна для записи, состояние уходит во временную папку ${temporary.root}. ` +
        "Задайте STUDIO_DATABASE_URL, чтобы оно сохранялось.",
    );
    return temporary;
  }

  throw new StorageUnavailableError(
    "Рабочему пространству негде хранить состояние: ни рабочая папка, ни временная папка системы " +
      "не доступны для записи. Задайте STUDIO_DATABASE_URL — состояние уйдёт в Postgres.",
  );
}

function ready(): Promise<Paths> {
  if (!pending) {
    /* Неудачную попытку не кэшируем: причина может быть временной, и
       навсегда запомненный отказ пережил бы саму проблему. */
    pending = resolveRoot().catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
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

type ChunkIndex = {
  documentId: string;
  title: string;
  vectors: number[][] | null;
  chunks: string[];
};

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

export function createFileStore(): StudioStore {
  return {
    get label() {
      return ephemeral ? "временные файлы" : "файлы";
    },

    async listDocuments() {
      const dirs = await ready();
      const files = await fs.readdir(dirs.documents).catch(() => [] as string[]);
      const documents = await Promise.all(
        files
          .filter((name) => name.endsWith(".json"))
          .map((name) => readJson<StudioDocument>(path.join(dirs.documents, name))),
      );
      return documents
        .filter((doc): doc is StudioDocument => Boolean(doc))
        /* Документ о бизнесе всегда первый: он же и в контексте первый. */
        .sort((a, b) => (a.kind === b.kind ? a.createdAt.localeCompare(b.createdAt) : a.kind === "business" ? -1 : 1));
    },

    async readDocumentText(id) {
      const dirs = await ready();
      return fs.readFile(path.join(dirs.documents, `${id}.txt`), "utf8").catch(() => "");
    },

    async saveDocument(draft: DocumentDraft, text) {
      const dirs = await ready();
      const document: StudioDocument = {
        id: draft.id ?? newId(),
        title: draft.title,
        kind: draft.kind,
        origin: draft.origin,
        chars: text.length,
        chunks: 0,
        indexed: "keywords",
        createdAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(dirs.documents, `${document.id}.txt`), text, "utf8");
      await writeJson(path.join(dirs.documents, `${document.id}.json`), document);
      return document;
    },

    async updateDocument(id, patch) {
      const dirs = await ready();
      const file = path.join(dirs.documents, `${id}.json`);
      const current = await readJson<StudioDocument>(file);
      if (!current) return null;
      const next = { ...current, ...patch, id: current.id };
      await writeJson(file, next);
      return next;
    },

    async deleteDocument(id) {
      const dirs = await ready();
      await Promise.all([
        fs.rm(path.join(dirs.documents, `${id}.json`), { force: true }),
        fs.rm(path.join(dirs.documents, `${id}.txt`), { force: true }),
        fs.rm(path.join(dirs.index, `${id}.json`), { force: true }),
      ]);
    },

    async saveChunks(documentId, title, chunks, vectors) {
      const dirs = await ready();
      const index: ChunkIndex = {
        documentId,
        title,
        chunks,
        vectors: vectors && vectors.length === chunks.length ? vectors : null,
      };
      await writeJson(path.join(dirs.index, `${documentId}.json`), index);
    },

    async searchChunks(query, limit) {
      const dirs = await ready();
      const files = await fs.readdir(dirs.index).catch(() => [] as string[]);
      const indexes = await Promise.all(
        files.filter((name) => name.endsWith(".json")).map((name) => readJson<ChunkIndex>(path.join(dirs.index, name))),
      );

      const hits: ChunkHit[] = [];
      for (const index of indexes) {
        if (!index) continue;
        index.chunks.forEach((chunk, position) => {
          const vector = index.vectors?.[position];
          const score = query.vector && vector ? cosine(query.vector, vector) : keywordScore(query.text, chunk);
          if (score > 0) hits.push({ documentId: index.documentId, title: index.title, text: chunk, score });
        });
      }

      return hits.sort((a, b) => b.score - a.score).slice(0, limit);
    },

    async listThreads(): Promise<ThreadSummary[]> {
      const dirs = await ready();
      const files = await fs.readdir(dirs.threads).catch(() => [] as string[]);
      const threads = await Promise.all(
        files.filter((name) => name.endsWith(".json")).map((name) => readJson<StudioThread>(path.join(dirs.threads, name))),
      );
      return threads
        .filter((thread): thread is StudioThread => Boolean(thread))
        .map((thread) => ({
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updatedAt,
          messages: thread.messages.length,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async readThread(id) {
      const dirs = await ready();
      return readJson<StudioThread>(path.join(dirs.threads, `${id}.json`));
    },

    async saveThread(thread) {
      const dirs = await ready();
      await writeJson(path.join(dirs.threads, `${thread.id}.json`), thread);
    },

    async deleteThread(id) {
      const dirs = await ready();
      await fs.rm(path.join(dirs.threads, `${id}.json`), { force: true });
    },

    async saveArtifact(id, markdown) {
      const dirs = await ready();
      await fs.writeFile(path.join(dirs.artifacts, `${id}.md`), markdown, "utf8");
    },

    async readArtifact(id) {
      const dirs = await ready();
      return fs.readFile(path.join(dirs.artifacts, `${id}.md`), "utf8").catch(() => null);
    },

    /* ---------- Проект ----------
       Опись дерева лежит одним файлом, содержимое каждого файла — рядом
       отдельным .md. Так дерево читается одним чтением, а не обходом каталога
       на каждый рендер, и при этом отчёт остаётся обычным файлом на диске,
       который можно открыть мимо приложения. */

    async listNodes() {
      const dirs = await ready();
      return (await readJson<StudioNode[]>(path.join(dirs.project, "index.json"))) ?? [];
    },

    async saveNode(node, content) {
      const dirs = await ready();
      const file = path.join(dirs.project, "index.json");
      const nodes = (await readJson<StudioNode[]>(file)) ?? [];

      if (content !== null && node.kind === "file") {
        await fs.writeFile(path.join(dirs.project, `${node.id}.md`), content, "utf8");
      }
      const saved: StudioNode = {
        ...node,
        chars: node.kind === "folder" ? null : content !== null ? content.length : node.chars,
      };
      const at = nodes.findIndex((item) => item.id === node.id);
      if (at >= 0) nodes[at] = saved;
      else nodes.push(saved);
      await writeJson(file, nodes);
      return saved;
    },

    async readNodeContent(id) {
      const dirs = await ready();
      return fs.readFile(path.join(dirs.project, `${id}.md`), "utf8").catch(() => null);
    },

    async deleteNode(id) {
      const dirs = await ready();
      const file = path.join(dirs.project, "index.json");
      const nodes = (await readJson<StudioNode[]>(file)) ?? [];
      await writeJson(file, nodes.filter((item) => item.id !== id));
      await fs.rm(path.join(dirs.project, `${id}.md`), { force: true });
    },
  };
}
