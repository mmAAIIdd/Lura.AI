import { NextResponse } from "next/server";

import { deleteThread, listThreads, readThread } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const thread = await readThread(id);
  if (!thread) return NextResponse.json({ error: "Разбор не найден." }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  await deleteThread(id);
  return NextResponse.json({ threads: await listThreads() });
}
