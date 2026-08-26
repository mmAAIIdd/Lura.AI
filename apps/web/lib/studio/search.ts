import { API_ROOT, geminiKey, modelChain } from "@/lib/studio/config";

/**
 * Поиск в интернете для агента.
 *
 * Два источника. Первый — встроенный googleSearch у Gemini: он даёт ссылки,
 * которые модель уже сверила с запросом. На бесплатном тарифе этот инструмент
 * отвечает 429, поэтому есть второй — HTML-выдача DuckDuckGo, которой не
 * нужен ключ. Провайдер определяется один раз за жизнь процесса: пробовать
 * недоступный grounding на каждый запрос — это лишняя секунда на ровном месте.
 */

export type SearchResult = { title: string; url: string; snippet: string };
export type SearchProvider = "gemini" | "duckduckgo";

let resolvedProvider: SearchProvider | null = null;

export function currentProvider(): SearchProvider | null {
  return resolvedProvider;
}

function configured(): SearchProvider | "auto" {
  const value = process.env.STUDIO_SEARCH?.trim();
  if (value === "gemini" || value === "duckduckgo") return value;
  return "auto";
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

function decodeDuckLink(href: string): string | null {
  const value = href.startsWith("//") ? `https:${href}` : href;
  try {
    const url = new URL(value);
    const target = url.searchParams.get("uddg");
    const decoded = target ? decodeURIComponent(target) : url.href;
    return decoded.startsWith("http") ? decoded : null;
  } catch {
    return null;
  }
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Разбор выдачи DuckDuckGo.
 *
 * Тег ищется целиком, а класс и href достаются из его атрибутов по
 * отдельности: у обычной выдачи класс стоит перед href и в двойных кавычках,
 * у облегчённой — наоборот и в одинарных. Регэксп с фиксированным порядком
 * работал ровно на одной из двух и молча возвращал ноль результатов на другой.
 */
function collectTagged(html: string, tag: string, className: string): { attrs: string; body: string }[] {
  const matcher = new RegExp(`<${tag}\b([^>]*)>([\s\S]*?)<\/${tag}>`, "g");
  const wanted = new RegExp(`class=["'][^"']*\b${className}\b`);
  const found: { attrs: string; body: string }[] = [];
  for (const match of html.matchAll(matcher)) {
    if (wanted.test(match[1])) found.push({ attrs: match[1], body: match[2] });
  }
  return found;
}

function parseResults(html: string, limit: number): SearchResult[] {
  const anchors = [
    ...collectTagged(html, "a", "result__a"),
    ...collectTagged(html, "a", "result-link"),
  ];
  const snippets = [
    ...collectTagged(html, "a", "result__snippet"),
    ...collectTagged(html, "td", "result-snippet"),
  ];

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  anchors.forEach((anchor, position) => {
    if (results.length >= limit) return;
    const href = /href=["']([^"']+)["']/.exec(anchor.attrs)?.[1];
    const url = href ? decodeDuckLink(href) : null;
    if (!url || seen.has(url)) return;
    seen.add(url);
    results.push({
      title: stripTags(anchor.body).slice(0, 200) || url,
      url,
      snippet: snippets[position] ? stripTags(snippets[position].body).slice(0, 400) : "",
    });
  });

  return results;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function duckduckgo(query: string, limit: number): Promise<SearchResult[]> {
  /* Три подхода: обычная выдача, она же после паузы, затем облегчённая.
     DuckDuckGo на частые запросы отвечает 202 с пустой страницей — это мягкая
     блокировка, а не «ничего не найдено», и разница здесь принципиальная:
     во втором случае агент напишет «данных нет» и будет неправ. */
  const attempts = [
    { url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, wait: 0 },
    { url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, wait: 1500 },
    { url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, wait: 800 },
  ];

  let lastProblem = "выдача пустая";

  for (const attempt of attempts) {
    if (attempt.wait) await sleep(attempt.wait);

    const response = await fetch(attempt.url, {
      headers: { "User-Agent": UA, "Accept-Language": "ru,en;q=0.8" },
      signal: AbortSignal.timeout(20000),
    }).catch(() => null);

    if (!response) {
      lastProblem = "DuckDuckGo не ответил";
      continue;
    }
    if (response.status === 202) {
      lastProblem = "DuckDuckGo придержал запрос";
      continue;
    }
    if (!response.ok) {
      lastProblem = `DuckDuckGo ответил ${response.status}`;
      continue;
    }

    const results = parseResults(await response.text(), limit);
    if (results.length) return results;
  }

  if (lastProblem !== "выдача пустая") throw new Error(lastProblem);
  return [];
}

async function geminiGrounding(query: string, limit: number): Promise<SearchResult[]> {
  const key = geminiKey();
  if (!key) throw new Error("нет ключа");

  const response = await fetch(`${API_ROOT}/models/${modelChain()[0]}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `Найди источники по запросу: ${query}` }] }],
      tools: [{ googleSearch: {} }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`grounding ответил ${response.status}`);

  const data = (await response.json()) as {
    candidates?: {
      groundingMetadata?: { groundingChunks?: { web?: { uri: string; title?: string } }[] };
      content?: { parts?: { text?: string }[] };
    }[];
  };

  const candidate = data.candidates?.[0];
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  if (!chunks.length) throw new Error("grounding не вернул источников");

  const summary = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join(" ").slice(0, 400);
  return chunks
    .filter((chunk) => chunk.web?.uri)
    .slice(0, limit)
    .map((chunk) => ({ title: chunk.web?.title || chunk.web!.uri, url: chunk.web!.uri, snippet: summary }));
}

export async function searchWeb(query: string, limit = 6): Promise<{ provider: SearchProvider; results: SearchResult[] }> {
  const preference = configured();

  if (preference === "duckduckgo" || resolvedProvider === "duckduckgo") {
    resolvedProvider = "duckduckgo";
    return { provider: "duckduckgo", results: await duckduckgo(query, limit) };
  }

  if (preference === "gemini" || resolvedProvider === "gemini" || resolvedProvider === null) {
    try {
      const results = await geminiGrounding(query, limit);
      resolvedProvider = "gemini";
      return { provider: "gemini", results };
    } catch (error) {
      /* Явно выбранный провайдер не подменяется молча — иначе непонятно,
         почему в отчёте другие источники. */
      if (preference === "gemini") throw error;
      resolvedProvider = "duckduckgo";
    }
  }

  return { provider: "duckduckgo", results: await duckduckgo(query, limit) };
}
