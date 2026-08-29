import { LIMITS, MAX_TOOL_ROUNDS } from "@/lib/studio/config";
import { GeminiError, streamTurn, type Content, type Part } from "@/lib/studio/gemini";
import { buildSystemInstruction, threadTitleFrom } from "@/lib/studio/prompt";
import { searchDocuments } from "@/lib/studio/rag";
import {
  businessDocument,
  emptyThread,
  listDocuments,
  newId,
  readDocumentText,
  readThread,
  saveArtifact,
  saveThread,
  type StudioMessage,
  type StudioThread,
  type ToolTrace,
} from "@/lib/studio/store";
import { TOOL_DECLARATIONS, runTool } from "@/lib/studio/tools";

/**
 * Цикл агента.
 *
 * Модель ходит по пайплайну сама, но каждый её вызов инструмента исполняется
 * здесь и возвращается ей результатом. Наверх при этом уходят события — что
 * агент сейчас делает — чтобы окно вывода показывало работу, а не спиннер.
 */

export type Attachment = { name: string; mimeType: string; data: string; text?: string };

/* Общий бюджет на разбор. За ним агент дописывает ответ на собранном, а не
   продолжает искать: незавершённый разбор бесполезен, каким бы полным он ни
   обещал стать. */
const RUN_DEADLINE_MS = Number(process.env.STUDIO_DEADLINE_MS || 210000);

/** Ход разбора виден в консоли сервера: без этого «долго» не отличить от «висит». */
function log(message: string): void {
  if (process.env.NODE_ENV !== "production") console.log(`[studio] ${message}`);
}

export type AgentEvent =
  | { type: "model"; model: string }
  | { type: "tool"; phase: "start" | "done"; trace: ToolTrace }
  | { type: "text"; text: string }
  | { type: "done"; thread: StudioThread; message: StudioMessage }
  | { type: "error"; message: string };

type RunInput = {
  threadId?: string;
  prompt: string;
  attachments?: Attachment[];
  signal?: AbortSignal;
};

/** История в модель уходит текстом: вызовы инструментов прошлых ходов ей не нужны. */
function historyContents(thread: StudioThread): Content[] {
  return thread.messages
    .slice(-LIMITS.historyMessages)
    .filter((message) => message.text.trim())
    .map((message) => ({
      role: message.role === "user" ? ("user" as const) : ("model" as const),
      parts: [{ text: message.text }],
    }));
}

function userParts(prompt: string, attachments: Attachment[]): Part[] {
  const parts: Part[] = [];
  for (const attachment of attachments) {
    if (attachment.text) {
      parts.push({ text: `Вложенный файл «${attachment.name}»:\n\n${attachment.text}` });
    } else {
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
    }
  }
  parts.push({ text: prompt });
  return parts;
}

export async function* runAgent(input: RunInput): AsyncGenerator<AgentEvent> {
  const attachments = input.attachments ?? [];
  const thread = (input.threadId ? await readThread(input.threadId) : null) ?? emptyThread(threadTitleFrom(input.prompt));

  const [documents, business] = await Promise.all([listDocuments(), businessDocument()]);
  const businessContext = business ? { document: business, text: await readDocumentText(business.id) } : null;

  /* Фрагменты под текущий вопрос подставляются заранее: без этого первый ход
     модели уходит на search_documents с тем же самым запросом. */
  const excerpts = documents.length ? await searchDocuments(input.prompt) : [];
  const systemInstruction = buildSystemInstruction({
    business: businessContext,
    documents,
    excerpts,
  });

  const contents: Content[] = [
    ...historyContents(thread),
    { role: "user", parts: userParts(input.prompt, attachments) },
  ];

  const userMessage: StudioMessage = {
    id: newId(),
    role: "user",
    text: input.prompt,
    createdAt: new Date().toISOString(),
    attachments: attachments.map((attachment) => ({ name: attachment.name, mime: attachment.mimeType })),
  };

  const traces: ToolTrace[] = [];
  let answer = "";
  let model = "";

  const startedAt = Date.now();
  const deadline = startedAt + RUN_DEADLINE_MS;

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      /* Инструменты снимаются на последнем круге или по дедлайну: без этого
         модель может ходить по ссылкам, пока не оборвётся соединение, и
         пользователь не увидит ни строчки ответа. */
      const lastRound = round === MAX_TOOL_ROUNDS || Date.now() > deadline;
      if (lastRound && round > 0) {
        contents.push({
          role: "user",
          parts: [{ text: "Время на сбор данных вышло. Дай финальный ответ по контракту на том, что уже собрано, и честно отметь, чего не хватило." }],
        });
      }
      log(`ход ${round + 1}${lastRound ? " (финальный, без инструментов)" : ""}, ${Math.round((Date.now() - startedAt) / 1000)}с`);
      let pending: { parts: Part[]; calls: { id?: string; name: string; args: Record<string, unknown> }[] } | null = null;

      for await (const event of streamTurn({
        systemInstruction,
        contents,
        tools: lastRound ? undefined : TOOL_DECLARATIONS,
        signal: input.signal,
        model: model || undefined,
      })) {
        if (event.type === "model") {
          if (!model) {
            model = event.model;
            yield { type: "model", model };
          }
        } else if (event.type === "text") {
          answer += event.text;
          yield { type: "text", text: event.text };
        } else if (event.type === "calls") {
          pending = { parts: event.parts, calls: event.calls };
        }
      }

      if (!pending) {
        log(`ответ получен, ${answer.length} символов за ${Math.round((Date.now() - startedAt) / 1000)}с`);
        break;
      }

      /* Ответ модели возвращается в историю ровно тем, чем пришёл: в Gemini 3
         у частей есть подпись рассуждения, и без неё следующий ход с
         результатами инструментов не принимается. */
      contents.push({ role: "model", parts: pending.parts });

      const responses: Part[] = [];
      for (const call of pending.calls) {
        yield {
          type: "tool",
          phase: "start",
          trace: { name: call.name, argument: String(call.args.query ?? call.args.url ?? ""), summary: "", ok: true },
        };
        const toolStarted = Date.now();
        const outcome = await runTool(call.name, call.args);
        log(`  ${call.name} ${Math.round((Date.now() - toolStarted) / 1000)}с — ${outcome.trace.summary}`);
        traces.push(outcome.trace);
        yield { type: "tool", phase: "done", trace: outcome.trace };
        responses.push({ functionResponse: { id: call.id, name: call.name, response: outcome.response } });
      }

      contents.push({ role: "user", parts: responses });
    }
  } catch (error) {
    const message =
      error instanceof GeminiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Неизвестная ошибка при обращении к модели.";
    yield { type: "error", message };
    return;
  }

  const artifactId = newId();
  const agentMessage: StudioMessage = {
    id: newId(),
    role: "agent",
    text: answer.trim(),
    createdAt: new Date().toISOString(),
    model,
    tools: traces,
    artifactId,
  };

  thread.messages.push(userMessage, agentMessage);
  thread.updatedAt = new Date().toISOString();
  if (thread.messages.length <= 2) thread.title = threadTitleFrom(input.prompt);

  await saveArtifact(artifactId, buildArtifact(input, agentMessage));
  await saveThread(thread);

  yield { type: "done", thread, message: agentMessage };
}

/** Отчёт, который можно скачать файлом: тот же текст плюс шапка и источники. */
function buildArtifact(input: RunInput, message: StudioMessage): string {
  const header = [
    `# Отчёт — Lura`,
    "",
    `**Запрос:** ${input.prompt}`,
    `**Дата:** ${new Date(message.createdAt).toLocaleString("ru-RU")}`,
    `**Модель:** ${message.model || "—"}`,
    "",
    "---",
    "",
  ].join("\n");

  const used = (message.tools ?? []).flatMap((trace) => trace.sources ?? []);
  const unique = [...new Map(used.map((source) => [source.url, source])).values()];
  const sources = unique.length
    ? ["", "---", "", "## Инструменты и источники", "", ...unique.map((source) => `- [${source.title}](${source.url})`)].join("\n")
    : "";

  return `${header}${message.text}${sources}\n`;
}
