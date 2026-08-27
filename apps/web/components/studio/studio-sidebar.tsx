"use client";

import { useRef, useState } from "react";

import { LuraLogo } from "@/components/lura-logo";
import type { StudioDocument, StudioMode, ThreadSummary } from "@/lib/studio/types";

/**
 * Боковая панель: режим вывода, документы и прошлые разборы.
 *
 * Загрузка стоит выше списка разборов намеренно — без документа о бизнесе
 * агент работает вслепую, и первое действие в пустом пространстве должно
 * бросаться в глаза.
 */

const MODES: { id: StudioMode; label: string; hint: string }[] = [
  { id: "reports", label: "Отчёты", hint: "разбор, поиск, доказательства" },
  { id: "updates", label: "Обновления", hint: "релизы и что после них" },
];

type Props = {
  mode: StudioMode;
  onMode: (mode: StudioMode) => void;
  documents: StudioDocument[];
  threads: ThreadSummary[];
  activeThread: string | null;
  busy: boolean;
  onUpload: (files: File[], asBusiness: boolean) => Promise<void>;
  onUploadUrl: (url: string, asBusiness: boolean) => Promise<void>;
  onMakeBusiness: (id: string) => void;
  onDeleteDocument: (id: string) => void;
  onOpenThread: (id: string) => void;
  onNewThread: () => void;
};

export function StudioSidebar(props: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [asBusiness, setAsBusiness] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [dropping, setDropping] = useState(false);

  const business = props.documents.find((document) => document.kind === "business");
  const sources = props.documents.filter((document) => document.kind !== "business");
  const threads = props.threads.filter((thread) => thread.mode === props.mode);

  async function submitLink() {
    const value = link.trim();
    if (!value) return;
    setLink("");
    setLinkOpen(false);
    await props.onUploadUrl(value, asBusiness);
  }

  return (
    <aside className="st-side">
      <div className="st-brand">
        <LuraLogo className="st-brand-logo" />
        <span>Lura</span>
      </div>

      <div className="st-modes" role="group" aria-label="Режим вывода">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={props.mode === item.id}
            disabled={props.busy}
            className={`st-mode ${props.mode === item.id ? "is-active" : ""}`}
            onClick={() => props.onMode(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.hint}</span>
          </button>
        ))}
      </div>

      <div
        className={`st-drop ${dropping ? "is-over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length) void props.onUpload(files, asBusiness);
        }}
      >
        <button className="st-upload" onClick={() => fileInput.current?.click()}>
          Загрузить документы
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.xml,.html,.htm"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) void props.onUpload(files, asBusiness);
          }}
        />
        <label className="st-check">
          <input type="checkbox" checked={asBusiness} onChange={(event) => setAsBusiness(event.target.checked)} />
          как документ о бизнесе
        </label>
        <button className="st-link-toggle" onClick={() => setLinkOpen((open) => !open)}>
          {linkOpen ? "скрыть ссылку" : "или добавить ссылку"}
        </button>
        {linkOpen ? (
          <form
            className="st-link"
            onSubmit={(event) => {
              event.preventDefault();
              void submitLink();
            }}
          >
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://…"
              inputMode="url"
            />
            <button type="submit">→</button>
          </form>
        ) : null}
      </div>

      <div className="st-side-scroll">
        <section className="st-block">
          <h2>Контекст</h2>
          {business ? (
            <DocumentRow document={business} primary onDelete={props.onDeleteDocument} />
          ) : (
            <p className="st-empty">Документ о бизнесе не загружен — агент разбирает без контекста компании.</p>
          )}
        </section>

        {sources.length ? (
          <section className="st-block">
            <h2>Документы</h2>
            {sources.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                onMakeBusiness={props.onMakeBusiness}
                onDelete={props.onDeleteDocument}
              />
            ))}
          </section>
        ) : null}

        <section className="st-block">
          <h2>
            Разборы
            <button className="st-new" onClick={props.onNewThread} disabled={props.busy}>
              новый
            </button>
          </h2>
          {threads.length ? (
            threads.map((thread) => (
              <button
                key={thread.id}
                className={`st-thread ${props.activeThread === thread.id ? "is-active" : ""}`}
                onClick={() => props.onOpenThread(thread.id)}
                disabled={props.busy}
              >
                <span>{thread.title}</span>
                <small>{new Date(thread.updatedAt).toLocaleDateString("ru-RU")}</small>
              </button>
            ))
          ) : (
            <p className="st-empty">Пока пусто.</p>
          )}
        </section>
      </div>
    </aside>
  );
}

function DocumentRow({
  document,
  primary,
  onMakeBusiness,
  onDelete,
}: {
  document: StudioDocument;
  primary?: boolean;
  onMakeBusiness?: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={`st-doc ${primary ? "is-primary" : ""}`}>
      <div className="st-doc-main">
        <strong title={document.title}>{document.title}</strong>
        <small>
          {document.chunks} фрагм. · {document.indexed === "embeddings" ? "векторный поиск" : "поиск по словам"}
        </small>
      </div>
      <div className="st-doc-actions">
        {!primary && onMakeBusiness ? (
          <button onClick={() => onMakeBusiness(document.id)} title="Сделать документом о бизнесе">
            в контекст
          </button>
        ) : null}
        <button onClick={() => onDelete(document.id)} title="Удалить документ">
          ✕
        </button>
      </div>
    </div>
  );
}
