import { LIMITS } from "@/lib/studio/config";
import { fetchPublic } from "@/lib/studio/net";
import type { FunctionDeclaration } from "@/lib/studio/gemini";
import { searchDocuments } from "@/lib/studio/rag";
import { SearchUnavailableError, searchWeb } from "@/lib/studio/search";
import { analyzeTable, countGroups, parseTable, type GroupInput } from "@/lib/studio/table";
import { htmlToText, looksTextual, truncate } from "@/lib/studio/text";
import { listDocuments, readDocumentText, type StudioDocument, type ToolTrace } from "@/lib/studio/store";
import { createProjectFolder, listProject, readProjectFile, writeProjectFile } from "@/lib/studio/project-write";

/**
 * Инструменты агента: поиск в интернете, чтение страницы, работа с
 * загруженными документами и точный счёт по таблицам.
 *
 * Счётные инструменты появились по итогам замеров: поиск по фрагментам отдаёт
 * модели часть выгрузки, а она приводит числа так, будто посчитала всё. Пока
 * арифметика оставалась за моделью, две трети ошибок отчёта приходились именно
 * на неё, поэтому счёт вынесен в код.
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
  {
    name: "read_document",
    description:
      "Прочитать загруженный документ целиком, а не фрагментами. Обязателен в разборе для каждого документа, " +
      "по которому ты приводишь числа: search_documents отдаёт только куски, и счёт по ним получается неполным. " +
      "Если документ длинный, он выдаётся частями — запрашивай следующую часть, пока не дойдёшь до конца.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Название документа или его узнаваемая часть." },
        part: { type: "integer", description: "Номер части, начиная с 1. По умолчанию 1." },
      },
      required: ["title"],
    },
  },
  {
    name: "analyze_table",
    description:
      "Точная статистика по табличному документу (CSV): сколько строк до и после даты границы, средние по каждому " +
      "числовому столбцу до и после, разброс ряда, распределение категорий и оценок. По каждому показателю " +
      "возвращает вердикт «вырос» / «снизился» / «не изменился». Вызывай для любой выгрузки метрик: числа отсюда " +
      "переносятся в отчёт как есть, считать их самому нельзя.",
    parameters: {
      type: "object",
      properties: {
        document: { type: "string", description: "Название табличного документа или его узнаваемая часть." },
        boundary: { type: "string", description: "Дата границы «до/после» в виде ГГГГ-ММ-ДД." },
        date_column: { type: "string", description: "Столбец с датой, если автоопределение ошиблось." },
      },
      required: ["document"],
    },
  },
  {
    name: "count_groups",
    description:
      "Точный подсчёт упоминаний по темам. Ты сам относишь строки выгрузки к темам и передаёшь списки " +
      "идентификаторов, а инструмент считает: сколько в каждой теме до и после границы, долю и место по величине. " +
      "Обязателен для любой таблицы тем в отчёте. Сообщает, какие строки остались не отнесены ни к одной теме и " +
      "какие идентификаторы в таблице не существуют.",
    parameters: {
      type: "object",
      properties: {
        document: { type: "string", description: "Название документа с выгрузкой." },
        boundary: { type: "string", description: "Дата границы «до/после» в виде ГГГГ-ММ-ДД." },
        boundaries: {
          type: "array",
          description:
            "Дополнительные даты-границы (ГГГГ-ММ-ДД): даты следующих релизов и исправлений. Разбивают период «после» " +
            "на отрезки и показывают, затухла тема после исправления или держится. Передавай их всегда, когда после " +
            "основного релиза выходили другие.",
          items: { type: "string" },
        },
        groups: {
          type: "array",
          description: "Темы и отнесённые к ним строки. Распредели ВСЕ строки выгрузки, для остатка заведи тему «прочее».",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Название темы." },
              ids: { type: "array", description: "Идентификаторы строк этой темы.", items: { type: "string" } },
            },
            required: ["name", "ids"],
          },
        },
        breakdown_column: {
          type: "string",
          description:
            "Столбец разреза: канал, оценка, сегмент. По каждой теме вернётся, как она распределена по значениям " +
            "этого столбца до и после границы. «14 жалоб» и «14 жалоб, из них 11 через поддержку» — разные по " +
            "ценности утверждения; второе показывает, кого именно задело.",
        },
        id_column: { type: "string", description: "Столбец идентификатора, если автоопределение ошиблось." },
        date_column: { type: "string", description: "Столбец с датой, если автоопределение ошиблось." },
      },
      required: ["document", "groups"],
    },
  },
  {
    name: "list_project",
    description:
      "Показать проект пользователя — папки и файлы из проводника слева — списком путей вида «Отчёты/Сводка». " +
      "Вызывай перед записью, чтобы не завести второй файл рядом с уже существующим и попасть в нужную папку.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Путь папки, если нужна только она. По умолчанию весь проект." },
      },
    },
  },
  {
    name: "read_project_file",
    description:
      "Прочитать файл проекта по пути. Длинный файл выдаётся частями — запрашивай следующую, пока не дойдёшь до конца. " +
      "Это файлы проводника (отчёты, заметки пользователя), а не загруженные документы: те читает read_document.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Путь файла от корня проекта, например «Отчёты/2026-09-11 — Релиз 5.2»." },
        part: { type: "integer", description: "Номер части, начиная с 1. По умолчанию 1." },
      },
      required: ["path"],
    },
  },
  {
    name: "create_folder",
    description: "Создать папку в проекте. Недостающие папки по пути создаются тоже; существующая папка не трогается.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Путь папки от корня проекта, например «Релизы/5.2»." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_project_file",
    description:
      "Записать текст в файл проекта. Файла нет — он создаётся вместе с папками по пути. Есть — перезаписывается " +
      "целиком (mode=overwrite) или дописывается в конец (mode=append). Пиши Markdown. Файл сразу виден пользователю " +
      "в проводнике, поэтому в ответе назови путь, куда записал.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Путь файла от корня проекта, например «Заметки/Идеи по онбордингу»." },
        content: { type: "string", description: "Текст для записи." },
        mode: {
          type: "string",
          enum: ["overwrite", "append"],
          description: "overwrite — заменить содержимое, append — дописать в конец. По умолчанию overwrite.",
        },
      },
      required: ["path", "content"],
    },
  },
];

export type ToolOutcome = { response: Record<string, unknown>; trace: ToolTrace };

/** Материалы, которые пользователь разрешил для этого ответа. null — все. */
export type ToolScope = { sources: ReadonlySet<string> | null };

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

async function runSearchDocuments(args: Record<string, unknown>, scope: ToolScope): Promise<ToolOutcome> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("Пустой запрос.");
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 10);

  const excerpts = await searchDocuments(query, limit, scope.sources);
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

/**
 * Документ по названию.
 *
 * Модель называет документ так, как он показан ей в списке, поэтому точного
 * совпадения ждать нельзя. Неоднозначность не разрешаем за неё: два похожих
 * названия — это повод переспросить, а не молча взять первое.
 */
async function resolveDocument(raw: string, scope: ToolScope): Promise<StudioDocument | { error: string }> {
  const query = raw.trim().toLowerCase();
  if (!query) return { error: "Не указано название документа." };

  const all = await listDocuments();
  const chosen = scope.sources;
  const documents = chosen ? all.filter((doc) => chosen.has(doc.id)) : all;
  if (!documents.length) {
    return {
      error: all.length
        ? "Для этого ответа не выбрано ни одного материала: пользователь отмечает их в «Материалах» слева."
        : "В рабочее пространство не загружено ни одного документа.",
    };
  }

  const exact = documents.filter((doc) => doc.title.toLowerCase() === query);
  const partial = exact.length
    ? exact
    : documents.filter((doc) => doc.title.toLowerCase().includes(query) || query.includes(doc.title.toLowerCase()));

  if (!partial.length) {
    return { error: `Документа «${raw}» нет. Загружены: ${documents.map((doc) => `«${doc.title}»`).join(", ")}.` };
  }
  if (partial.length > 1) {
    return { error: `Под «${raw}» подходит несколько документов: ${partial.map((doc) => `«${doc.title}»`).join(", ")}. Уточни название.` };
  }
  return partial[0];
}

async function runReadDocument(args: Record<string, unknown>, scope: ToolScope): Promise<ToolOutcome> {
  const title = String(args.title ?? "");
  const resolved = await resolveDocument(title, scope);
  if ("error" in resolved) {
    return { response: { error: resolved.error }, trace: { name: "read_document", argument: title, summary: resolved.error.slice(0, 160), ok: false } };
  }

  const text = await readDocumentText(resolved.id);
  const size = LIMITS.documentReadChars;
  const parts = Math.max(1, Math.ceil(text.length / size));
  const part = Math.min(Math.max(Number(args.part) || 1, 1), parts);
  const slice = text.slice((part - 1) * size, part * size);

  return {
    response: {
      document: resolved.title,
      part,
      parts,
      characters: text.length,
      content: slice,
      note:
        part < parts
          ? `Это часть ${part} из ${parts}. Прочитай остальные части, прежде чем приводить числа по этому документу.`
          : "Документ прочитан целиком.",
    },
    trace: {
      name: "read_document",
      argument: resolved.title,
      summary: `${resolved.title} — часть ${part} из ${parts}, ${slice.length.toLocaleString("ru-RU")} символов`,
      ok: true,
    },
  };
}

async function runAnalyzeTable(args: Record<string, unknown>, scope: ToolScope): Promise<ToolOutcome> {
  const name = String(args.document ?? "");
  const resolved = await resolveDocument(name, scope);
  if ("error" in resolved) {
    return { response: { error: resolved.error }, trace: { name: "analyze_table", argument: name, summary: resolved.error.slice(0, 160), ok: false } };
  }

  const table = parseTable(await readDocumentText(resolved.id));
  if (!table) {
    const message = `Документ «${resolved.title}» не разбирается как таблица. Инструмент работает с CSV и TSV.`;
    return { response: { error: message }, trace: { name: "analyze_table", argument: resolved.title, summary: "не таблица", ok: false } };
  }

  const analysis = analyzeTable(table, {
    boundary: args.boundary ? String(args.boundary) : null,
    dateColumn: args.date_column ? String(args.date_column) : null,
  });

  const unchanged = analysis.ряды.filter((series) => series.вердикт === "не изменился").length;
  return {
    response: { document: resolved.title, ...analysis },
    trace: {
      name: "analyze_table",
      argument: resolved.title,
      summary: `${analysis.строк_всего} строк, ${analysis.ряды.length} рядов${unchanged ? `, без изменений: ${unchanged}` : ""}`,
      ok: true,
    },
  };
}

async function runCountGroups(args: Record<string, unknown>, scope: ToolScope): Promise<ToolOutcome> {
  const name = String(args.document ?? "");
  const resolved = await resolveDocument(name, scope);
  if ("error" in resolved) {
    return { response: { error: resolved.error }, trace: { name: "count_groups", argument: name, summary: resolved.error.slice(0, 160), ok: false } };
  }

  const raw = Array.isArray(args.groups) ? args.groups : [];
  const groups: GroupInput[] = raw
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => entry && typeof entry.name === "string")
    .map((entry) => ({
      name: String(entry.name),
      ids: Array.isArray(entry.ids) ? entry.ids.map((id) => String(id)) : [],
    }));

  if (!groups.length) {
    const message = "Не передано ни одной темы. Сначала прочитай выгрузку целиком через read_document и распредели строки по темам.";
    return { response: { error: message }, trace: { name: "count_groups", argument: resolved.title, summary: "нет тем", ok: false } };
  }

  const table = parseTable(await readDocumentText(resolved.id));
  if (!table) {
    const message = `Документ «${resolved.title}» не разбирается как таблица.`;
    return { response: { error: message }, trace: { name: "count_groups", argument: resolved.title, summary: "не таблица", ok: false } };
  }

  const result = countGroups(table, {
    groups,
    boundary: args.boundary ? String(args.boundary) : null,
    boundaries: Array.isArray(args.boundaries) ? args.boundaries.map((value) => String(value)) : null,
    breakdownColumn: args.breakdown_column ? String(args.breakdown_column) : null,
    idColumn: args.id_column ? String(args.id_column) : null,
    dateColumn: args.date_column ? String(args.date_column) : null,
  });

  if ("ошибка" in result) {
    return { response: { error: result.ошибка }, trace: { name: "count_groups", argument: resolved.title, summary: result.ошибка.slice(0, 160), ok: false } };
  }

  const missed = result.не_отнесены.количество;
  return {
    response: { document: resolved.title, ...result },
    trace: {
      name: "count_groups",
      argument: resolved.title,
      summary: `${result.темы.length} тем по ${result.строк_всего} строкам${missed ? `, не отнесено ${missed}` : ", распределены все"}`,
      ok: missed === 0,
    },
  };
}

/* ---------- Проект ---------- */

/* Ошибка файловой операции — ожидаемый ответ, а не сбой: модель ошиблась путём
   и должна увидеть, как правильно, а не общий текст исключения. */
function projectFailure(name: string, argument: string, error: string): ToolOutcome {
  return { response: { error }, trace: { name, argument, summary: error.slice(0, 160), ok: false } };
}

async function runListProject(args: Record<string, unknown>): Promise<ToolOutcome> {
  const folder = String(args.folder ?? "");
  const result = await listProject(folder);
  if ("error" in result) return projectFailure("list_project", folder, result.error);

  const files = result.entries.filter((entry) => entry.kind === "file").length;
  return {
    response: {
      entries: result.entries,
      note: result.entries.length ? "Пути указаны от корня проекта." : "Проект пуст.",
    },
    trace: {
      name: "list_project",
      argument: folder,
      summary: `${result.entries.length - files} папок, ${files} файлов`,
      ok: true,
    },
  };
}

async function runReadProjectFile(args: Record<string, unknown>): Promise<ToolOutcome> {
  const path = String(args.path ?? "");
  const result = await readProjectFile(path);
  if ("error" in result) return projectFailure("read_project_file", path, result.error);

  const size = LIMITS.documentReadChars;
  const parts = Math.max(1, Math.ceil(result.content.length / size));
  const part = Math.min(Math.max(Number(args.part) || 1, 1), parts);
  const slice = result.content.slice((part - 1) * size, part * size);

  return {
    response: {
      path: result.path,
      part,
      parts,
      characters: result.content.length,
      content: slice,
      note: part < parts ? `Это часть ${part} из ${parts}.` : "Файл прочитан целиком.",
    },
    trace: {
      name: "read_project_file",
      argument: path,
      summary: `${result.path} — ${result.content.length.toLocaleString("ru-RU")} символов`,
      ok: true,
    },
  };
}

async function runCreateFolder(args: Record<string, unknown>): Promise<ToolOutcome> {
  const path = String(args.path ?? "");
  const result = await createProjectFolder(path);
  if ("error" in result) return projectFailure("create_folder", path, result.error);

  return {
    response: { path: result.path, created: result.created },
    trace: {
      name: "create_folder",
      argument: path,
      summary: result.created.length ? `создано: ${result.created.join(", ")}` : "папка уже была",
      ok: true,
    },
  };
}

async function runWriteProjectFile(args: Record<string, unknown>): Promise<ToolOutcome> {
  const path = String(args.path ?? "");
  const mode = args.mode === "append" ? "append" : "overwrite";
  const result = await writeProjectFile(path, String(args.content ?? ""), mode);
  if ("error" in result) return projectFailure("write_project_file", path, result.error);

  const action = !result.existed ? "создан" : mode === "append" ? "дописан" : "перезаписан";
  return {
    response: { path: result.path, action, characters: result.node.chars },
    trace: {
      name: "write_project_file",
      argument: path,
      summary: `${result.path} — ${action}`,
      ok: true,
    },
  };
}

const RUNNERS: Record<string, (args: Record<string, unknown>, scope: ToolScope) => Promise<ToolOutcome>> = {
  web_search: runWebSearch,
  fetch_url: runFetchUrl,
  search_documents: runSearchDocuments,
  read_document: runReadDocument,
  analyze_table: runAnalyzeTable,
  count_groups: runCountGroups,
  list_project: runListProject,
  read_project_file: runReadProjectFile,
  create_folder: runCreateFolder,
  write_project_file: runWriteProjectFile,
};

/**
 * Ошибка инструмента возвращается модели как результат, а не роняет запрос:
 * агент должен уметь пойти другим путём, а не оборвать анализ на первой
 * недоступной странице.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  scope: ToolScope = { sources: null },
): Promise<ToolOutcome> {
  const runner = RUNNERS[name];
  if (!runner) {
    return {
      response: { error: `Инструмента ${name} не существует.` },
      trace: { name, argument: "", summary: "нет такого инструмента", ok: false },
    };
  }

  try {
    return await runner(args, scope);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка.";
    return {
      response: { error: message },
      trace: {
        name,
        argument: String(args.query ?? args.url ?? args.path ?? ""),
        summary: message.slice(0, 160),
        ok: false,
      },
    };
  }
}
