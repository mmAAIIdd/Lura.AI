import { NextResponse } from "next/server";

import { MAX_FILE_CHARS, checkName, nameTaken } from "@/lib/studio/project";
import { StorageUnavailableError, listNodes, newId, saveNode, type StudioNode } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Дерево проекта: список узлов и создание новых.
 *
 * Дерево отдаётся плоским списком — собирает его интерфейс. Сервер не знает,
 * какие ветки раскрыты и в каком порядке пользователь хочет их видеть, и
 * навязывать ему вложенную структуру означало бы решать это за него.
 */

export async function GET() {
  try {
    return NextResponse.json({ nodes: await listNodes() });
  } catch (error) {
    if (error instanceof StorageUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { parentId?: string | null; kind?: string; name?: string; content?: string }
    | null;
  if (!body) return NextResponse.json({ error: "Тело запроса не разобралось." }, { status: 400 });

  const kind = body.kind === "folder" ? "folder" : "file";
  const checked = checkName(body.name);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const content = kind === "folder" ? null : String(body.content ?? "");
  if (content !== null && content.length > MAX_FILE_CHARS) {
    return NextResponse.json({ error: `Файл длиннее ${MAX_FILE_CHARS.toLocaleString("ru-RU")} символов.` }, { status: 413 });
  }

  try {
    const nodes = await listNodes();
    const parentId = body.parentId ?? null;
    if (parentId !== null) {
      const parent = nodes.find((node) => node.id === parentId);
      if (!parent) return NextResponse.json({ error: "Папка не найдена." }, { status: 404 });
      if (parent.kind !== "folder") return NextResponse.json({ error: "Вложить можно только в папку." }, { status: 400 });
    }

    /* Одинаковые имена в одной папке различить нельзя ни глазом, ни ссылкой. */
    if (nameTaken(nodes, parentId, checked.name)) return NextResponse.json({ error: "Здесь уже есть элемент с таким именем." }, { status: 409 });

    const now = new Date().toISOString();
    const node: StudioNode = {
      id: newId(),
      parentId,
      kind,
      name: checked.name,
      createdAt: now,
      updatedAt: now,
      chars: content === null ? null : content.length,
    };
    const saved = await saveNode(node, content);
    return NextResponse.json({ node: saved }, { status: 201 });
  } catch (error) {
    if (error instanceof StorageUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
