/**
 * Геометрия графиков.
 *
 * Рисует не модель, а этот модуль. Модель заполняет спецификацию — заголовок,
 * подписи, ряды чисел — и на этом её участие заканчивается. Иначе получается
 * то, ради чего график и заводят: столбик «20» ниже столбика «14», потому что
 * рисовавший держал пропорции на глаз.
 *
 * Здесь только вычисления: подписи осей, шаг сетки, координаты столбцов и
 * точек. Разметка — в components/studio/chart.tsx, и она ничего не считает.
 */

export type ChartKind = "column" | "bar" | "line" | "stacked";

export type ChartSeries = {
  name: string;
  /** Пропуск в данных — null, а не ноль: это разные вещи на любом графике. */
  values: (number | null)[];
};

export type ChartMarker = { at: string; label: string };

export type ChartSpec = {
  type: ChartKind;
  title?: string;
  /** Подпись величины: «с», «%», «₸». Уходит к делениям оси. */
  unit?: string;
  categories: string[];
  series: ChartSeries[];
  /** Горизонтальная черта: цель, норматив, базовый уровень. */
  baseline?: { value: number; label?: string };
  /** Вертикальные отметки на оси категорий: релизы, инциденты. */
  markers?: ChartMarker[];
};

export type ChartIssue = string;

/** Разбор спецификации из блока отчёта. Ошибку показываем, а не молчим. */
export function parseChartSpec(source: string): { spec: ChartSpec } | { issue: ChartIssue } {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { issue: "Блок графика не разобрался как JSON." };
  }
  const value = raw as Partial<ChartSpec>;

  const kinds: ChartKind[] = ["column", "bar", "line", "stacked"];
  if (!value.type || !kinds.includes(value.type)) {
    return { issue: `Тип графика должен быть одним из: ${kinds.join(", ")}.` };
  }
  if (!Array.isArray(value.categories) || !value.categories.length) {
    return { issue: "Не заданы подписи категорий." };
  }
  if (!Array.isArray(value.series) || !value.series.length) {
    return { issue: "Не задан ни один ряд данных." };
  }

  const categories = value.categories.map((item) => String(item));
  const series: ChartSeries[] = [];
  for (const item of value.series) {
    const entry = item as Partial<ChartSeries>;
    if (!entry || typeof entry.name !== "string" || !Array.isArray(entry.values)) {
      return { issue: "У ряда должны быть имя и массив значений." };
    }
    /* Длина ряда приводится к числу категорий: ряд короче подписей рисуется
       со сдвигом, и график начинает врать молча. */
    const values = categories.map((_, index) => {
      const cell = entry.values?.[index];
      return typeof cell === "number" && Number.isFinite(cell) ? cell : null;
    });
    series.push({ name: entry.name, values });
  }

  if (series.every((item) => item.values.every((cell) => cell === null))) {
    return { issue: "В рядах нет ни одного числа." };
  }

  return {
    spec: {
      type: value.type,
      title: typeof value.title === "string" ? value.title : undefined,
      unit: typeof value.unit === "string" ? value.unit : undefined,
      categories,
      series,
      baseline:
        value.baseline && typeof value.baseline.value === "number" && Number.isFinite(value.baseline.value)
          ? { value: value.baseline.value, label: value.baseline.label }
          : undefined,
      markers: Array.isArray(value.markers)
        ? value.markers
            .filter((marker): marker is ChartMarker => Boolean(marker) && typeof marker.at === "string")
            .map((marker) => ({ at: marker.at, label: String(marker.label ?? "") }))
        : undefined,
    },
  };
}

/* ---------- Шкала ---------- */

export type Scale = { min: number; max: number; step: number; ticks: number[] };

/**
 * Человеческий шаг сетки.
 *
 * Деления идут по 1, 2, 2.5 или 5 на порядок величины. Шаг вроде 3,7 формально
 * делит диапазон ровно, но подписи под ним читать невозможно.
 */
function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * power;
}

/**
 * Диапазон оси значений.
 *
 * У столбцов ось всегда начинается с нуля: усечённая ось превращает разницу в
 * пять процентов в двукратную на вид, и это самый частый способ соврать
 * графиком. У линии ноль не обязателен — там важен ход ряда, а не абсолют, —
 * но снизу и сверху остаётся поле, чтобы линия не липла к рамке.
 */
export function buildScale(values: number[], kind: ChartKind, extra: number[] = []): Scale {
  const all = [...values, ...extra].filter((value) => Number.isFinite(value));
  if (!all.length) return { min: 0, max: 1, step: 1, ticks: [0, 1] };

  const low = Math.min(...all);
  const high = Math.max(...all);
  const zeroBased = kind !== "line";

  let min = zeroBased ? Math.min(0, low) : low;
  let max = high;
  if (min === max) {
    /* Ряд из одинаковых значений: без поля он вырождается в линию по краю. */
    max = min + Math.abs(min || 1) * 0.1;
  }
  if (!zeroBased) {
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
  }

  const step = niceStep((max - min) / 5);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  /* Накопление шага плавает в двоичной дроби, поэтому деление считается от
     индекса: иначе на шаге 0,1 вылезает 0,30000000000000004. */
  const count = Math.round((end - start) / step);
  for (let i = 0; i <= count; i += 1) ticks.push(Number((start + step * i).toFixed(10)));

  return { min: start, max: end, step, ticks };
}

/** Подпись деления: без хвоста нулей и с пробелом в тысячах. */
export function formatValue(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  const text = Number(value.toFixed(digits))
    .toString()
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return unit ? `${text} ${unit}` : text;
}

/* ---------- Раскладка ---------- */

export type Bar = { x: number; y: number; width: number; height: number; value: number; series: number; category: number };
export type Point = { x: number; y: number; value: number };
export type Line = { series: number; points: Point[] };

export type ChartLayout = {
  width: number;
  height: number;
  plot: { x: number; y: number; width: number; height: number };
  scale: Scale;
  /** Координата значения на оси: нужна и делениям, и базовой линии. */
  valueAt: (value: number) => number;
  categoryAt: (index: number) => number;
  bandWidth: number;
  bars: Bar[];
  lines: Line[];
  horizontal: boolean;
};

const PAD = { top: 18, right: 18, bottom: 34, left: 54 };

export function layoutChart(spec: ChartSpec, width: number, height: number): ChartLayout {
  const horizontal = spec.type === "bar";
  const stacked = spec.type === "stacked";

  /* Подписи категорий у горизонтальных столбцов стоят слева и бывают
     длинными, поэтому поле под них шире. */
  const pad = horizontal ? { ...PAD, left: Math.min(190, Math.max(90, longest(spec.categories) * 7)) } : PAD;

  const plot = {
    x: pad.left,
    y: pad.top,
    width: Math.max(10, width - pad.left - pad.right),
    height: Math.max(10, height - pad.top - pad.bottom),
  };

  const flat = spec.series.flatMap((item) => item.values.filter((value): value is number => value !== null));
  const totals = stacked
    ? spec.categories.map((_, index) =>
        spec.series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
      )
    : [];
  const scale = buildScale(stacked ? totals : flat, spec.type, spec.baseline ? [spec.baseline.value] : []);

  const span = scale.max - scale.min || 1;
  const valueAt = (value: number) =>
    horizontal
      ? plot.x + ((value - scale.min) / span) * plot.width
      : plot.y + plot.height - ((value - scale.min) / span) * plot.height;

  const bandWidth = (horizontal ? plot.height : plot.width) / Math.max(1, spec.categories.length);
  const categoryAt = (index: number) => (horizontal ? plot.y : plot.x) + bandWidth * (index + 0.5);

  const bars: Bar[] = [];
  const lines: Line[] = [];

  if (spec.type === "line") {
    spec.series.forEach((series, seriesIndex) => {
      const points: Point[] = [];
      series.values.forEach((value, index) => {
        if (value === null) return;
        points.push({ x: categoryAt(index), y: valueAt(value), value });
      });
      lines.push({ series: seriesIndex, points });
    });
  } else if (stacked) {
    spec.categories.forEach((_, index) => {
      let base = 0;
      spec.series.forEach((series, seriesIndex) => {
        const value = series.values[index];
        if (value === null) return;
        const from = valueAt(base);
        const to = valueAt(base + value);
        const thickness = bandWidth * 0.62;
        bars.push(
          horizontal
            ? { x: Math.min(from, to), y: categoryAt(index) - thickness / 2, width: Math.abs(to - from), height: thickness, value, series: seriesIndex, category: index }
            : { x: categoryAt(index) - thickness / 2, y: Math.min(from, to), width: thickness, height: Math.abs(to - from), value, series: seriesIndex, category: index },
        );
        base += value;
      });
    });
  } else {
    const groupWidth = bandWidth * 0.68;
    const slot = groupWidth / spec.series.length;
    spec.series.forEach((series, seriesIndex) => {
      series.values.forEach((value, index) => {
        if (value === null) return;
        const zero = valueAt(Math.max(scale.min, 0));
        const end = valueAt(value);
        const offset = categoryAt(index) - groupWidth / 2 + slot * seriesIndex;
        bars.push(
          horizontal
            ? { x: Math.min(zero, end), y: offset, width: Math.abs(end - zero), height: slot * 0.84, value, series: seriesIndex, category: index }
            : { x: offset, y: Math.min(zero, end), width: slot * 0.84, height: Math.abs(end - zero), value, series: seriesIndex, category: index },
        );
      });
    });
  }

  return { width, height, plot, scale, valueAt, categoryAt, bandWidth, bars, lines, horizontal };
}

function longest(items: string[]): number {
  return items.reduce((max, item) => Math.max(max, item.length), 0);
}

/* ---------- Таблица ---------- */

export type TableColumn = {
  key: string;
  label: string;
  /** Числовые столбцы выравниваются по правому краю и складываются в итог. */
  type?: "text" | "number" | "percent" | "delta";
  unit?: string;
};

export type TableSpec = {
  title?: string;
  columns: TableColumn[];
  rows: Record<string, string | number | null>[];
  /** Строка итога по числовым столбцам. */
  total?: boolean;
  /** Столбец, в котором значение дополнительно показано полосой. */
  bar?: string;
};

export function parseTableSpec(source: string): { spec: TableSpec } | { issue: ChartIssue } {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { issue: "Блок таблицы не разобрался как JSON." };
  }
  const value = raw as Partial<TableSpec>;
  if (!Array.isArray(value.columns) || !value.columns.length) return { issue: "Не заданы столбцы таблицы." };
  if (!Array.isArray(value.rows)) return { issue: "Не заданы строки таблицы." };

  const columns: TableColumn[] = [];
  for (const column of value.columns) {
    const entry = column as Partial<TableColumn>;
    if (!entry || typeof entry.key !== "string" || typeof entry.label !== "string") {
      return { issue: "У столбца должны быть ключ и заголовок." };
    }
    columns.push({
      key: entry.key,
      label: entry.label,
      type: entry.type === "number" || entry.type === "percent" || entry.type === "delta" ? entry.type : "text",
      unit: typeof entry.unit === "string" ? entry.unit : undefined,
    });
  }

  return {
    spec: {
      title: typeof value.title === "string" ? value.title : undefined,
      columns,
      rows: value.rows.filter((row): row is Record<string, string | number | null> => Boolean(row) && typeof row === "object"),
      total: value.total === true,
      bar: typeof value.bar === "string" && columns.some((column) => column.key === value.bar) ? value.bar : undefined,
    },
  };
}

/** Наибольшее значение столбца — по нему масштабируются полосы в ячейках. */
export function columnPeak(spec: TableSpec, key: string): number {
  return spec.rows.reduce((max, row) => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(max, Math.abs(value)) : max;
  }, 0);
}

export function columnTotal(spec: TableSpec, key: string): number | null {
  let sum = 0;
  let seen = false;
  for (const row of spec.rows) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      seen = true;
    }
  }
  return seen ? sum : null;
}
