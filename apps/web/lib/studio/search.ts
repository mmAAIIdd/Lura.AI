import { API_ROOT, allModels, geminiKey } from "@/lib/studio/config";
import { decodeEntities } from "@/lib/studio/text";

/**
 * Поиск в интернете для агента.
 *
 * Провайдеры, по убыванию качества:
 *
 * 1. googleSearch у Gemini — ссылки, которые модель уже сверила с запросом.
 *    Ключа сверх основного не требует, но у grounding отдельная квота: на
 *    бесплатном тарифе он отвечает 429 на любой модели, и включается он
 *    ровно тогда, когда у проекта появляется биллинг.
 * 2. Brave Search API — если задан BRAVE_API_KEY. Бесплатный тариф покрывает
 *    рабочее пространство одной команды с запасом.
 * 3. Tavily — если задан TAVILY_API_KEY. Отдаёт сразу выжимку по странице.
 * 4. DuckDuckGo — без ключа, крайний случай. Отвечает 202 с пустой страницей,
 *    когда решит, что запросов многовато; это блокировка, а не «не нашлось».
 *
 * Bing здесь сознательно нет. Его RSS и HTML отдаются без ключа, но выдача
 * приходит по первому слову запроса: на «отзывы диспетчеров о системе заявок»
 * возвращались сайты-отзовики вообще ни о чём. Источник, который выглядит
 * рабочим и подсовывает мусор, хуже отсутствующего.
 *
 * Провайдер определяется один раз за жизнь процесса и потом идёт первым.
 */

export type SearchResult = { title: string; url: string; snippet: string };
export type SearchProvider = "gemini" | "brave" | "tavily" | "duckduckgo";

let resolvedProvider: SearchProvider | null = null;

export function currentProvider(): SearchProvider | null {
  return resolvedProvider;
}

function configured(): SearchProvider | "auto" {
  const value = process.env.STUDIO_SEARCH?.trim();
  if (value === "gemini" || value === "brave" || value === "tavily" || value === "duckduckgo") return value;
  return "auto";
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/* ---------- Brave ---------- */

async function brave(query: string, limit: number): Promise<SearchResult[]> {
  const key = process.env.BRAVE_API_KEY?.trim();
  if (!key) throw new Error("нет BRAVE_API_KEY");

  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
    {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new Error(`Brave ответил ${response.status}`);

  const data = (await response.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  const results = (data.web?.results ?? [])
    .filter((item) => item.url)
    .slice(0, limit)
    .map((item) => ({
      title: stripTags(item.title ?? item.url!).slice(0, 200),
      url: item.url!,
      snippet: stripTags(item.description ?? "").slice(0, 400),
    }));

  if (!results.length) throw new Error("Brave вернул пустую выдачу");
  return results;
}

/* ---------- Tavily ---------- */

async function tavily(query: string, limit: number): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) throw new Error("нет TAVILY_API_KEY");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: limit, search_depth: "basic" }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Tavily ответил ${response.status}`);

  const data = (await response.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  const results = (data.results ?? [])
    .filter((item) => item.url)
    .slice(0, limit)
    .map((item) => ({
      title: (item.title ?? item.url!).slice(0, 200),
      url: item.url!,
      snippet: (item.content ?? "").slice(0, 400),
    }));

  if (!results.length) throw new Error("Tavily вернул пустую выдачу");
  return results;
}

/* ---------- Gemini: googleSearch ---------- */

async function geminiGrounding(query: string, limit: number): Promise<SearchResult[]> {
  const key = geminiKey();
  if (!key) throw new Error("нет ключа Gemini");

  const failures: string[] = [];

  /* Перебор по цепочке моделей: у основной может не быть квоты, и запрос к
     grounding через неё падает раньше, чем начнётся поиск. */
  for (const model of allModels()) {
    const response = await fetch(`${API_ROOT}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `Найди источники по запросу: ${query}` }] }],
        tools: [{ googleSearch: {} }],
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);

    if (!response?.ok) {
      failures.push(`${model}: ${response ? response.status : "нет ответа"}`);
      continue;
    }

    const data = (await response.json()) as {
      candidates?: {
        groundingMetadata?: { groundingChunks?: { web?: { uri: string; title?: string } }[] };
        content?: { parts?: { text?: string }[] };
      }[];
    };

    const candidate = data.candidates?.[0];
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    if (!chunks.length) {
      failures.push(`${model}: без источников`);
      continue;
    }

    const summary = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join(" ").slice(0, 400);
    return chunks
      .filter((chunk) => chunk.web?.uri)
      .slice(0, limit)
      .map((chunk) => ({ title: chunk.web?.title || chunk.web!.uri, url: chunk.web!.uri, snippet: summary }));
  }

  throw new Error(`googleSearch недоступен (${failures.join(", ")})`);
}

/* ---------- DuckDuckGo ---------- */

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

/**
 * Тег ищется целиком, класс и href достаются из атрибутов по отдельности: у
 * обычной выдачи класс стоит перед href в двойных кавычках, у облегчённой —
 * наоборот и в одинарных. Регэксп с фиксированным порядком работал ровно на
 * одной из двух и молча возвращал ноль результатов на другой.
 */
function collectTagged(html: string, tag: string, className: string): { attrs: string; body: string }[] {
  const matcher = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g");
  const wanted = new RegExp(`class=["'][^"']*\\b${className}\\b`);
  const found: { attrs: string; body: string }[] = [];
  for (const match of html.matchAll(matcher)) {
    if (wanted.test(match[1])) found.push({ attrs: match[1], body: match[2] });
  }
  return found;
}

function parseDuckResults(html: string, limit: number): SearchResult[] {
  const anchors = [...collectTagged(html, "a", "result__a"), ...collectTagged(html, "a", "result-link")];
  const snippets = [...collectTagged(html, "a", "result__snippet"), ...collectTagged(html, "td", "result-snippet")];

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

/**
 * Попытки идут по разным адресам и разными методами.
 *
 * 202 с пустой страницей — это придержанный запрос, а не отсутствие
 * результатов, и приходит он на конкретную комбинацию «адрес + метод».
 * Форма (POST) и облегчённая версия придерживаются отдельно от обычной
 * выдачи, поэтому перебор из четырёх вариантов с нарастающей паузой
 * вытаскивает ответ там, где один повтор того же запроса упирался в отказ.
 */
const DUCK_ATTEMPTS = [
  { host: "https://html.duckduckgo.com/html/", method: "POST", wait: 0 },
  { host: "https://lite.duckduckgo.com/lite/", method: "GET", wait: 900 },
  { host: "https://html.duckduckgo.com/html/", method: "GET", wait: 2500 },
  { host: "https://lite.duckduckgo.com/lite/", method: "POST", wait: 5000 },
] as const;

async function duckduckgo(query: string, limit: number): Promise<SearchResult[]> {
  let problem = "DuckDuckGo вернул пустую выдачу";

  for (const attempt of DUCK_ATTEMPTS) {
    if (attempt.wait) await sleep(attempt.wait);

    const post = attempt.method === "POST";
    const response = await fetch(post ? attempt.host : `${attempt.host}?q=${encodeURIComponent(query)}`, {
      method: attempt.method,
      headers: {
        "User-Agent": UA,
        "Accept-Language": "ru,en;q=0.8",
        ...(post ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: post ? `q=${encodeURIComponent(query)}` : undefined,
      signal: AbortSignal.timeout(20000),
    }).catch(() => null);

    if (!response) {
      problem = "DuckDuckGo не ответил";
      continue;
    }
    if (response.status === 202) {
      problem = "DuckDuckGo придержал запросы с этого адреса";
      continue;
    }
    if (!response.ok) {
      problem = `DuckDuckGo ответил ${response.status}`;
      continue;
    }

    const results = parseDuckResults(await response.text(), limit);
    if (results.length) return results;
  }

  throw new Error(problem);
}

const PROVIDERS: Record<SearchProvider, (query: string, limit: number) => Promise<SearchResult[]>> = {
  gemini: geminiGrounding,
  brave,
  tavily,
  duckduckgo,
};

const ORDER: SearchProvider[] = ["brave", "tavily", "gemini", "duckduckgo"];

export class SearchUnavailableError extends Error {}

/* Когда не отвечает ни один провайдер, следующие вызовы в ближайшие минуты
   падают сразу. Иначе каждый web_search внутри одного разбора тратит десяток
   секунд на обход тех же самых отказов. */
let unavailableUntil = 0;
const UNAVAILABLE_COOLDOWN_MS = 5 * 60 * 1000;
let lastFailure = "";

export async function searchWeb(
  query: string,
  limit = 6,
): Promise<{ provider: SearchProvider; results: SearchResult[] }> {
  const preference = configured();

  /* Явно выбранный провайдер не подменяется молча: иначе непонятно, почему в
     отчёте источники не оттуда, откуда просили. */
  if (preference !== "auto") {
    return { provider: preference, results: await PROVIDERS[preference](query, limit) };
  }

  if (Date.now() < unavailableUntil) throw new SearchUnavailableError(lastFailure);

  const order = resolvedProvider
    ? [resolvedProvider, ...ORDER.filter((name) => name !== resolvedProvider)]
    : ORDER;

  const failures: string[] = [];
  for (const provider of order) {
    try {
      const results = await PROVIDERS[provider](query, limit);
      resolvedProvider = provider;
      return { provider, results };
    } catch (error) {
      failures.push(`${provider} — ${error instanceof Error ? error.message : "ошибка"}`);
    }
  }

  /* Наружу — что искать не получилось и что с этим делать; какие именно
     провайдеры отказали, остаётся в логе сервера. Названия поставщиков в
     ответе агента выглядят как утечка внутренностей, а команде они ничего
     не объясняют. */
  console.warn(`[studio] поиск недоступен: ${failures.join("; ")}`);
  lastFailure =
    "Поиск в интернете сейчас недоступен: ни один источник выдачи не ответил. " +
    "Дайте прямую ссылку — её Lura откроет и прочитает, — или задайте ключ поиска (BRAVE_API_KEY или TAVILY_API_KEY) на сервере.";
  unavailableUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
  throw new SearchUnavailableError(lastFailure);
}
