import dns from "node:dns/promises";
import net from "node:net";

/**
 * Сетевой доступ наружу для инструментов агента.
 *
 * Адрес сюда приходит либо от модели, либо из формы, то есть снаружи. Без
 * проверки достаточно строки «открой http://169.254.169.254/…», чтобы
 * приложение сходило во внутреннюю сеть и принесло оттуда ответ.
 *
 * Проверять только первый адрес мало: публичная страница может ответить
 * редиректом на приватный адрес, и `redirect: "follow"` пройдёт по нему молча.
 * Поэтому переходы разбираются вручную и каждый следующий адрес проверяется
 * заново.
 */

const MAX_REDIRECTS = 5;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80")
  );
}

/** Разбирает адрес и убеждается, что он ведёт в публичную сеть. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Адрес не разобрался как ссылка.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Поддерживаются только http и https.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);

  if (!addresses.length) throw new Error("Домен не разрешается в адрес.");
  for (const address of addresses) {
    if (isPrivateAddress(address)) throw new Error("Внутренние адреса недоступны.");
  }
  return url;
}

type FetchOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
};

/**
 * Скачивание с проверкой каждого перехода.
 *
 * Возвращает и ответ, и адрес, на котором цепочка закончилась: ссылаться в
 * отчёте надо на страницу, которую действительно прочитали, а не на ту, с
 * которой начали.
 */
export async function fetchPublic(
  raw: string | URL,
  options: FetchOptions = {},
): Promise<{ response: Response; url: URL }> {
  const timeout = options.timeoutMs ?? 25000;
  let current = await assertPublicUrl(String(raw));

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      headers: options.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });

    if (!REDIRECT_CODES.has(response.status)) return { response, url: current };

    const location = response.headers.get("location");
    if (!location) return { response, url: current };

    current = await assertPublicUrl(new URL(location, current).href);
  }

  throw new Error("Слишком много перенаправлений.");
}
