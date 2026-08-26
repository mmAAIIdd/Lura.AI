import { NextResponse } from "next/server";

import { deleteDocument, listDocuments, setBusinessDocument } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Назначить документ основным — тем, что всегда лежит в контексте агента. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { kind?: string } | null;
  if (body?.kind !== "business") return NextResponse.json({ error: "Поддерживается только kind: business." }, { status: 400 });

  await setBusinessDocument(id);
  return NextResponse.json({ documents: await listDocuments() });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  await deleteDocument(id);
  return NextResponse.json({ documents: await listDocuments() });
}
