"use client";

import { useEffect, useRef, useState } from "react";

import { LuraLogo } from "@/components/lura-logo";
import type { ThreadSummary } from "@/lib/studio/types";

/**
 * Левая рельса: действия, поиск и список разборов.
 *
 * Переименование и удаление живут прямо в строке и появляются при наведении:
 * складывать их в отдельный экран ради двух операций незачем.
 */

type Props = {
  threads: ThreadSummary[];
  activeThread: string | null;
  view: "report" | "context";
  busy: boolean;
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
  onNewThread,
  onOpenThread,
  onOpenContext,
  onRenameThread,
  onDeleteThread,
}: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search.current?.focus();
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
    <aside className="st-rail">
      <div className="st-rail-top">
        <div className="st-brand">
          <LuraLogo className="st-brand-logo" />
          <span>Lura</span>
        </div>

        <nav className="st-nav">
          <button className="st-nav-item" onClick={onNewThread} disabled={busy}>
            <PlusIcon />
            <span>Новый разбор</span>
            <kbd>Ctrl+N</kbd>
          </button>

          <button
            className={`st-nav-item ${view === "context" ? "is-active" : ""}`}
            onClick={onOpenContext}
          >
            <SlidersIcon />
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
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по разборам"
            aria-label="Поиск по разборам"
          />
          {query ? (
            <button onClick={() => setQuery("")} aria-label="Очистить">
              ✕
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
    </aside>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 5h11M2.5 11h11" />
      <circle cx="6" cy="5" r="1.7" />
      <circle cx="10.5" cy="11" r="1.7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 13.5 13.5" />
    </svg>
  );
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 13.5H3.5v-11h3M10 11l3-3-3-3M13 8H6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 2.8 13.2 5.5 5.7 13H3v-2.7z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5 13h6l.5-8.5" />
    </svg>
  );
}
