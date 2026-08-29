"use client";

import { useRef, useState } from "react";

import type { StudioDocument } from "@/lib/studio/types";

/**
 * Кастомизация — то, из чего агент собирает контекст.
 *
 * Раньше на этом месте был переключатель режимов, но выбирать за агента, что
 * он сейчас разбирает, — не работа пользователя. Работа пользователя —
 * решить, что агент вообще знает о компании. Поэтому здесь документ о бизнесе,
 * источники и ссылки, и ничего кроме.
 */

type Props = {
  documents: StudioDocument[];
  busy: boolean;
  onUpload: (files: File[], asBusiness: boolean) => Promise<void>;
  onUploadUrl: (url: string, asBusiness: boolean) => Promise<void>;
  onMakeBusiness: (id: string) => void;
  onDelete: (id: string) => void;
};

const ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.xml,.html,.htm";

export function StudioContext({ documents, busy, onUpload, onUploadUrl, onMakeBusiness, onDelete }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [asBusiness, setAsBusiness] = useState(false);
  const [link, setLink] = useState("");
  const [dropping, setDropping] = useState(false);
  const [working, setWorking] = useState(false);

  const business = documents.find((document) => document.kind === "business") ?? null;
  const sources = documents.filter((document) => document.kind !== "business");

  async function guard(action: () => Promise<void>) {
    setWorking(true);
    try {
      await action();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="st-context">
      <header className="st-context-head">
        <h1>Кастомизация</h1>
        <p>Контекст, из которого агент собирает разбор.</p>
      </header>

      <section
        className={`st-dropzone ${dropping ? "is-over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length) void guard(() => onUpload(files, asBusiness));
        }}
      >
        <div className="st-dropzone-main">
          <strong>Перетащите файлы сюда</strong>
          <span>txt, md, csv, tsv, json, log, yaml, xml, html — до 4 МБ на файл</span>
        </div>

        <div className="st-dropzone-actions">
          <button className="st-primary" onClick={() => fileInput.current?.click()} disabled={busy || working}>
            Выбрать файлы
          </button>
          <label className="st-check">
            <input type="checkbox" checked={asBusiness} onChange={(event) => setAsBusiness(event.target.checked)} />
            загрузить как документ о бизнесе
          </label>
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) void guard(() => onUpload(files, asBusiness));
          }}
        />

        <form
          className="st-linkrow"
          onSubmit={(event) => {
            event.preventDefault();
            const value = link.trim();
            if (!value) return;
            setLink("");
            void guard(() => onUploadUrl(value, asBusiness));
          }}
        >
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="…или вставьте ссылку: README, страницу продукта, обзор"
            inputMode="url"
          />
          <button type="submit" disabled={busy || working || !link.trim()}>
            Добавить
          </button>
        </form>
      </section>

      <section className="st-context-block">
        <h2>Документ о бизнесе</h2>
        {business ? (
          <DocumentRow document={business} primary onDelete={onDelete} />
        ) : (
          <p className="st-context-empty">Не загружен — агент работает без контекста компании.</p>
        )}
      </section>

      <section className="st-context-block">
        <h2>
          Источники <span>{sources.length}</span>
        </h2>
        {sources.length ? (
          <div className="st-doc-list">
            {sources.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                onMakeBusiness={onMakeBusiness}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          <p className="st-context-empty">Отзывы, changelog, тикеты, метрики, заметки.</p>
        )}
      </section>
    </div>
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
  const origin =
    document.origin.type === "url"
      ? document.origin.url
      : document.origin.type === "file"
        ? document.origin.name
        : "вставленный текст";

  return (
    <article className={`st-doc ${primary ? "is-primary" : ""}`}>
      <div className="st-doc-main">
        <strong title={document.title}>{document.title}</strong>
        <span title={origin}>{origin}</span>
      </div>

      <div className="st-doc-facts">
        <span>{document.chars.toLocaleString("ru-RU")} символов</span>
        <span>{document.chunks} фрагм.</span>
        <span>{document.indexed === "embeddings" ? "поиск по смыслу" : "поиск по словам"}</span>
      </div>

      <div className="st-doc-actions">
        {!primary && onMakeBusiness ? (
          <button onClick={() => onMakeBusiness(document.id)}>Сделать основным</button>
        ) : null}
        <button className="st-doc-remove" onClick={() => onDelete(document.id)}>
          Удалить
        </button>
      </div>
    </article>
  );
}
