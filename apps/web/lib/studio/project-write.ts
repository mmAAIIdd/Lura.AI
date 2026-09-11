import { MAX_FILE_CHARS, checkName, findByPath, findChild, nameTaken, nodePath, splitPath } from "@/lib/studio/project";
import { listNodes, newId, readNodeContent, saveNode, type StudioNode } from "@/lib/studio/store";

/**
 * Запись в проект: готовые разборы и файлы, которые агент ведёт сам.
 *
 * Раньше отчёт жил только последним ответом в переписке: чтобы вернуться к
 * позавчерашнему разбору, приходилось листать треды. Теперь каждый разбор
 * ложится файлом в папку проекта, а агент по просьбе пользователя заводит
 * папки, пишет и дописывает файлы — теми же узлами, что видны в проводнике.
 *
 * Ошибка записи разбора не роняет разбор: отчёт уже показан пользователю, и
 * терять его из-за недоступного хранилища было бы хуже, чем остаться без файла.
 */

const FOLDER = "Отчёты";

/** Имя файла из предмета разбора. Заголовок приходит из запроса пользователя. */
function fileName(title: string, taken: (name: string) => boolean): string {
  const date = new Date().toISOString().slice(0, 10);
  const base = title.replace(/[\\/]/g, " ").trim().slice(0, 70) || "Разбор";
  const first = `${date} — ${base}`;
  if (!taken(first)) return first;
  /* Два разбора одного предмета в один день — обычное дело, поэтому к имени
     добавляется номер, а не время: секунды в имени файла никто не читает. */
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${first} (${index})`;
    if (!taken(candidate)) return candidate;
  }
  return `${first} (${newId()})`;
}

export async function saveReportToProject(title: string, markdown: string): Promise<StudioNode | null> {
  try {
    const nodes = await listNodes();

    let folder = nodes.find((node) => node.kind === "folder" && node.parentId === null && node.name === FOLDER);
    if (!folder) {
      const now = new Date().toISOString();
      folder = await saveNode(
        { id: newId(), parentId: null, kind: "folder", name: FOLDER, createdAt: now, updatedAt: now, chars: null },
        null,
      );
    }

    const checked = checkName(fileName(title, (name) => nameTaken(nodes, folder!.id, name)));
    if ("error" in checked) return null;

    const now = new Date().toISOString();
    return await saveNode(
      {
        id: newId(),
        parentId: folder.id,
        kind: "file",
        name: checked.name,
        createdAt: now,
        updatedAt: now,
        chars: markdown.length,
      },
      markdown,
    );
  } catch {
    return null;
  }
}

/* ---------- Файлы, которые ведёт агент ---------- */

type Failure = { error: string };

/**
 * Цепочка папок по сегментам: недостающие создаются, как mkdir -p.
 *
 * Список узлов пополняется на месте: следующий сегмент ищется среди только что
 * созданных, а перечитывать хранилище на каждом шаге незачем.
 */
async function ensureFolders(
  nodes: StudioNode[],
  segments: string[],
): Promise<{ parentId: string | null; created: string[] } | Failure> {
  let parentId: string | null = null;
  const created: string[] = [];

  for (const segment of segments) {
    const checked = checkName(segment);
    if ("error" in checked) return { error: `«${segment}»: ${checked.error}` };

    const existing = findChild(nodes, parentId, checked.name);
    if (existing) {
      if (existing.kind !== "folder") return { error: `«${nodePath(nodes, existing)}» — файл, а не папка.` };
      parentId = existing.id;
      continue;
    }

    const now = new Date().toISOString();
    const folder = await saveNode(
      { id: newId(), parentId, kind: "folder", name: checked.name, createdAt: now, updatedAt: now, chars: null },
      null,
    );
    nodes.push(folder);
    created.push(nodePath(nodes, folder));
    parentId = folder.id;
  }

  return { parentId, created };
}

export async function createProjectFolder(rawPath: unknown): Promise<{ path: string; created: string[] } | Failure> {
  const segments = splitPath(rawPath);
  if (!segments.length) return { error: "Не указан путь папки." };

  const nodes = await listNodes();
  const result = await ensureFolders(nodes, segments);
  if ("error" in result) return result;
  return { path: segments.join("/"), created: result.created };
}

export async function writeProjectFile(
  rawPath: unknown,
  text: string,
  mode: "overwrite" | "append",
): Promise<{ node: StudioNode; path: string; existed: boolean } | Failure> {
  const segments = splitPath(rawPath);
  if (!segments.length) return { error: "Не указан путь файла." };

  const nodes = await listNodes();
  const folders = await ensureFolders(nodes, segments.slice(0, -1));
  if ("error" in folders) return folders;

  const checked = checkName(segments[segments.length - 1]);
  if ("error" in checked) return { error: checked.error };

  const existing = findChild(nodes, folders.parentId, checked.name);
  if (existing?.kind === "folder") return { error: `«${nodePath(nodes, existing)}» — папка, в неё нельзя записать текст.` };

  let content = text;
  if (existing && mode === "append") {
    const before = (await readNodeContent(existing.id)) ?? "";
    /* Дописанный кусок начинается с новой строки: склеенные без переноса
       абзацы превращают Markdown в одну строку. */
    content = before && !before.endsWith("\n") ? `${before}\n${text}` : `${before}${text}`;
  }
  if (content.length > MAX_FILE_CHARS) {
    return { error: `Файл вышел бы длиннее ${MAX_FILE_CHARS.toLocaleString("ru-RU")} символов. Разбейте текст на несколько файлов.` };
  }

  const now = new Date().toISOString();
  const node = await saveNode(
    existing
      ? { ...existing, updatedAt: now, chars: content.length }
      : { id: newId(), parentId: folders.parentId, kind: "file", name: checked.name, createdAt: now, updatedAt: now, chars: content.length },
    content,
  );
  if (!existing) nodes.push(node);
  return { node, path: nodePath(nodes, node), existed: Boolean(existing) };
}

export async function readProjectFile(rawPath: unknown): Promise<{ path: string; content: string } | Failure> {
  const segments = splitPath(rawPath);
  if (!segments.length) return { error: "Не указан путь файла." };

  const nodes = await listNodes();
  const node = findByPath(nodes, segments);
  if (!node) return { error: `В проекте нет «${segments.join("/")}». Посмотри структуру через list_project.` };
  if (node.kind === "folder") return { error: `«${nodePath(nodes, node)}» — папка. Её содержимое показывает list_project.` };
  return { path: nodePath(nodes, node), content: (await readNodeContent(node.id)) ?? "" };
}

/** Проект списком путей — так его проще читать модели, чем плоский список со ссылками на родителей. */
export async function listProject(rawFolder: unknown): Promise<{ entries: { path: string; kind: StudioNode["kind"]; chars: number | null }[] } | Failure> {
  const nodes = await listNodes();
  const segments = splitPath(rawFolder);

  let scope = nodes;
  if (segments.length) {
    const folder = findByPath(nodes, segments);
    if (!folder || folder.kind !== "folder") return { error: `Папки «${segments.join("/")}» в проекте нет.` };
    const prefix = `${nodePath(nodes, folder)}/`;
    scope = nodes.filter((node) => nodePath(nodes, node).startsWith(prefix));
  }

  const entries = scope
    .map((node) => ({ path: nodePath(nodes, node), kind: node.kind, chars: node.chars }))
    .sort((a, b) => a.path.localeCompare(b.path, "ru"));
  return { entries };
}
