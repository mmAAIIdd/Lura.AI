import { readArtifact } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Готовый отчёт файлом — то, что можно отправить команде, не пересказывая. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const markdown = await readArtifact(id);
  if (!markdown) return new Response("Отчёт не найден.", { status: 404 });

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="lura-${id}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
