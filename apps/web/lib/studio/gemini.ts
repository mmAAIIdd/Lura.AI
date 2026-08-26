import { API_ROOT, EMBED_MODEL, geminiKey, modelChain } from "@/lib/studio/config";

/**
 * Клиент Gemini: генерация с инструментами и эмбеддинги.
 *
 * Без SDK — один fetch и разбор SSE. Пакет @google/genai сюда не тянется:
 * приложение живёт без рантайм-зависимостей, а нужны ровно два эндпоинта.
 */

export type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { id?: string; name: string; args: Record<string, unknown> } }
  | { functionResponse: { id?: string; name: string; response: Record<string, unknown> } }
  | Record<string, unknown>;

export type Content = { role: "user" | "model"; parts: Part[] };

export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export class GeminiError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
  }
}

/** 429 и 404 значат «эта модель недоступна тебе», а не «сервис сломан». */
function modelUnavailable(status: number): boolean {
  return status === 429 || status === 404 || status === 403;
}

/** 500-е у Gemini обычно означают «модель перегружена прямо сейчас». */
function transient(status: number): boolean {
  return status >= 500;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* Предел на один ход модели. Без него зависшее соединение висит вечно: у
   fetch нет таймаута по умолчанию, и разбор замирал без единой строчки в
   логе — не отличить от «модель долго думает». */
const TURN_TIMEOUT_MS = Number(process.env.STUDIO_TURN_TIMEOUT_MS || 120000);

function turnSignal(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TURN_TIMEOUT_MS);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

function keyOrThrow(): string {
  const key = geminiKey();
  if (!key) {
    throw new GeminiError(
      "Не задан GEMINI_API_KEY. Добавьте ключ в apps/web/.env.local и перезапустите рабочее пространство.",
      0,
      false,
    );
  }
  return key;
}

async function describeFailure(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body);
    return String(parsed?.error?.message || body).slice(0, 400);
  } catch {
    return body.slice(0, 400) || `HTTP ${response.status}`;
  }
}

/* ---------- Эмбеддинги ---------- */

/**
 * Векторы для фрагментов документа.
 *
 * Возвращает null, если модель эмбеддингов недоступна: тогда поиск по
 * документам работает по ключевым словам. Отказ от индексации целиком был бы
 * хуже — рабочее пространство осталось бы без поиска вообще.
 */
export async function embedTexts(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][] | null> {
  if (!texts.length) return [];
  const key = geminiKey();
  if (!key) return null;

  const vectors: number[][] = [];
  /* Батчи по 50: длинный документ иначе упирается в предел размера запроса. */
  for (let offset = 0; offset < texts.length; offset += 50) {
    const slice = texts.slice(offset, offset + 50);
    const response = await fetch(`${API_ROOT}/models/${EMBED_MODEL}:batchEmbedContents?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: slice.map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: text.slice(0, 8000) }] },
          taskType,
          outputDimensionality: 768,
        })),
      }),
    }).catch(() => null);

    if (!response || !response.ok) return null;
    const data = (await response.json().catch(() => null)) as { embeddings?: { values: number[] }[] } | null;
    if (!data?.embeddings) return null;
    for (const embedding of data.embeddings) vectors.push(embedding.values);
  }

  return vectors;
}

/* ---------- Генерация ---------- */

export type StreamEvent =
  | { type: "model"; model: string }
  | { type: "text"; text: string }
  | { type: "calls"; parts: Part[]; calls: { id?: string; name: string; args: Record<string, unknown> }[] }
  | { type: "end"; parts: Part[]; finishReason: string | null };

type GenerateOptions = {
  systemInstruction: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
  signal?: AbortSignal;
  /** Модель, выбранная на предыдущем шаге, чтобы не искать её заново. */
  model?: string;
};

function payload(options: GenerateOptions) {
  return {
    systemInstruction: { parts: [{ text: options.systemInstruction }] },
    contents: options.contents,
    ...(options.tools?.length ? { tools: [{ functionDeclarations: options.tools }] } : {}),
    generationConfig: { temperature: 0.4, topP: 0.95, maxOutputTokens: 8192 },
  };
}

/**
 * Один ход модели. Текст отдаётся кусками по мере поступления, вызовы
 * инструментов копятся и выдаются целиком в конце хода.
 *
 * Части ответа возвращаются в сыром виде и в таком же виде уходят обратно в
 * историю: в Gemini 3 у частей есть thoughtSignature, и без него следующий
 * ход с результатом инструмента модель не принимает.
 */
export async function* streamTurn(options: GenerateOptions): AsyncGenerator<StreamEvent> {
  const key = keyOrThrow();
  /* Выбранная на первом ходу модель идёт первой, но не единственной: квота
     заканчивается и посреди разбора, и упереться в неё на пятом ходу — значит
     потерять всю уже проделанную работу. */
  const chain = modelChain();
  const candidates = options.model
    ? [options.model, ...chain.filter((name) => name !== options.model)]
    : chain;
  const failures: string[] = [];

  for (const model of candidates) {
    let response: Response | null = null;

    /* Перегрузка модели проходит сама за секунды, поэтому три попытки с
       паузой — прежде чем считать модель недоступной и уходить на следующую.
       Без этого один 503 посреди разбора отменял пятиминутную работу. */
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(`${API_ROOT}/models/${model}:streamGenerateContent?alt=sse&key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(options)),
        signal: turnSignal(options.signal),
      });
      if (response.ok || !transient(response.status)) break;
      await sleep(1200 * (attempt + 1));
    }

    if (!response || !response.ok || !response.body) {
      const reason = response ? await describeFailure(response) : "нет ответа";
      const status = response?.status ?? 0;
      failures.push(`${model}: ${reason}`);
      /* Недоступна именно эта модель — пробуем следующую в цепочке. */
      if ((modelUnavailable(status) || transient(status)) && model !== candidates[candidates.length - 1]) continue;
      throw new GeminiError(reason, status, transient(status));
    }

    yield { type: "model", model };

    const parts: Part[] = [];
    const calls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
    let finishReason: string | null = null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n");
      while (boundary !== -1) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        boundary = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;

        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;

        let chunk: {
          candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
        };
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }

        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        for (const part of candidate?.content?.parts ?? []) {
          parts.push(part);
          const call = (part as { functionCall?: { id?: string; name: string; args: Record<string, unknown> } }).functionCall;
          if (call) {
            calls.push({ id: call.id, name: call.name, args: call.args ?? {} });
          } else {
            const text = (part as { text?: string }).text;
            if (text) yield { type: "text", text };
          }
        }
      }
    }

    if (calls.length) {
      yield { type: "calls", parts, calls };
    } else {
      yield { type: "end", parts, finishReason };
    }
    return;
  }

  throw new GeminiError(
    `Ни одна из моделей не ответила. ${failures.join(" | ")}`,
    429,
    false,
  );
}
