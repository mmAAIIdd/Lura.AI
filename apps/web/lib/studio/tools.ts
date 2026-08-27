import { LIMITS } from "@/lib/studio/config";
import { fetchPublic } from "@/lib/studio/net";
import type { FunctionDeclaration } from "@/lib/studio/gemini";
import { searchDocuments } from "@/lib/studio/rag";
import { SearchUnavailableError, searchWeb } from "@/lib/studio/search";
import { htmlToText, looksTextual, truncate } from "@/lib/studio/text";
import type { ToolTrace } from "@/lib/studio/store";

/**
 * Инструменты агента: поиск в интернете, чтение страницы и поиск по
 * загруженным документам. Больше ничего — каждый новый инструмент это ещё
 * одна развилка, на которой модель может уйти не туда.
 */

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "web_search",
    description:
      "Найти источники в интернете: отзывы, обзоры, публикации, страницы конкурентов, релиз-ноуты. " +
      "Возвращает список ссылок с заголовками и краткими описаниями. " +
      "Это только выдача — чтобы прочитать содержимое, вызови fetch_url.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос на языке, на котором вероятнее всего написан источник." },
        limit: { type: "integer", description: "Сколько результатов вернуть, 1–10. По умолчанию 6." },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Скачать страницу по ссылке и вернуть её текст. Используй для каждого источника, на который будешь ссылаться: " +
      "выдача поиска показывает только заголовок, а вывод должен опираться на содержимое.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Полный адрес страницы, начиная с http:// или https://" },
      },
      required: ["url"],
    },
  },
  {
    name: "search_documents",
    description:
      "Поиск по документам, которые загрузила команда: информация о бизнесе, README, выгрузки отзывов, релизы, метрики. " +
      "Вызывай перед выводами о продукте — это единственный источник внутренних данных.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Что нужно найти во внутренних документах." },
        limit: { type: "integer", description: "Сколько фрагментов вернуть, 1–10. По умолчанию 6." },
      },
      required: ["query"],
    },
  },
];

export type ToolOutcome = { response: Record<string, unknown>; trace: ToolTrace };

async function runWebSearch(args: Record<string, unknown>): Promise<ToolOutcome> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("Пустой запрос.");
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 10);

  let provider: string;
  let results: Awaited<ReturnType<typeof searchWeb>>["results"];
  try {
    ({ provider, results } = await searchWeb(query, limit));
  } catch (error) {
    /* Неработающий поиск и пустая выдача — разные вещи. Если их смешать,
       агент напишет «в интернете ничего нет», хотя он туда не сходил. */
    if (error instanceof SearchUnavailableError) {
      return {
        response: {
          error: error.message,
          instruction:
            "Поиск не выполнен. Не выдумывай ссылки и не пиши «по данным интернета». " +
            "Работай на внутренних документах и прямо укажи в отчёте, что внешние источники собрать не удалось.",
        },
        trace: { name: "web_search", argument: query, summary: "поиск недоступен", ok: false },
      };
    }
    throw error;
  }
  return {
    response: {
      provider,
      results: results.map((result) => ({ title: result.title, url: result.url, snippet: result.snippet })),
      note: results.length
        ? "Это только выдача. Открой нужные ссылки через fetch_url, прежде чем на них ссылаться."
        : "Поиск ничего не вернул. Переформулируй запрос или признай, что данных нет.",
    },
    trace: {
      name: "web_search",
      argument: query,
      summary: results.length ? `${results.length} источников (${provider})` : "ничего не найдено",
      ok: results.length > 0,
      sources: results.map((result) => ({ title: result.title, url: result.url })),
    },
  };
}

async function runFetchUrl(args: Record<string, unknown>): Promise<ToolOutcome> {
  const raw = String(args.url ?? "").trim();

  /* Каждый переход проверяется заново: публичная страница может увести
     редиректом на внутренний адрес. */
  const { response, url } = await fetchPublic(raw, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LuraStudio/1.0; +https://lura.app)",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      "Accept-Language": "ru,en;q=0.8",
    },
  });

  if (!response.ok) throw new Error(`Страница ответила ${response.status}.`);

  const type = response.headers.get("content-type") || "";
  const body = (await response.text()).slice(0, 900_000);

  let title: string | null = null;
  let text = body;
  if (type.includes("html") || /^\s*<(!doctype|html)/i.test(body)) {
    const parsed = htmlToText(body);
    title = parsed.title;
    text = parsed.text;
  } else if (!looksTextual(body.slice(0, 2000))) {
    throw new Error("По ссылке не текстовый документ.");
  }

  if (!text.trim()) throw new Error("Страница открылась, но текста в ней нет.");

  return {
    response: { url: url.href, title, content: truncate(text, LIMITS.fetchedPageChars) },
    trace: {
      name: "fetch_url",
      argument: url.href,
      summary: `${title ? `${title} — ` : ""}${text.length.toLocaleString("ru-RU")} символов`,
      ok: true,
      sources: [{ title: title || url.hostname, url: url.href }],
    },
  };
}

async function runSearchDocuments(args: Record<string, unknown>): Promise<ToolOutcome> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("Пустой запрос.");
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 10);

  const excerpts = await searchDocuments(query, limit);
  return {
    response: {
      excerpts: excerpts.map((excerpt) => ({ document: excerpt.title, text: excerpt.text })),
      note: excerpts.length
        ? "Это фрагменты внутренних документов. Ссылайся на них по названию документа."
        : "Во внутренних документах ничего не нашлось. Скажи об этом прямо, а не достраивай по памяти.",
    },
    trace: {
      name: "search_documents",
      argument: query,
      summary: excerpts.length ? `${excerpts.length} фрагментов` : "ничего не найдено",
      ok: excerpts.length > 0,
    },
  };
}

const RUNNERS: Record<string, (args: Record<string, unknown>) => Promise<ToolOutcome>> = {
  web_search: runWebSearch,
  fetch_url: runFetchUrl,
  search_documents: runSearchDocuments,
};

/**
 * Ошибка инструмента возвращается модели как результат, а не роняет запрос:
 * агент должен уметь пойти другим путём, а не оборвать анализ на первой
 * недоступной странице.
 */
export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const runner = RUNNERS[name];
  if (!runner) {
    return {
      response: { error: `Инструмента ${name} не существует.` },
      trace: { name, argument: "", summary: "нет такого инструмента", ok: false },
    };
  }

  try {
    return await runner(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка.";
    return {
      response: { error: message },
      trace: {
        name,
        argument: String(args.query ?? args.url ?? ""),
        summary: message.slice(0, 160),
        ok: false,
      },
    };
  }
}
