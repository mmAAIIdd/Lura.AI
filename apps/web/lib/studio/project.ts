import type { StudioNode } from "@/lib/studio/types";

/**
 * Правила дерева проекта.
 *
 * Живёт отдельно от обработчиков: route-файл в Next может экспортировать
 * только сами обработчики, и общая для двух маршрутов проверка имени в нём
 * ломает сборку. Заодно оба правила — про имя и про потомков — оказываются в
 * одном месте, а не разъезжаются по эндпоинтам.
 */

/**
 * Управляющие символы ищутся по кодам, а не классом в регулярном выражении.
 * Класс с диапазоном непечатаемых символов не переживает копирование между
 * файлами: символы исчезают молча, проверка остаётся на вид рабочей.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function checkName(raw: unknown): { name: string } | { error: string } {
  const name = String(raw ?? "").trim();
  if (!name) return { error: "Пустое имя." };
  if (name.length > 120) return { error: "Имя длиннее 120 символов." };
  /* Слеши: имя участвует в пути на диске, и без проверки «../» в названии
     выводит запись за пределы хранилища. Пробелы и дефисы разрешены —
     «Отчёт по релизу 5.2» это нормальное имя файла. */
  if (name.includes("/") || name.includes("\\")) return { error: "В имени нельзя использовать слеши." };
  if (hasControlCharacter(name)) return { error: "В имени есть управляющие символы." };
  if (name === "." || name === "..") return { error: "Недопустимое имя." };
  return { name };
}

/** Все потомки узла, включая вложенные. Нужны удалению и проверке на цикл. */
export function descendants(nodes: StudioNode[], rootId: string): StudioNode[] {
  const out: StudioNode[] = [];
  const queue = [rootId];
  while (queue.length) {
    const parent = queue.shift() as string;
    for (const node of nodes) {
      if (node.parentId !== parent) continue;
      out.push(node);
      queue.push(node.id);
    }
  }
  return out;
}

/** Занято ли имя в той же папке. Регистр не различается: две «Сводки» неразличимы глазом. */
export function nameTaken(nodes: StudioNode[], parentId: string | null, name: string, exceptId?: string): boolean {
  return nodes.some(
    (node) =>
      node.id !== exceptId && node.parentId === parentId && node.name.toLowerCase() === name.toLowerCase(),
  );
}

/* Предел на один файл проекта. Файл целиком ходит в браузер и обратно при
   каждом сохранении, а дописывание без предела растит его без конца. */
export const MAX_FILE_CHARS = 400_000;

/** Имя корня в проводнике. Агент видит его в интерфейсе и может начать с него путь. */
export const PROJECT_ROOT = "LURA_PROJECT";

/**
 * Путь из строки: «Отчёты/Релиз 5.2/Сводка».
 *
 * Слеш в имени узла запрещён, поэтому разделитель однозначен. Корень, пустые
 * сегменты и обратные слеши прощаются: модель пишет путь по-разному, и отказ
 * из-за «/Отчёты/» вместо «Отчёты» — не ошибка, которую стоит ей возвращать.
 */
export function splitPath(raw: unknown): string[] {
  const segments = String(raw ?? "")
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments[0] === PROJECT_ROOT ? segments.slice(1) : segments;
}

export function findChild(nodes: StudioNode[], parentId: string | null, name: string): StudioNode | undefined {
  const wanted = name.toLowerCase();
  return nodes.find((node) => node.parentId === parentId && node.name.toLowerCase() === wanted);
}

/** Узел по пути или null, если хоть одного звена нет. */
export function findByPath(nodes: StudioNode[], segments: string[]): StudioNode | null {
  let parentId: string | null = null;
  let found: StudioNode | null = null;
  for (const segment of segments) {
    found = findChild(nodes, parentId, segment) ?? null;
    if (!found) return null;
    parentId = found.id;
  }
  return found;
}

/** Путь узла от корня. Обход ограничен длиной списка: битая ссылка на родителя не зациклит его. */
export function nodePath(nodes: StudioNode[], node: StudioNode): string {
  const names = [node.name];
  let parentId = node.parentId;
  for (let guard = 0; parentId && guard < nodes.length; guard += 1) {
    const parent = nodes.find((item) => item.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join("/");
}
