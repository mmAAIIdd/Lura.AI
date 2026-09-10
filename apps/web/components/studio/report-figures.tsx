"use client";

import { useId } from "react";

import {
  columnPeak,
  columnTotal,
  formatValue,
  layoutChart,
  type ChartSpec,
  type TableSpec,
} from "@/lib/studio/chart";

/**
 * График и таблица отчёта.
 *
 * Разметка и ничего кроме: все координаты приходят готовыми из
 * lib/studio/chart.ts. Здесь нет ни одного вычисления, влияющего на пропорции,
 * — иначе правило «график не рисует тот, кто его придумал» соблюдалось бы
 * только наполовину.
 */

/* Палитра рядов. Порядок не случайный: первый ряд — основной, его и видно
   лучше всего; дальше цвета расходятся по тону, а не по яркости, чтобы
   различались и в чёрно-белой печати отчёта. */
const SERIES = ["#1a5fd6", "#0f9d7a", "#c2410c", "#7c3aed", "#0891b2", "#a16207"];

export function ReportChart({ spec }: { spec: ChartSpec }) {
  const clip = useId().replace(/:/g, "");
  const width = 720;
  const height = spec.type === "bar" ? Math.max(180, 56 + spec.categories.length * 34) : 320;
  const view = layoutChart(spec, width, height);
  const multi = spec.series.length > 1;

  const markerIndex = (at: string) => spec.categories.findIndex((category) => category === at);

  return (
    <figure className="st-fig">
      {spec.title ? <figcaption className="st-fig-title">{spec.title}</figcaption> : null}

      {multi ? (
        <div className="st-fig-legend">
          {spec.series.map((series, index) => (
            <span key={series.name}>
              <i style={{ background: SERIES[index % SERIES.length] }} aria-hidden="true" />
              {series.name}
            </span>
          ))}
        </div>
      ) : null}

      <svg
        className="st-fig-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={spec.title || "График"}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Сетка и деления оси значений */}
        {view.scale.ticks.map((tick) => {
          const position = view.valueAt(tick);
          return view.horizontal ? (
            <g key={tick}>
              <line x1={position} x2={position} y1={view.plot.y} y2={view.plot.y + view.plot.height} className="st-fig-grid" />
              <text x={position} y={view.plot.y + view.plot.height + 18} className="st-fig-tick" textAnchor="middle">
                {formatValue(tick, spec.unit)}
              </text>
            </g>
          ) : (
            <g key={tick}>
              <line x1={view.plot.x} x2={view.plot.x + view.plot.width} y1={position} y2={position} className="st-fig-grid" />
              <text x={view.plot.x - 8} y={position + 4} className="st-fig-tick" textAnchor="end">
                {formatValue(tick, spec.unit)}
              </text>
            </g>
          );
        })}

        {/* Отметки событий: релиз, инцидент */}
        {(spec.markers ?? []).map((marker) => {
          const index = markerIndex(marker.at);
          if (index < 0) return null;
          const at = view.categoryAt(index);
          return view.horizontal ? null : (
            <g key={`${marker.at}-${marker.label}`}>
              <line x1={at} x2={at} y1={view.plot.y} y2={view.plot.y + view.plot.height} className="st-fig-marker" />
              <text x={at + 4} y={view.plot.y + 11} className="st-fig-marker-label">
                {marker.label}
              </text>
            </g>
          );
        })}

        {/* Базовая линия: цель или норматив */}
        {spec.baseline ? (
          <g>
            {view.horizontal ? (
              <line
                x1={view.valueAt(spec.baseline.value)}
                x2={view.valueAt(spec.baseline.value)}
                y1={view.plot.y}
                y2={view.plot.y + view.plot.height}
                className="st-fig-baseline"
              />
            ) : (
              <line
                x1={view.plot.x}
                x2={view.plot.x + view.plot.width}
                y1={view.valueAt(spec.baseline.value)}
                y2={view.valueAt(spec.baseline.value)}
                className="st-fig-baseline"
              />
            )}
            {spec.baseline.label ? (
              <text
                x={view.plot.x + view.plot.width - 4}
                y={view.horizontal ? view.plot.y + 11 : view.valueAt(spec.baseline.value) - 5}
                className="st-fig-baseline-label"
                textAnchor="end"
              >
                {spec.baseline.label}
              </text>
            ) : null}
          </g>
        ) : null}

        {/* Столбцы */}
        {view.bars.map((bar) => (
          <rect
            key={`${bar.series}-${bar.category}`}
            x={bar.x}
            y={bar.y}
            width={Math.max(bar.width, view.horizontal ? 1 : bar.width)}
            height={Math.max(bar.height, view.horizontal ? bar.height : 1)}
            rx={2}
            fill={SERIES[bar.series % SERIES.length]}
          >
            <title>{`${spec.categories[bar.category]} — ${formatValue(bar.value, spec.unit)}`}</title>
          </rect>
        ))}

        {/* Линии */}
        {view.lines.map((line) => (
          <g key={line.series}>
            <polyline
              points={line.points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke={SERIES[line.series % SERIES.length]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#${clip})`}
            />
            {line.points.map((point) => (
              <circle key={point.x} cx={point.x} cy={point.y} r={2.6} fill={SERIES[line.series % SERIES.length]}>
                <title>{formatValue(point.value, spec.unit)}</title>
              </circle>
            ))}
          </g>
        ))}

        {/* Подписи категорий */}
        {spec.categories.map((category, index) => {
          const at = view.categoryAt(index);
          /* На плотной оси подписи наезжают друг на друга, поэтому лишние
             прячутся: пустая ось честнее нечитаемой каши. */
          const stride = Math.ceil((spec.categories.length * 46) / view.plot.width);
          if (!view.horizontal && stride > 1 && index % stride !== 0) return null;
          return view.horizontal ? (
            <text key={category + index} x={view.plot.x - 8} y={at + 4} className="st-fig-cat" textAnchor="end">
              {category}
            </text>
          ) : (
            <text key={category + index} x={at} y={view.plot.y + view.plot.height + 18} className="st-fig-cat" textAnchor="middle">
              {category}
            </text>
          );
        })}

        <line
          x1={view.plot.x}
          x2={view.horizontal ? view.plot.x : view.plot.x + view.plot.width}
          y1={view.horizontal ? view.plot.y : view.plot.y + view.plot.height}
          y2={view.plot.y + view.plot.height}
          className="st-fig-axis"
        />

        <defs>
          <clipPath id={clip}>
            <rect x={view.plot.x} y={view.plot.y - 4} width={view.plot.width} height={view.plot.height + 8} />
          </clipPath>
        </defs>
      </svg>
    </figure>
  );
}

/* ---------- Таблица ---------- */

function cellText(value: string | number | null, column: TableSpec["columns"][number]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "number") return String(value);
  if (column.type === "percent") return `${formatValue(value)}%`;
  if (column.type === "delta") return `${value > 0 ? "+" : ""}${formatValue(value, column.unit)}`;
  return formatValue(value, column.unit);
}

export function ReportTable({ spec }: { spec: TableSpec }) {
  const peak = spec.bar ? columnPeak(spec, spec.bar) : 0;

  return (
    <figure className="st-fig st-fig-table">
      {spec.title ? <figcaption className="st-fig-title">{spec.title}</figcaption> : null}
      <div className="st-fig-scroll">
        <table>
          <thead>
            <tr>
              {spec.columns.map((column) => (
                <th key={column.key} className={column.type === "text" ? undefined : "num"}>
                  {column.label}
                  {column.unit ? <span className="st-fig-unit">, {column.unit}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, index) => (
              <tr key={index}>
                {spec.columns.map((column) => {
                  const value = row[column.key] ?? null;
                  const share =
                    spec.bar === column.key && peak > 0 && typeof value === "number"
                      ? Math.abs(value) / peak
                      : null;
                  return (
                    <td key={column.key} className={column.type === "text" ? undefined : "num"}>
                      {share === null ? (
                        cellText(value, column)
                      ) : (
                        <span className="st-fig-cell">
                          <span className="st-fig-cell-bar" style={{ width: `${Math.round(share * 100)}%` }} aria-hidden="true" />
                          <span className="st-fig-cell-text">{cellText(value, column)}</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {spec.total ? (
            <tfoot>
              <tr>
                {spec.columns.map((column, index) => {
                  if (column.type === "text") {
                    return <td key={column.key}>{index === 0 ? "Итого" : ""}</td>;
                  }
                  /* Доли и разницы не складываются: сумма процентов по строкам
                     не значит ничего, а сумма приростов — тем более. */
                  const sum = column.type === "number" ? columnTotal(spec, column.key) : null;
                  return (
                    <td key={column.key} className="num">
                      {sum === null ? "" : cellText(sum, column)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </figure>
  );
}

export function FigureIssue({ issue }: { issue: string }) {
  return (
    <p className="st-fig-issue">
      Блок не отрисован: {issue}
    </p>
  );
}
