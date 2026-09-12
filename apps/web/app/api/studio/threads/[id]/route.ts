import { NextResponse } from "next/server";

import { requireStudioOwner } from "@/lib/studio/auth";
import { deleteThread, listThreads, readThread, saveThread } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await params;
  const thread = await readThread(id);
  if (!thread) return NextResponse.json({ error: "Разбор не найден." }, { status: 404 });
  return NextResponse.json({ thread });
}

/** Переименование: разбор ищут по названию, и первый вопрос им не всегда годится. */
export async function PATCH(request: Request, { params }: Params) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  const title = body?.title?.trim();
  if (!title) return NextResponse.json({ error: "Пустое название." }, { status: 400 });

  const thread = await readThread(id);
  if (!thread) return NextResponse.json({ error: "Разбор не найден." }, { status: 404 });

  thread.title = title.slice(0, 120);
  await saveThread(thread);
  return NextResponse.json({ thread });
}

export async function DELETE(_request: Request, { params }: Params) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await params;
  await deleteThread(id);
  return NextResponse.json({ threads: await listThreads() });
}
