import { NextResponse } from "next/server";

import { requireStudioOwner } from "@/lib/studio/auth";
import { deleteDocument, listDocuments, readDocumentText, setBusinessDocument } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Содержимое документа: посмотреть, что агент на самом деле читает. */
export async function GET(_request: Request, { params }: Params) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await params;
  const documents = await listDocuments();
  const document = documents.find((item) => item.id === id);
  if (!document) return NextResponse.json({ error: "Документ не найден." }, { status: 404 });

  const text = await readDocumentText(id);
  /* Предпросмотр, а не выгрузка: полный документ может быть на мегабайты. */
  return NextResponse.json({ document, text: text.slice(0, 20000), truncated: text.length > 20000 });
}

/** Назначить документ основным — тем, что всегда лежит в контексте агента. */
export async function PATCH(request: Request, { params }: Params) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { kind?: string } | null;
  if (body?.kind !== "business") return NextResponse.json({ error: "Поддерживается только kind: business." }, { status: 400 });

  await setBusinessDocument(id);
  return NextResponse.json({ documents: await listDocuments() });
}

export async function DELETE(_request: Request, { params }: Params) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  const { id } = await params;
  await deleteDocument(id);
  return NextResponse.json({ documents: await listDocuments() });
}
