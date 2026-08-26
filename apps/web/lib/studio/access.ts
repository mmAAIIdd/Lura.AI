/**
 * Открыт ли /studio без входа.
 *
 * Вынесено из config.ts отдельным файлом без импортов Node: этот код читает
 * middleware, который исполняется в edge-рантайме, и `node:path` соседнего
 * модуля туда не проходит.
 *
 * На машине разработчика рабочее пространство открывается сразу — иначе
 * локальная проверка упирается в круг по OAuth. В продакшене оно остаётся за
 * авторизацией, пока это не разрешат явно.
 */
export function studioIsOpen(): boolean {
  const flag = process.env.STUDIO_PUBLIC?.trim();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}
