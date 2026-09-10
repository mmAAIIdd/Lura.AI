import { checkName, nameTaken } from "@/lib/studio/project";
import { listNodes, newId, saveNode, type StudioNode } from "@/lib/studio/store";

/**
 * Запись готового разбора в проект.
 *
 * Раньше отчёт жил только последним ответом в переписке: чтобы вернуться к
 * позавчерашнему разбору, приходилось листать треды. Теперь каждый разбор
 * ложится файлом в папку проекта, и с ним можно обращаться как с файлом —
 * открыть, поправить, переложить, удалить.
 *
 * Ошибка записи не роняет разбор: отчёт уже показан пользователю, и терять
 * его из-за недоступного хранилища было бы хуже, чем остаться без файла.
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
