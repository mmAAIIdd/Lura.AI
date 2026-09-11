"use client";

import { StopIcon } from "@/components/studio/icons";
import { ReportMarkdown } from "@/components/studio/report-markdown";
import { cx } from "@/lib/studio/cx";
import type { StudioMessage, ToolTrace } from "@/lib/studio/types";

/**
 * Разбор в центре: как он идёт и чем закончился.
 *
 * Оба состояния названы словами над текстом: «Разбор выполняется» — с тем, что
 * Lura делает прямо сейчас, и «Отчёт готов» — с датой. Без шапки разбор на
 * несколько минут выглядел пустой страницей, а готовый отчёт — очередным
 * ответом, про который непонятно, что это и что делать дальше.
 */

type Props = {
  /** Готовый отчёт. Пока идёт разбор, вместо него приходит streaming. */
  message: StudioMessage | null;
  streaming: { text: string; tools: ToolTrace[] } | null;
  /** Вопрос, с которого начался разбор. */
  question: string;
  onStop: () => void;
  onNew: () => void;
};

export function StudioReport({ message, streaming, question, onStop, onNew }: Props) {
  if (streaming) {
    const last = streaming.tools[streaming.tools.length - 1];
    const status = streaming.text ? "Пишет отчёт" : last ? describe(last) : "Готовит план разбора";

    return (
      <div className="st-report">
        <div className="st-report-body">
          <header className="st-task">
            <span className="st-task-state is-running">Разбор выполняется</span>
            <h1>{question}</h1>
            <p className="st-task-status" role="status">
              {status}
            </p>
            <div className="st-task-actions">
              <button type="button" className="st-btn st-btn-secondary" onClick={onStop}>
                <StopIcon />
                <span>Остановить</span>
              </button>
            </div>
          </header>

          {streaming.tools.length ? (
            /* Ход разбора раскрыт, пока отчёта ещё нет, и сворачивается, когда
               начинается текст: читать отчёт мимо двадцати строк шагов неудобно. */
            <details className="st-steps" open={!streaming.text}>
              <summary>Ход разбора · шагов: {streaming.tools.length}</summary>
              <ol>
                {streaming.tools.map((trace, index) => (
                  <li
                    key={`${trace.name}-${index}`}
                    className={cx("st-step", !trace.summary ? "is-running" : trace.ok ? "is-done" : "is-failed")}
                  >
                    <span className="st-step-name">{describe(trace)}</span>
                    {trace.summary ? <span className="st-step-note">{trace.summary}</span> : null}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}

          {streaming.text ? <ReportMarkdown source={streaming.text} /> : null}
        </div>
      </div>
    );
  }

  if (!message) return null;

  const sources = [...new Map((message.tools ?? []).flatMap((t) => t.sources ?? []).map((s) => [s.url, s])).values()];
  const date = new Date(message.createdAt).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="st-report">
      <div className="st-report-body">
        <header className="st-task">
          <span className="st-task-state is-done">Отчёт готов</span>
          <h1>{question}</h1>
          <p className="st-task-status">
            {date}
            {message.model ? ` · ${message.model}` : ""}
          </p>
          <div className="st-task-actions">
            <button type="button" className="st-btn st-btn-secondary" onClick={onNew}>
              Новый разбор
            </button>
          </div>
        </header>

        <ReportMarkdown source={message.text} />

        {sources.length ? (
          <section className="st-report-sources" aria-label="Открытые страницы">
            <ul>
              {sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.title || source.url}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Шаг разбора человеческими словами. Аргумент у некоторых шагов на старте пуст. */
function describe(trace: ToolTrace): string {
  const labels: Record<string, string> = {
    web_search: "Ищет в интернете",
    fetch_url: "Читает страницу",
    search_documents: "Ищет в материалах",
    read_document: "Читает материал",
    analyze_table: "Считает показатели",
    count_groups: "Считает темы",
    list_project: "Смотрит файлы проекта",
    read_project_file: "Открывает файл",
    create_folder: "Создаёт папку",
    write_project_file: "Записывает файл",
  };
  const label = labels[trace.name] ?? "Работает";
  return trace.argument ? `${label}: ${trace.argument}` : label;
}
