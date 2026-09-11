"use client";

import { useState } from "react";

import { CloseIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon } from "@/components/studio/icons";
import { SideSection } from "@/components/studio/side-section";
import { cx } from "@/lib/studio/cx";
import type { ThreadSummary } from "@/lib/studio/types";

/**
 * Разборы проекта.
 *
 * Разбор — задача со статусом, отчёт — её результат. Поэтому у строки статус и
 * дата, а не счётчик сообщений: «12 сообщений» не говорит, готов ли отчёт.
 * Разговор без отчёта тоже живёт здесь и так и подписан.
 */

type Props = {
  threads: ThreadSummary[];
  active: string | null;
  /** Название разбора, который идёт прямо сейчас и ещё не сохранён. */
  pending: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

/* Поиск нужен, когда список перестаёт помещаться на экран, а не с первой строки. */
const SEARCH_FROM = 7;

export function StudioThreads({ threads, active, pending, busy, onOpen, onNew, onRename, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const needle = query.trim().toLowerCase();
  const visible = needle ? threads.filter((thread) => thread.title.toLowerCase().includes(needle)) : threads;

  function commit(id: string) {
    const title = draft.trim();
    setEditing(null);
    if (title) onRename(id, title);
  }

  return (
    <SideSection
      title="Разборы"
      actions={
        <button
          type="button"
          className="st-side-icon"
          onClick={onNew}
          disabled={busy}
          aria-label="Новый разбор"
          data-tip="Новый разбор"
        >
          <PlusIcon />
        </button>
      }
    >
      {threads.length >= SEARCH_FROM ? (
        <div className="st-side-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти разбор"
            aria-label="Найти разбор"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск">
              <CloseIcon />
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="st-runs">
        {pending ? (
          <li className="st-run is-active">
            <div className="st-run-open" aria-current="true">
              <span className="st-run-title">{pending}</span>
              <span className="st-run-meta">
                <Status kind="running" />
              </span>
            </div>
          </li>
        ) : null}

        {visible.map((thread) =>
          editing === thread.id ? (
            <li key={thread.id} className="st-run">
              <input
                className="st-run-edit"
                value={draft}
                autoFocus
                aria-label="Новое название разбора"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commit(thread.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit(thread.id);
                  if (event.key === "Escape") setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={thread.id} className={cx("st-run", active === thread.id && "is-active")}>
              <button
                type="button"
                className="st-run-open"
                onClick={() => onOpen(thread.id)}
                disabled={busy && active !== thread.id}
                aria-current={active === thread.id ? "true" : undefined}
                title={thread.title}
              >
                <span className="st-run-title">{thread.title}</span>
                <span className="st-run-meta">
                  <Status kind={busy && active === thread.id ? "running" : thread.reports ? "done" : "chat"} />
                  <span>{when(thread.updatedAt)}</span>
                </span>
              </button>
              <span className="st-run-tools">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(thread.id);
                    setDraft(thread.title);
                  }}
                  aria-label={`Переименовать «${thread.title}»`}
                  title="Переименовать"
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Удалить «${thread.title}» вместе с перепиской?`)) onDelete(thread.id);
                  }}
                  aria-label={`Удалить «${thread.title}»`}
                  title="Удалить"
                >
                  <TrashIcon />
                </button>
              </span>
            </li>
          ),
        )}
      </ul>

      {!threads.length && !pending ? (
        <p className="st-side-empty">Здесь появятся разборы — с названием, статусом и датой.</p>
      ) : null}
      {needle && !visible.length ? <p className="st-side-empty">Ничего не нашлось.</p> : null}
    </SideSection>
  );
}

function Status({ kind }: { kind: "running" | "done" | "chat" }) {
  const label = kind === "running" ? "Выполняется" : kind === "done" ? "Отчёт готов" : "Разговор";
  return <span className={cx("st-run-status", `is-${kind}`)}>{label}</span>;
}

/** Сегодняшнее — временем, остальное — датой: «14:05» или «9 сент.». */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
