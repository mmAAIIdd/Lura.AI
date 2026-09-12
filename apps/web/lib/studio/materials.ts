/**
 * Что можно загрузить в материалы.
 *
 * Живёт отдельно от config.ts: тот тянет node:path и в браузер не попадает, а
 * форматы и предел нужно показывать прямо у кнопки загрузки — теми же
 * значениями, что проверяет сервер. Обещать на экране формат, который сервер
 * отвергнет, хуже, чем не обещать ничего.
 */

/** Совпадает с LIMITS.uploadBytes: сервер откажет ровно на этой границе. */
export const MATERIAL_MAX_BYTES = 4 * 1024 * 1024;
export const MATERIAL_MAX_LABEL = "4 МБ";

/** Список для поля выбора файлов и тот же список словами — для подписи под ним. */
export const MATERIAL_ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.xml,.html,.htm";
export const MATERIAL_FORMATS = "txt, md, csv, tsv, json, log, yaml, xml, html";
