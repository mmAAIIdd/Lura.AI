import { runAgent, type Attachment } from "@/lib/studio/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* Разбор с поиском и чтением страниц идёт минуты, а не секунды. */
export const maxDuration = 300;

/**
 * Запуск агента с потоком событий.
 *
 * SSE, а не «дождись и покажи»: пользователь должен видеть, что агент сейчас
 * ищет и что открывает. Иначе двухминутный разбор выглядит как зависший экран.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { threadId?: string; prompt?: string; attachments?: Attachment[] }
    | null;

  const prompt = body?.prompt?.trim();
  if (!prompt) {
    return Response.json({ error: "Пустой запрос." }, { status: 400 });
  }

  const attachments = (body?.attachments ?? []).slice(0, 6);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const event of runAgent({ threadId: body?.threadId, prompt, attachments, signal: request.signal })) {
          send(event);
        }
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Разбор прервался." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      /* Иначе прокси перед приложением копит поток в буфере и события
         приходят одним куском в самом конце. */
      "X-Accel-Buffering": "no",
    },
  });
}
