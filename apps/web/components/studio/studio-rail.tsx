"use client";

import { LuraLogo } from "@/components/lura-logo";
import type { ThreadSummary } from "@/lib/studio/types";

/**
 * Левая рельса: действия иконкой с подписью, ниже — список разборов.
 * Порядок взят у редакторов и агентских панелей: сначала то, что нажимают,
 * потом то, что листают.
 */

type Props = {
  threads: ThreadSummary[];
  activeThread: string | null;
  view: "report" | "context";
  busy: boolean;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onOpenContext: () => void;
};

export function StudioRail({
  threads,
  activeThread,
  view,
  busy,
  onNewThread,
  onOpenThread,
  onOpenContext,
}: Props) {
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
          </button>

          <button
            className={`st-nav-item ${view === "context" ? "is-active" : ""}`}
            onClick={onOpenContext}
          >
            <SlidersIcon />
            <span>Кастомизация</span>
          </button>
        </nav>
      </div>

      <div className="st-rail-scroll">
        <h2 className="st-rail-label">Разборы</h2>

        {threads.length ? (
          <div className="st-thread-list">
            {threads.map((thread) => (
              <button
                key={thread.id}
                className={`st-thread ${activeThread === thread.id && view === "report" ? "is-active" : ""}`}
                onClick={() => onOpenThread(thread.id)}
                disabled={busy}
                title={thread.title}
              >
                <span className="st-thread-dot" aria-hidden="true" />
                <span className="st-thread-title">{thread.title}</span>
              </button>
            ))}
          </div>
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
