import { requireStudioOwner } from "@/lib/studio/auth";
import { studioStore } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Готовый отчёт файлом — то, что можно отправить команде, не пересказывая. */
export async function GET(_request: Request, { params }: Params) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;
  const store = studioStore(owner.ownerId);

  const { id } = await params;
  /* Чужой отчёт отвечает тем же «не найден», что и несуществующий: разница в
     тексте или в статусе сама по себе сообщала бы, что такой id существует. */
  const markdown = await store.readArtifact(id);
  if (!markdown) return new Response("Отчёт не найден.", { status: 404 });

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="lura-${id}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
