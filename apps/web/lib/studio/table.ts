/**
 * Точный счёт по табличным документам.
 *
 * Модель хорошо читает смысл и плохо считает: она видит выгрузку кусками и
 * называет «14 упоминаний» там, где их 9. Поэтому группировку по темам
 * оставляем модели, а арифметику забираем в код — считаем здесь, детерминированно
 * и по всей таблице целиком.
 *
 * Отсюда же берётся вывод «показатель не изменился». Сам по себе он выглядит
 * пустым, но для продуктового решения стоит ровно столько же, сколько найденная
 * просадка: без него любое совпадение по времени превращается в причину.
 */

export type Table = {
  columns: string[];
  rows: Record<string, string>[];
  delimiter: string;
};

/* ---------- Разбор ---------- */

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      out.push(field);
      field = "";
    } else field += char;
  }
  out.push(field);
  return out.map((value) => value.trim());
}

/** Строки склеиваются заново: перевод строки внутри кавычек — часть значения, а не конец записи. */
function logicalLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let quotes = 0;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    current = current ? `${current}\n${line}` : line;
    quotes += (line.match(/"/g) || []).length;
    if (quotes % 2 === 0) {
      lines.push(current);
      current = "";
    }
  }
  if (current) lines.push(current);
  return lines.filter((line) => line.trim());
}

export function parseTable(text: string): Table | null {
  const lines = logicalLines(text);
  if (lines.length < 2) return null;

  const delimiter = [";", ",", "\t"]
    .map((candidate) => ({ candidate, count: splitLine(lines[0], candidate).length }))
    .sort((a, b) => b.count - a.count)[0];
  if (!delimiter || delimiter.count < 2) return null;

  const columns = splitLine(lines[0], delimiter.candidate).map((name, index) => name || `столбец_${index + 1}`);
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const values = splitLine(line, delimiter.candidate);
    if (values.length !== columns.length) continue;
    rows.push(Object.fromEntries(columns.map((name, index) => [name, values[index]])));
  }

  return rows.length ? { columns, rows, delimiter: delimiter.candidate } : null;
}

/* ---------- Типы значений ---------- */

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const DOTTED = /^(\d{2})\.(\d{2})\.(\d{4})/;

/** Дата в вид, сравнимый строкой. Форматы смешиваются в одной выгрузке чаще, чем хотелось бы. */
export function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = ISO.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = DOTTED.exec(trimmed);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  return null;
}

function toNumber(value: string): number | null {
  const cleaned = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned || !/^-?\d+(\.\d+)?%?$/.test(cleaned)) return null;
  return Number(cleaned.replace("%", ""));
}

function detectDateColumn(table: Table): string | null {
  for (const column of table.columns) {
    const filled = table.rows.filter((row) => row[column]?.trim());
    if (!filled.length) continue;
    const dated = filled.filter((row) => normalizeDate(row[column])).length;
    if (dated / filled.length > 0.9) return column;
  }
  return null;
}

function detectIdColumn(table: Table): string | null {
  for (const column of table.columns) {
    const values = table.rows.map((row) => row[column]?.trim()).filter(Boolean);
    if (values.length !== table.rows.length) continue;
    if (new Set(values).size === values.length) return column;
  }
  return null;
}

/* ---------- Статистика ---------- */

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

/* Знаков хватает, чтобы среднее не съезжало на соседнее круглое число:
   доступность 99,95% при округлении до одного знака читается как «100%»,
   то есть как отсутствие простоя, которого на самом деле не было. */
const round = (value: number): number => Number(value.toFixed(Math.abs(value) < 10 ? 3 : 2));

export type SeriesStat = {
  столбец: string;
  до: { значений: number; среднее: number; минимум: number; максимум: number } | null;
  после: { значений: number; среднее: number; минимум: number; максимум: number } | null;
  последние_4: number | null;
  /** Пик или дно после границы вместе с датой: по средним провал не виден. */
  крайнее_после: { значение: number; дата: string | null; направление: string } | null;
  изменение_процентов: number | null;
  вердикт: string;
  разброс_до: number | null;
  /** Насколько сдвиг велик в единицах обычного разброса ряда до границы. */
  сила_сдвига_сигм: number | null;
  /** Сколько замеров подряд сразу после границы вышли за обычный разброс. */
  подряд_за_порогом: number | null;
  /** Где ряд ломается по самим данным, без подсказки о дате релиза. */
  перелом: { дата: string | null; позиция: number; сдвиг: number } | null;
};

/**
 * Точка перелома ряда.
 *
 * Ищется разбиение, при котором средние двух половин расходятся сильнее всего.
 * Нужна затем, что дату границы задаёт человек, а данные могут ломаться в
 * другом месте: совпадение найденного перелома с датой релиза — довод в пользу
 * связи, расхождение — довод против, и оба вывода сильнее, чем сравнение по
 * заранее выбранной дате.
 */
function changePoint(values: number[], dates: (string | null)[]): SeriesStat["перелом"] {
  if (values.length < 6) return null;
  let best = { позиция: -1, сдвиг: 0 };
  for (let k = 2; k <= values.length - 2; k += 1) {
    const shift = Math.abs(mean(values.slice(0, k)) - mean(values.slice(k)));
    if (shift > best.сдвиг) best = { позиция: k, сдвиг: shift };
  }
  if (best.позиция < 0) return null;
  return { дата: dates[best.позиция] ?? null, позиция: best.позиция, сдвиг: round(best.сдвиг) };
}

/**
 * Изменился показатель или колебался в своих обычных пределах.
 *
 * Порог — разброс самого ряда до границы. Иначе любое движение в третьем знаке
 * читается как падение, и отчёт сообщает о просадке там, где ряд просто дышит.
 */
function verdictFor(before: number[], after: number[]): { вердикт: string; изменение: number | null } {
  if (!before.length || !after.length) return { вердикт: "недостаточно данных", изменение: null };
  const b = mean(before);
  const a = mean(after);
  const delta = a - b;
  const change = b === 0 ? null : round((delta / Math.abs(b)) * 100);
  const threshold = Math.max(stdev(before), Math.abs(b) * 0.005);
  if (Math.abs(delta) <= threshold) return { вердикт: "не изменился", изменение: change };
  return { вердикт: delta > 0 ? "вырос" : "снизился", изменение: change };
}

export type ValueCounts = {
  столбец: string;
  значения: { значение: string; до: number; после: number; доля_до_процентов?: number; доля_после_процентов?: number }[];
};

export type TableAnalysis = {
  строк_всего: number;
  столбцы: string[];
  столбец_даты: string | null;
  граница: string | null;
  период: { начало: string; конец: string } | null;
  строк_до: number | null;
  строк_после: number | null;
  ряды: SeriesStat[];
  распределения: ValueCounts[];
  примечание: string;
};

export function analyzeTable(
  table: Table,
  options: { boundary?: string | null; dateColumn?: string | null } = {},
): TableAnalysis {
  const dateColumn = options.dateColumn && table.columns.includes(options.dateColumn)
    ? options.dateColumn
    : detectDateColumn(table);
  const boundary = options.boundary ? normalizeDate(options.boundary) : null;

  const dates = dateColumn
    ? table.rows.map((row) => normalizeDate(row[dateColumn])).filter((value): value is string => Boolean(value)).sort()
    : [];

  const isBefore = (row: Record<string, string>): boolean | null => {
    if (!dateColumn || !boundary) return null;
    const date = normalizeDate(row[dateColumn]);
    return date ? date < boundary : null;
  };

  const rowsBefore = boundary && dateColumn ? table.rows.filter((row) => isBefore(row) === true) : [];
  const rowsAfter = boundary && dateColumn ? table.rows.filter((row) => isBefore(row) === false) : [];

  const ряды: SeriesStat[] = [];
  const распределения: ValueCounts[] = [];

  for (const column of table.columns) {
    if (column === dateColumn) continue;
    const values = table.rows.map((row) => toNumber(row[column] ?? ""));
    const numeric = values.filter((value): value is number => value !== null);

    /* Числовой ряд — сравниваем средние. Порога по числу различных значений
       здесь быть не должно: ряд, у которого их два-три, — это самый стабильный
       показатель в выгрузке, и именно ему нужен вердикт «не изменился».
       Раньше такие ряды выпадали из сравнения и молча исчезали из отчёта. */
    if (numeric.length / table.rows.length > 0.8) {
      const before = rowsBefore.map((row) => toNumber(row[column] ?? "")).filter((v): v is number => v !== null);
      const after = rowsAfter.map((row) => toNumber(row[column] ?? "")).filter((v): v is number => v !== null);
      const tail = after.slice(-4);
      const { вердикт, изменение } = verdictFor(before, after);

      /* Среднее по периоду сглаживает провал: активация, просевшая на одну
         неделю вдвое, в средних выглядит лёгким снижением. Поэтому рядом со
         средним всегда идёт крайнее значение и его дата. */
      let крайнее: SeriesStat["крайнее_после"] = null;
      if (after.length && rowsAfter.length) {
        const beforeMean = before.length ? mean(before) : null;
        const worseIsLow = beforeMean === null ? true : mean(after) <= beforeMean;
        const target = worseIsLow ? Math.min(...after) : Math.max(...after);
        const row = rowsAfter.find((candidate) => toNumber(candidate[column] ?? "") === target);
        крайнее = {
          значение: target,
          дата: row && dateColumn ? normalizeDate(row[dateColumn]) : null,
          направление: worseIsLow ? "минимум после границы" : "максимум после границы",
        };
      }
      /* Оценка — числовой ряд, но среднее по ней мало что говорит: важна доля
         единиц и двоек. Поэтому у коротких шкал наравне со средним считается и
         распределение, иначе модель считает доли сама и ошибается. */
      if (new Set(numeric).size <= 12 && rowsBefore.length + rowsAfter.length > 0) {
        const distinctNumeric = [...new Set(numeric)].sort((a, b) => a - b);
        const share = (count: number, total: number) => (total ? Number(((count / total) * 100).toFixed(1)) : 0);
        распределения.push({
          столбец: column,
          значения: distinctNumeric.map((значение) => {
            const до = rowsBefore.filter((row) => toNumber(row[column] ?? "") === значение).length;
            const после = rowsAfter.filter((row) => toNumber(row[column] ?? "") === значение).length;
            return {
              значение: String(значение),
              до,
              после,
              доля_до_процентов: share(до, rowsBefore.length),
              доля_после_процентов: share(после, rowsAfter.length),
            };
          }),
        });
      }

      /* Сила сдвига и его устойчивость. Одна неделя за порогом — выброс,
         пять подряд — новый уровень ряда, и это разные выводы. */
      const spread = before.length > 1 ? stdev(before) : 0;
      const baseline = before.length ? mean(before) : null;
      const сила = spread > 0 && baseline !== null && after.length
        ? round(Math.abs(mean(after) - baseline) / spread)
        : null;
      let подряд: number | null = null;
      if (spread > 0 && baseline !== null && after.length) {
        подряд = 0;
        for (const value of after) {
          if (Math.abs(value - baseline) > spread) подряд += 1;
          else break;
        }
      }

      const ordered = table.rows
        .map((row) => ({ value: toNumber(row[column] ?? ""), date: dateColumn ? normalizeDate(row[dateColumn]) : null }))
        .filter((entry): entry is { value: number; date: string | null } => entry.value !== null);

      ряды.push({
        столбец: column,
        до: before.length ? { значений: before.length, среднее: round(mean(before)), минимум: Math.min(...before), максимум: Math.max(...before) } : null,
        после: after.length ? { значений: after.length, среднее: round(mean(after)), минимум: Math.min(...after), максимум: Math.max(...after) } : null,
        последние_4: tail.length ? round(mean(tail)) : null,
        крайнее_после: крайнее,
        сила_сдвига_сигм: сила,
        подряд_за_порогом: подряд,
        перелом: changePoint(ordered.map((e) => e.value), ordered.map((e) => e.date)),
        изменение_процентов: изменение,
        вердикт,
        разброс_до: before.length > 1 ? round(stdev(before)) : null,
      });
      continue;
    }

    const distinct = new Set(table.rows.map((row) => (row[column] ?? "").trim()));
    if (distinct.size > 1 && distinct.size <= 12) {
      распределения.push({
        столбец: column,
        значения: [...distinct].sort().map((значение) => {
          const до = rowsBefore.filter((row) => (row[column] ?? "").trim() === значение).length;
          const после = rowsAfter.filter((row) => (row[column] ?? "").trim() === значение).length;
          return {
            значение,
            до,
            после,
            доля_до_процентов: rowsBefore.length ? Number(((до / rowsBefore.length) * 100).toFixed(1)) : 0,
            доля_после_процентов: rowsAfter.length ? Number(((после / rowsAfter.length) * 100).toFixed(1)) : 0,
          };
        }),
      });
    }
  }

  return {
    строк_всего: table.rows.length,
    столбцы: table.columns,
    столбец_даты: dateColumn,
    граница: boundary,
    период: dates.length ? { начало: dates[0], конец: dates[dates.length - 1] } : null,
    строк_до: boundary && dateColumn ? rowsBefore.length : null,
    строк_после: boundary && dateColumn ? rowsAfter.length : null,
    ряды,
    распределения,
    примечание:
      "Числа посчитаны по всей таблице целиком, а не по фрагментам. Переносить их в отчёт можно как есть. " +
      "Вердикт «не изменился» означает, что сдвиг среднего не превысил обычного разброса ряда до границы — " +
      "такой показатель нельзя называть просевшим или выросшим. " +
      "«сила_сдвига_сигм» показывает, во сколько обычных разбросов уложился сдвиг: до одного — шум, больше двух — заметное движение. " +
      "«подряд_за_порогом» отличает выброс на одном замере от нового уровня ряда. " +
      "«перелом» найден по самим данным, без оглядки на дату границы: совпал с релизом — довод в пользу связи, разошёлся — против.",
  };
}

/* ---------- Счёт по группам ---------- */

export type GroupInput = { name: string; ids: string[] };

export type GroupCount = {
  тема: string;
  до: number;
  после: number;
  изменение: number;
  доля_после_процентов: number | null;
  место_по_величине: number;
  /** Разбивка по периодам между границами: видно, затухла тема или держится. */
  по_периодам?: Record<string, number>;
  /** Разрез темы по столбцу: из какого канала пришли жалобы, с какой оценкой. */
  разрез?: Record<string, { до: number; после: number }>;
};

export type GroupAnalysis = {
  строк_всего: number;
  строк_до: number | null;
  строк_после: number | null;
  граница: string | null;
  столбец_идентификатора: string;
  столбец_разреза: string | null;
  периоды: string[];
  темы: GroupCount[];
  сумма_по_темам_после: number;
  не_отнесены: { количество: number; идентификаторы: string[] };
  несуществующие: string[];
  в_нескольких_темах: string[];
  примечание: string;
};

/** Отрезки времени по списку границ: (…; b1), [b1; b2), [b2; …). */
function buildPeriods(boundaries: string[]): { label: string; from: string | null; to: string | null }[] {
  const sorted = [...new Set(boundaries)].sort();
  if (!sorted.length) return [];
  const periods: { label: string; from: string | null; to: string | null }[] = [
    { label: `до ${sorted[0]}`, from: null, to: sorted[0] },
  ];
  for (let i = 0; i < sorted.length; i += 1) {
    const from = sorted[i];
    const to = sorted[i + 1] ?? null;
    periods.push({ label: to ? `${from} … ${to}` : `с ${from}`, from, to });
  }
  return periods;
}

export function countGroups(
  table: Table,
  options: {
    groups: GroupInput[];
    boundary?: string | null;
    /** Дополнительные границы: разбить «после» на отрезки между релизами. */
    boundaries?: string[] | null;
    idColumn?: string | null;
    dateColumn?: string | null;
    /** Столбец разреза: канал, оценка, сегмент. «14 жалоб» и «14 жалоб, из
        них 11 через поддержку» — разные по ценности утверждения. */
    breakdownColumn?: string | null;
  },
): GroupAnalysis | { ошибка: string } {
  const idColumn = options.idColumn && table.columns.includes(options.idColumn)
    ? options.idColumn
    : detectIdColumn(table);
  if (!idColumn) return { ошибка: "В таблице нет столбца с уникальным идентификатором строки. Укажи id_column явно." };

  const dateColumn = options.dateColumn && table.columns.includes(options.dateColumn)
    ? options.dateColumn
    : detectDateColumn(table);
  const boundary = options.boundary ? normalizeDate(options.boundary) : null;

  const byId = new Map(table.rows.map((row) => [String(row[idColumn]).trim(), row]));
  const before = (row: Record<string, string>): boolean | null => {
    if (!dateColumn || !boundary) return null;
    const date = normalizeDate(row[dateColumn]);
    return date ? date < boundary : null;
  };

  const assigned = new Map<string, string[]>();
  const несуществующие: string[] = [];

  const counted = options.groups.map((group) => {
    let до = 0;
    let после = 0;
    for (const raw of group.ids) {
      const id = String(raw).trim();
      const row = byId.get(id);
      /* Идентификатор, которого нет в таблице, — не мелочь: это признак того,
         что ссылка в отчёте выдумана. Молча отбросить его нельзя. */
      if (!row) {
        if (!несуществующие.includes(id)) несуществующие.push(id);
        continue;
      }
      assigned.set(id, [...(assigned.get(id) ?? []), group.name]);
      const side = before(row);
      if (side === true) до += 1;
      else if (side === false) после += 1;
    }
    return { тема: group.name, до, после };
  });

  const rowsAfter = boundary && dateColumn ? table.rows.filter((row) => before(row) === false).length : 0;
  const rowsBefore = boundary && dateColumn ? table.rows.filter((row) => before(row) === true).length : 0;

  /* Разбивка по отрезкам между границами. Тема, вспыхнувшая после релиза и
     затухшая после исправления, по одной границе «до/после» неотличима от
     темы, которая держится всё время. */
  const extra = (options.boundaries ?? []).map((value) => normalizeDate(value)).filter((v): v is string => Boolean(v));
  const periodEdges = boundary ? [...new Set([boundary, ...extra])].sort() : extra.sort();
  const periods = periodEdges.length > 1 && dateColumn ? buildPeriods(periodEdges) : [];

  const perPeriod = new Map<string, Record<string, number>>();
  if (periods.length) {
    for (const group of options.groups) {
      const counts: Record<string, number> = {};
      for (const period of periods) {
        counts[period.label] = group.ids.filter((raw) => {
          const row = byId.get(String(raw).trim());
          if (!row) return false;
          const date = normalizeDate(row[dateColumn!]);
          if (!date) return false;
          return (!period.from || date >= period.from) && (!period.to || date < period.to);
        }).length;
      }
      perPeriod.set(group.name, counts);
    }
  }

  const breakdown = options.breakdownColumn && table.columns.includes(options.breakdownColumn)
    ? options.breakdownColumn
    : null;
  const perCut = new Map<string, Record<string, { до: number; после: number }>>();
  if (breakdown) {
    for (const group of options.groups) {
      const cut: Record<string, { до: number; после: number }> = {};
      for (const raw of group.ids) {
        const row = byId.get(String(raw).trim());
        if (!row) continue;
        const key = (row[breakdown] ?? "").trim() || "—";
        cut[key] ??= { до: 0, после: 0 };
        const side = before(row);
        if (side === true) cut[key].до += 1;
        else if (side === false) cut[key].после += 1;
      }
      perCut.set(group.name, cut);
    }
  }

  const ranked = [...counted].sort((a, b) => b.после - a.после);
  const темы: GroupCount[] = counted.map((entry) => ({
    тема: entry.тема,
    до: entry.до,
    после: entry.после,
    изменение: entry.после - entry.до,
    доля_после_процентов: rowsAfter ? Number(((entry.после / rowsAfter) * 100).toFixed(1)) : null,
    место_по_величине: ranked.findIndex((candidate) => candidate.тема === entry.тема) + 1,
    ...(perPeriod.has(entry.тема) ? { по_периодам: perPeriod.get(entry.тема) } : {}),
    ...(perCut.has(entry.тема) ? { разрез: perCut.get(entry.тема) } : {}),
  }));

  const unassigned = [...byId.keys()].filter((id) => !assigned.has(id));

  const duplicates = [...assigned.entries()].filter(([, names]) => names.length > 1);
  const sumAfter = темы.reduce((sum, entry) => sum + entry.после, 0);

  /* Строка, попавшая в две темы, считается дважды: сумма по темам расходится с
     числом строк, и таблица в отчёте перестаёт сходиться. Такой счёт нельзя
     отдавать молча — он выглядит точным ровно так же, как правильный. */
  const problems: string[] = [];
  if (unassigned.length) {
    problems.push(
      `${unassigned.length} строк не отнесены ни к одной теме — отнеси их к темам (можно к «прочее») и вызови инструмент ещё раз`,
    );
  }
  if (duplicates.length) {
    problems.push(
      `строки ${duplicates.map(([id]) => id).join(", ")} попали больше чем в одну тему и посчитаны дважды — оставь каждую строку ровно в одной теме и вызови инструмент ещё раз`,
    );
  }
  if (несуществующие.length) {
    problems.push(`идентификаторов ${несуществующие.join(", ")} в выгрузке нет — проверь, откуда они взялись`);
  }

  return {
    строк_всего: table.rows.length,
    строк_до: boundary && dateColumn ? rowsBefore : null,
    строк_после: boundary && dateColumn ? rowsAfter : null,
    граница: boundary,
    столбец_идентификатора: idColumn,
    столбец_разреза: breakdown,
    периоды: periods.map((period) => period.label),
    темы,
    сумма_по_темам_после: sumAfter,
    не_отнесены: { количество: unassigned.length, идентификаторы: unassigned.slice(0, 80) },
    несуществующие,
    в_нескольких_темах: duplicates.map(([id]) => id),
    примечание: problems.length
      ? `СЧЁТ НЕВЕРЕН, в отчёт эти числа ставить нельзя: ${problems.join("; ")}.`
      : "Все строки распределены ровно по одной теме, сумма сходится. Числа можно переносить в отчёт как есть.",
  };
}
