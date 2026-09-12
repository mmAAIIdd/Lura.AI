"use client";

import { useEffect, useRef, useState } from "react";

import type { StudioDocument } from "@/lib/studio/types";
import { cx } from "@/lib/studio/cx";
import { MATERIAL_ACCEPT, MATERIAL_FORMATS, MATERIAL_MAX_LABEL } from "@/lib/studio/materials";

/**
 * Материалы — то, из чего агент собирает ответ.
 *
 * Здесь всё про них разом: загрузка файлов и ссылок, документ о бизнесе,
 * просмотр содержимого, удаление и галочка «использовать в ответах». Галочка
 * не украшение: снятая, она убирает материал из поиска, чтения и подсчётов
 * агента — иначе экран обещал бы ответ по трём файлам, а он шёл бы по четырём.
 */

type Props = {
  documents: StudioDocument[];
  /** Материал, который нужно сразу открыть на просмотр. */
  focus?: string | null;
  /** Материалы со снятой галочкой: агент их не видит. */
  excluded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  busy: boolean;
  onUpload: (files: File[], asBusiness: boolean) => Promise<void>;
  onUploadUrl: (url: string, asBusiness: boolean) => Promise<void>;
  onMakeBusiness: (id: string) => void;
  onDelete: (id: string) => void;
};

export function StudioContext({
  documents,
  focus,
  excluded,
  onToggle,
  busy,
  onUpload,
  onUploadUrl,
  onMakeBusiness,
  onDelete,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ title: string; text: string; truncated: boolean } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
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

  async function open(id: string, title: string) {
    setLoading(id);
    try {
      const response = await fetch(`/api/studio/documents/${id}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { text: string; truncated: boolean };
      setPreview({ title, text: body.text, truncated: body.truncated });
    } finally {
      setLoading(null);
    }
  }

  /* Нажали «посмотреть» у материала в левой колонке — просмотр открывается
     сразу, без второго клика по той же строке здесь. */
  useEffect(() => {
    const wanted = documents.find((document) => document.id === focus);
    if (wanted) void open(wanted.id, wanted.title);
    // Список документов обновляется после каждой загрузки; просмотр нужен только при смене запроса.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  if (preview) {
    return (
      <div className="st-context">
        <header className="st-preview-head">
          <button onClick={() => setPreview(null)}>← Все материалы</button>
          <strong>{preview.title}</strong>
        </header>
        <pre className="st-preview">{preview.text}</pre>
        {preview.truncated ? <p className="st-context-empty">Показаны первые 20 000 символов.</p> : null}
      </div>
    );
  }

  return (
    <div className="st-context">
      <header className="st-context-head">
        <h1>Материалы</h1>
        <p>
          Всё, на чём Lura строит ответ: файлы, ссылки на страницы и документ о бизнесе. Снятая галочка убирает
          материал из поиска и подсчётов — агент его не увидит.
        </p>
      </header>

      <section
        className={cx("st-dropzone", dropping && "is-over")}
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
          <span>
            {MATERIAL_FORMATS} — до {MATERIAL_MAX_LABEL} на файл
          </span>
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
          accept={MATERIAL_ACCEPT}
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
          <DocumentRow
            document={business}
            primary
            selected={!excluded.has(business.id)}
            onToggle={onToggle}
            onDelete={onDelete}
            onOpen={open}
            loading={loading === business.id}
          />
        ) : (
          <p className="st-context-empty">
            Не загружен — Lura разбирает без контекста компании. Подойдёт описание компании, продукта, ролей
            пользователей и целевых показателей.
          </p>
        )}
      </section>

      <section className="st-context-block">
        <h2>
          Остальные материалы <span>{sources.length}</span>
        </h2>
        {sources.length ? (
          <div className="st-doc-list">
            {sources.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                selected={!excluded.has(document.id)}
                onToggle={onToggle}
                onMakeBusiness={onMakeBusiness}
                onDelete={onDelete}
                onOpen={open}
                loading={loading === document.id}
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
  selected,
  onToggle,
  onMakeBusiness,
  onDelete,
  onOpen,
  loading,
}: {
  document: StudioDocument;
  primary?: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onMakeBusiness?: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string, title: string) => void;
  loading: boolean;
}) {
  const origin =
    document.origin.type === "url"
      ? document.origin.url
      : document.origin.type === "file"
        ? document.origin.name
        : "вставленный текст";

  return (
    <article className={cx("st-doc", primary && "is-primary", !selected && "is-off")}>
      <div className="st-doc-main">
        <strong title={document.title}>{document.title}</strong>
        <span title={origin}>{origin}</span>
      </div>

      <label className="st-doc-pick">
        <input type="checkbox" checked={selected} onChange={() => onToggle(document.id)} />
        <span>Использовать в ответах</span>
      </label>

      <div className="st-doc-facts">
        <span>{document.chars.toLocaleString("ru-RU")} символов</span>
        <span>{document.chunks} фрагм.</span>
        <span>{document.indexed === "embeddings" ? "поиск по смыслу" : "поиск по словам"}</span>
      </div>

      <div className="st-doc-actions">
        <button onClick={() => onOpen(document.id, document.title)} disabled={loading}>
          {loading ? "Открываю…" : "Открыть"}
        </button>
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
