"use client";

import { useEffect, useRef, useState } from "react";

import { LuraLogo } from "@/components/lura-logo";
import { PanelIcon } from "@/components/studio/panel-icon";
import type { ThreadSummary } from "@/lib/studio/types";

/**
 * Левая рельса: действия, разборы и управление панелями.
 *
 * Показателей состояния здесь нет намеренно. Модель видна в поле ввода,
 * документы — в «Кастомизации», занятость — по самому диалогу; вынесенные в
 * отдельный список, они превращались в приборную панель, за которой никто не
 * следит. Осталось то, чем действительно пользуются.
 */

type Props = {
  threads: ThreadSummary[];
  activeThread: string | null;
  view: "report" | "context";
  busy: boolean;
  ready: boolean;
  onCollapse: () => void;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onOpenContext: () => void;
  onRenameThread: (id: string, title: string) => void;
  onDeleteThread: (id: string) => void;
};

export function StudioRail({
  threads,
  activeThread,
  view,
  busy,
  ready,
  onCollapse,
  onNewThread,
  onOpenThread,
  onOpenContext,
  onRenameThread,
  onDeleteThread,
}: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        field.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const needle = query.trim().toLowerCase();
  const visible = needle ? threads.filter((thread) => thread.title.toLowerCase().includes(needle)) : threads;

  function commit(id: string) {
    const title = draft.trim();
    setEditing(null);
    if (title) onRenameThread(id, title);
  }

  return (
    <aside className="st-rail" aria-label="Панель управления">
      <div className="st-rail-top">
        <div className="st-brand">
          <LuraLogo className="st-brand-logo" />
          <span>Lura</span>
          {/* Кнопка сворачивания стоит там же, где панель начинается: искать
              её внизу, у другого края экрана, неоткуда. */}
          <button className="st-collapse" onClick={onCollapse} title="Скрыть панель — Ctrl B" aria-label="Скрыть панель">
            <PanelIcon side="left" />
          </button>
        </div>

        <nav className="st-nav">
          <button className="st-nav-item" onClick={onNewThread} disabled={busy}>
            <ComposeIcon />
            <span>Новый разбор</span>
            <kbd>Ctrl N</kbd>
          </button>

          <button className={`st-nav-item ${view === "context" ? "is-active" : ""}`} onClick={onOpenContext}>
            <LayersIcon />
            <span>Кастомизация</span>
          </button>
          <button
            className="st-nav-item"
            onClick={async () => {
              await fetch("/auth/signout", { method: "POST" });
              window.location.href = "/register";
            }}
          >
            <ExitIcon />
            <span>Выйти</span>
          </button>
        </nav>

        <div className="st-search">
          <SearchIcon />
          <input
            ref={field}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по разборам"
            aria-label="Поиск по разборам"
          />
          {query ? (
            <button onClick={() => setQuery("")} aria-label="Очистить">
              <CloseIcon />
            </button>
          ) : null}
        </div>
      </div>

      <div className="st-rail-scroll">
        <h2 className="st-rail-label">Разборы</h2>

        {visible.length ? (
          <div className="st-thread-list">
            {visible.map((thread) =>
              editing === thread.id ? (
                <input
                  key={thread.id}
                  className="st-thread-edit"
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commit(thread.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit(thread.id);
                    if (event.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <div
                  key={thread.id}
                  className={`st-thread ${activeThread === thread.id && view === "report" ? "is-active" : ""}`}
                >
                  <button
                    className="st-thread-open"
                    onClick={() => onOpenThread(thread.id)}
                    disabled={busy}
                    title={thread.title}
                  >
                    <span className="st-thread-dot" aria-hidden="true" />
                    <span className="st-thread-title">{thread.title}</span>
                  </button>

                  <span className="st-thread-tools">
                    <button
                      onClick={() => {
                        setEditing(thread.id);
                        setDraft(thread.title);
                      }}
                      title="Переименовать"
                      aria-label="Переименовать"
                    >
                      <PencilIcon />
                    </button>
                    <button onClick={() => onDeleteThread(thread.id)} title="Удалить" aria-label="Удалить">
                      <TrashIcon />
                    </button>
                  </span>
                </div>
              ),
            )}
          </div>
        ) : needle ? (
          <p className="st-rail-empty">Ничего не нашлось.</p>
        ) : null}
      </div>

      {!ready ? (
        <div className="st-rail-foot">
          <p className="st-rail-warn">Не задан ключ модели — ответы не запускаются.</p>
        </div>
      ) : (
        <div />
      )}
    </aside>
  );
}

function ComposeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.3 2.7a1.7 1.7 0 0 1 0 2.4L7.4 11 4.6 11.4 5 8.6l5.9-5.9a1.7 1.7 0 0 1 2.4 0z" />
      <path d="M12.8 13.4H4.1" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.4 14 5.6 8 8.8 2 5.6z" />
      <path d="M2.6 8.6 8 11.5l5.4-2.9" />
      <path d="M2.6 11.4 8 14.3l5.4-2.9" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="7.1" cy="7.1" r="4.1" />
      <path d="M10.3 10.3 13.4 13.4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4.8 4.8 11.2 11.2M11.2 4.8 4.8 11.2" />
    </svg>
  );
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.4 13.4H3.9a1.3 1.3 0 0 1-1.3-1.3V3.9a1.3 1.3 0 0 1 1.3-1.3h2.5" />
      <path d="M10.4 11 13.4 8l-3-3M13.4 8H6.2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 3 13 5.4 6 12.4 3.3 12.9l.5-2.7z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.2 4.6h9.6M6.6 4.6V3.4a.9.9 0 0 1 .9-.9h1a.9.9 0 0 1 .9.9v1.2" />
      <path d="M4.6 4.6 5.1 12.6a.9.9 0 0 0 .9.9h4a.9.9 0 0 0 .9-.9l.5-8" />
    </svg>
  );
}
