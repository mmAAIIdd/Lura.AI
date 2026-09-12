import { NextResponse } from "next/server";

import { requireStudioOwner } from "@/lib/studio/auth";
import { MAX_FILE_CHARS, checkName, descendants, nameTaken } from "@/lib/studio/project";
import { StorageUnavailableError, deleteNode, listNodes, readNodeContent, saveNode } from "@/lib/studio/store";
import type { StudioNode } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function withStore<T>(run: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StorageUnavailableError) return fail(error.message, 503);
    throw error;
  }
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await context.params;
  return withStore(async () => {
    const node = (await listNodes()).find((item) => item.id === id);
    if (!node) return fail("Файл не найден.", 404);
    if (node.kind === "folder") return fail("У папки нет содержимого.", 400);
    return NextResponse.json({ node, content: (await readNodeContent(id)) ?? "" });
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { content?: string } | null;
  if (!body || typeof body.content !== "string") return fail("Ожидается поле content.", 400);
  /* Сужение типа не переживает границу замыкания, поэтому текст достаётся до неё. */
  const content = body.content;
  if (content.length > MAX_FILE_CHARS) return fail(`Файл длиннее ${MAX_FILE_CHARS.toLocaleString("ru-RU")} символов.`, 413);

  return withStore(async () => {
    const node = (await listNodes()).find((item) => item.id === id);
    if (!node) return fail("Файл не найден.", 404);
    if (node.kind === "folder") return fail("В папку нельзя записать текст.", 400);
    const saved = await saveNode({ ...node, updatedAt: new Date().toISOString() }, content);
    return NextResponse.json({ node: saved });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { name?: string; parentId?: string | null } | null;
  if (!body) return fail("Тело запроса не разобралось.", 400);

  return withStore(async () => {
    const nodes = await listNodes();
    const node = nodes.find((item) => item.id === id);
    if (!node) return fail("Элемент не найден.", 404);

    let name = node.name;
    if (body.name !== undefined) {
      const checked = checkName(body.name);
      if ("error" in checked) return fail(checked.error, 400);
      name = checked.name;
    }

    let parentId = node.parentId;
    if (body.parentId !== undefined) {
      parentId = body.parentId;
      if (parentId !== null) {
        const parent = nodes.find((item) => item.id === parentId);
        if (!parent) return fail("Папка назначения не найдена.", 404);
        if (parent.kind !== "folder") return fail("Вложить можно только в папку.", 400);
        /* Папка, перенесённая внутрь себя, исчезает из дерева: у ветки не
           остаётся пути до корня, и она перестаёт где-либо показываться. */
        if (parentId === id || descendants(nodes, id).some((item) => item.id === parentId)) {
          return fail("Папку нельзя перенести внутрь себя.", 400);
        }
      }
    }

    if (nameTaken(nodes, parentId, name, id)) return fail("Здесь уже есть элемент с таким именем.", 409);

    const saved = await saveNode({ ...node, name, parentId, updatedAt: new Date().toISOString() }, null);
    return NextResponse.json({ node: saved });
  });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await context.params;
  return withStore(async () => {
    const nodes = await listNodes();
    const node = nodes.find((item) => item.id === id);
    if (!node) return fail("Элемент не найден.", 404);

    /* Потомки удаляются от листьев к корню: у Postgres на них внешний ключ, и
       обратный порядок упёрся бы в ссылку на ещё живого родителя. */
    const doomed = [...descendants(nodes, id).reverse(), node];
    for (const item of doomed) await deleteNode(item.id);
    return NextResponse.json({ deleted: doomed.length });
  });
}
