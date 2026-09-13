import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { studioDir } from "@/lib/studio/config";
import type { OwnerId } from "@/lib/studio/owner";
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
 *
 * Владелец разделяется каталогом: .lura-studio/<owner>/documents и так далее.
 * Это самая честная изоляция из возможных здесь — чужие файлы не отфильтрованы,
 * их просто нет по пути, который знает экземпляр хранилища. Забытый фильтр не
 * может открыть чужой документ, потому что фильтра нет вовсе.
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
 * Удаление файла, переживающее чужой захват.
 *
 * Рабочая папка лежит внутри OneDrive, и во время синхронизации OneDrive — а с
 * ним и защитник Windows — держит на файле открытый дескриптор. unlink в этот
 * момент падает с EPERM или UNKNOWN, а тот же самый вызов мгновением позже
 * проходит: это промах по времени, а не ошибка логики. В логе одно удаление
 * документа ответило 500, 500 и только с третьего раза 200.
 *
 * force здесь не помогает — он гасит ENOENT и только его. А вот
 * maxRetries/retryDelay помогают: fs.rm повторяет попытку именно на EBUSY,
 * EMFILE, ENFILE, ENOTEMPTY и EPERM с линейной паузой. UNKNOWN в этот список не
 * входит, а в логе он был, поэтому на него здесь отдельный повтор — одного
 * maxRetries не хватает.
 *
 * Паузы нарочно короткие: на другом конце человек ждёт свой клик, и худший
 * случай должен укладываться примерно в секунду, а не в десять. Удачное
 * удаление не ждёт нисколько — первая же попытка возвращает как раньше.
 */
async function removeFile(file: string): Promise<void> {
  const options = { force: true, maxRetries: 5, retryDelay: 30 };
  try {
    await fs.rm(file, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "UNKNOWN") throw error;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.rm(file, options);
  }
}

/**
 * Проверка базовой папки на пригодность.
 *
 * Одного mkdir мало: он проходит и там, где потом падает запись, а на
 * бессерверной площадке каталог приложения вообще не существует и ошибка
 * приходит как ENOENT, а не как EROFS. Поэтому после создания папки сюда же
 * пишется и удаляется пробный файл — это единственный надёжный ответ на
 * вопрос «можно ли здесь хранить состояние».
 */
async function usable(base: string): Promise<string | null> {
  try {
    await fs.mkdir(base, { recursive: true });
    const probe = path.join(base, ".writable");
    await fs.writeFile(probe, "ok", "utf8");
    await removeFile(probe);
    return base;
  } catch {
    return null;
  }
}

/* Куда в итоге легло состояние и пережило ли оно перезапуск. */
let ephemeral = false;
let pendingRoot: Promise<string> | null = null;

export function filesAreEphemeral(): boolean {
  return ephemeral;
}

/**
 * Базовая папка, разрешаемая один раз за жизнь процесса.
 *
 * Если настроенная папка недоступна для записи, состояние уходит во временную
 * папку системы. Это не полноценная замена: на бессерверной площадке она своя
 * у каждого экземпляра и очищается между запусками — зато чат и разборы
 * работают вместо отказа на первом же запросе. Постоянное хранилище
 * включается переменной STUDIO_DATABASE_URL.
 *
 * Здесь решается только «где вообще можно писать». Папки конкретного владельца
 * заводит ownerPaths: пригодность площадки одна на процесс, а владельцев за
 * его жизнь бывает много.
 */
async function resolveRoot(): Promise<string> {
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
      `[studio] ${wanted} недоступна для записи, состояние уходит во временную папку ${temporary}. ` +
        "Задайте STUDIO_DATABASE_URL, чтобы оно сохранялось.",
    );
    return temporary;
  }

  throw new StorageUnavailableError(
    "Рабочему пространству негде хранить состояние: ни рабочая папка, ни временная папка системы " +
      "не доступны для записи. Задайте STUDIO_DATABASE_URL — состояние уйдёт в Postgres.",
  );
}

function rootReady(): Promise<string> {
  if (!pendingRoot) {
    /* Неудачную попытку не кэшируем: причина может быть временной, и
       навсегда запомненный отказ пережил бы саму проблему. */
    pendingRoot = resolveRoot().catch((error) => {
      pendingRoot = null;
      throw error;
    });
  }
  return pendingRoot;
}

/* Папки владельцев: по одному mkdir на владельца за процесс, а не на запрос. */
const owners = new Map<string, Promise<Paths>>();
let legacyWarned = false;

/**
 * Подсказка про данные, лежащие в корне со времён общего пространства.
 *
 * Переносить их самим нельзя: процесс в этот момент уже обслуживает запросы, и
 * Move-Item под работающей записью теряет файл молча. Поэтому — одна строка в
 * лог с готовой командой, и решение за человеком.
 */
async function warnAboutLegacyLayout(base: string): Promise<void> {
  if (legacyWarned) return;
  const legacy = await fs.stat(path.join(base, "documents")).catch(() => null);
  if (!legacy?.isDirectory()) return;
  legacyWarned = true;
  console.warn(
    [
      `[studio] В ${base} лежат данные старой раскладки, до разделения по владельцам.`,
      "Приложение их не переносит — перенесите вручную:",
      "  mkdir .lura-studio\\local",
      "  Move-Item .lura-studio\\documents,.lura-studio\\index,.lura-studio\\threads," +
        ".lura-studio\\artifacts,.lura-studio\\project .lura-studio\\local\\",
    ].join("\n"),
  );
}

async function prepareOwner(owner: OwnerId): Promise<Paths> {
  const dirs = paths(path.join(await rootReady(), owner));
  /* mkdir возвращает путь, только если что-то действительно создал. Это и есть
     признак первого запуска владельца — и единственный момент, когда про старую
     раскладку уместно сказать. */
  const created = await fs.mkdir(dirs.root, { recursive: true });
  await Promise.all(
    [dirs.documents, dirs.index, dirs.threads, dirs.artifacts, dirs.project].map((dir) =>
      fs.mkdir(dir, { recursive: true }),
    ),
  );
  if (created !== undefined) await warnAboutLegacyLayout(path.dirname(dirs.root));
  return dirs;
}

/** Папки владельца, готовые к записи. Как и корень — по одному разу за процесс. */
function ownerPaths(owner: OwnerId): Promise<Paths> {
  const known = owners.get(owner);
  if (known) return known;
  const pending = prepareOwner(owner).catch((error) => {
    owners.delete(owner);
    throw error;
  });
  owners.set(owner, pending);
  return pending;
}

/**
 * Идентификатор как часть имени файла.
 *
 * path.join разворачивает «..», поэтому идентификатор со слэшем или точками
 * перестаёт быть именем файла и становится путём. Каталог владельца — граница
 * ровно до тех пор, пока id не умеет из него выйти; без этой проверки
 * разделение по папкам не изоляция, а её видимость.
 *
 * Набор символов взят с запасом под то, что выдаёт newId(): короткий срез
 * randomUUID(). Ни точки, ни слэша, ни обратного слэша в нём нет — выйти вверх
 * такому идентификатору нечем.
 *
 * Значение отвергается, а не чинится. path.basename("../../чужой") молча
 * вернул бы "чужой" и выполнил бы операцию не над тем, что прислали, — по той
 * же причине asOwnerId не приводит регистр: тихо исправленный чужой
 * идентификатор опаснее отказа.
 */
const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Непригодный id на чтении и удалении — то же самое, что несуществующий.
 *
 * Отдельный статус или отдельный текст сам по себе сообщал бы, что такой id
 * бывает; маршруты уже отвечают на чужое «не найдено», и проверка формы не
 * должна заводить второй ответ.
 *
 * Экспортируется ради теста. Правило это ловит обход каталога, а проверять
 * такое правило можно только по нему самому: тест, переписавший регулярное
 * выражение у себя, проверяет свою копию и молчит, когда расходится исходная.
 */
export function isSafeId(id: string): boolean {
  return ID_SHAPE.test(id);
}

/**
 * То же правило на записи, где id приходит не снаружи, а из newId() или из уже
 * прочитанной записи. Здесь непригодное значение — сломанный инвариант, а не
 * запрос к несуществующему, и молчать о нём нечестно.
 */
function safeId(id: string): string {
  if (!ID_SHAPE.test(id)) throw new Error("Недопустимый идентификатор.");
  return id;
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

export function createFileStore(owner: OwnerId): StudioStore {
  return {
    get label() {
      return ephemeral ? "временные файлы" : "файлы";
    },

    async listDocuments() {
      const dirs = await ownerPaths(owner);
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
      if (!isSafeId(id)) return "";
      const dirs = await ownerPaths(owner);
      return fs.readFile(path.join(dirs.documents, `${id}.txt`), "utf8").catch(() => "");
    },

    async saveDocument(draft: DocumentDraft, text) {
      const dirs = await ownerPaths(owner);
      const document: StudioDocument = {
        id: safeId(draft.id ?? newId()),
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
      if (!isSafeId(id)) return null;
      const dirs = await ownerPaths(owner);
      const file = path.join(dirs.documents, `${id}.json`);
      const current = await readJson<StudioDocument>(file);
      if (!current) return null;
      const next = { ...current, ...patch, id: current.id };
      await writeJson(file, next);
      return next;
    },

    async deleteDocument(id) {
      if (!isSafeId(id)) return;
      const dirs = await ownerPaths(owner);
      await Promise.all([
        removeFile(path.join(dirs.documents, `${id}.json`)),
        removeFile(path.join(dirs.documents, `${id}.txt`)),
        removeFile(path.join(dirs.index, `${id}.json`)),
      ]);
    },

    async saveChunks(documentId, title, chunks, vectors) {
      const dirs = await ownerPaths(owner);
      const index: ChunkIndex = {
        documentId,
        title,
        chunks,
        vectors: vectors && vectors.length === chunks.length ? vectors : null,
      };
      await writeJson(path.join(dirs.index, `${safeId(documentId)}.json`), index);
    },

    async searchChunks(query, limit) {
      const dirs = await ownerPaths(owner);
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
      const dirs = await ownerPaths(owner);
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
          /* У старых сообщений режима нет — они считаются отчётами, как и показывались. */
          reports: thread.messages.filter((message) => message.role === "agent" && message.mode !== "chat").length,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async readThread(id) {
      if (!isSafeId(id)) return null;
      const dirs = await ownerPaths(owner);
      return readJson<StudioThread>(path.join(dirs.threads, `${id}.json`));
    },

    async saveThread(thread) {
      const dirs = await ownerPaths(owner);
      await writeJson(path.join(dirs.threads, `${safeId(thread.id)}.json`), thread);
    },

    async deleteThread(id) {
      if (!isSafeId(id)) return;
      const dirs = await ownerPaths(owner);
      await removeFile(path.join(dirs.threads, `${id}.json`));
    },

    async saveArtifact(id, markdown) {
      const dirs = await ownerPaths(owner);
      await fs.writeFile(path.join(dirs.artifacts, `${safeId(id)}.md`), markdown, "utf8");
    },

    async readArtifact(id) {
      if (!isSafeId(id)) return null;
      const dirs = await ownerPaths(owner);
      return fs.readFile(path.join(dirs.artifacts, `${id}.md`), "utf8").catch(() => null);
    },

    /* ---------- Проект ----------
       Опись дерева лежит одним файлом, содержимое каждого файла — рядом
       отдельным .md. Так дерево читается одним чтением, а не обходом каталога
       на каждый рендер, и при этом отчёт остаётся обычным файлом на диске,
       который можно открыть мимо приложения. */

    async listNodes() {
      const dirs = await ownerPaths(owner);
      return (await readJson<StudioNode[]>(path.join(dirs.project, "index.json"))) ?? [];
    },

    async saveNode(node, content) {
      /* Проверка до записи описи, а не только перед .md: узел с непригодным id
         попал бы в index.json и вернулся бы оттуда следующим запросом. */
      const id = safeId(node.id);
      const dirs = await ownerPaths(owner);
      const file = path.join(dirs.project, "index.json");
      const nodes = (await readJson<StudioNode[]>(file)) ?? [];

      if (content !== null && node.kind === "file") {
        await fs.writeFile(path.join(dirs.project, `${id}.md`), content, "utf8");
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
      if (!isSafeId(id)) return null;
      const dirs = await ownerPaths(owner);
      return fs.readFile(path.join(dirs.project, `${id}.md`), "utf8").catch(() => null);
    },

    async deleteNode(id) {
      if (!isSafeId(id)) return;
      const dirs = await ownerPaths(owner);
      const file = path.join(dirs.project, "index.json");
      const nodes = (await readJson<StudioNode[]>(file)) ?? [];
      await writeJson(file, nodes.filter((item) => item.id !== id));
      await removeFile(path.join(dirs.project, `${id}.md`));
    },
  };
}
