/**
 * Куда пускать посетителя после входа.
 *
 * Раньше эти две функции жили в конце lib/api.ts — клиента FastAPI, который
 * обслуживал прежнее рабочее пространство. Пространство переехало в /studio и
 * работает на своём хранилище, клиент удалён, а разбор адреса возврата нужен
 * по-прежнему: он единственное, что стоит между `?next=` из адресной строки и
 * открытым редиректом на чужой сайт.
 */

const HOME = "/studio";

/** Управляющие символы проверяются по кодам, а не регэкспом с escape-последовательностями. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function getSafeNextPath(nextPath: string | null | undefined): string {
  if (!nextPath || !nextPath.startsWith("/")) return HOME;

  try {
    /* Многократное декодирование: `%252f%252f` разворачивается в `//` только
       со второго прохода, и без цикла такая ссылка проходит проверку. */
    let decoded = nextPath;
    for (let depth = 0; depth < 3; depth += 1) {
      const nextDecoded = decodeURIComponent(decoded);
      if (nextDecoded === decoded) break;
      decoded = nextDecoded;
    }

    if (decoded.startsWith("//") || decoded.includes("\\") || hasControlCharacter(decoded)) {
      return HOME;
    }

    const baseOrigin = "https://lura.internal";
    const resolved = new URL(nextPath, baseOrigin);
    if (resolved.origin !== baseOrigin) return HOME;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return HOME;
  }
}

export function getLoginPath(nextPath: string | null | undefined): string {
  const safeNextPath = getSafeNextPath(nextPath);
  return safeNextPath === HOME ? "/login" : `/login?next=${encodeURIComponent(safeNextPath)}`;
}
