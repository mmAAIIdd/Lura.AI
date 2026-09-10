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
