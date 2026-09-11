"use client";

import { useRef, useState } from "react";

import { CloseIcon, FileIcon, UploadIcon } from "@/components/studio/icons";
import { SideSection } from "@/components/studio/side-section";
import { cx } from "@/lib/studio/cx";
import {
  MATERIAL_ACCEPT,
  MATERIAL_FORMATS,
  MATERIAL_MAX_LABEL,
  type MaterialUpload,
} from "@/lib/studio/materials";
import type { StudioDocument } from "@/lib/studio/types";

/**
 * Материалы — то, на чём Lura строит ответ.
 *
 * Галочка у материала и есть «источник для ответа»: снятая галочка убирает
 * документ из поиска, чтения и счёта агента, а не только из списка. Иначе экран
 * обещал бы разбор по трём файлам, а агент тихо опирался бы на четвёртый.
 */

type Props = {
  documents: StudioDocument[];
  loaded: boolean;
  excluded: ReadonlySet<string>;
  uploads: MaterialUpload[];
  onToggle: (id: string) => void;
  onUpload: (files: File[]) => void;
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
  onOpen: (id: string) => void;
  onManage: () => void;
};

export function StudioMaterials({
  documents,
  loaded,
  excluded,
  uploads,
  onToggle,
  onUpload,
  onRetry,
  onDismiss,
  onOpen,
  onManage,
}: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const chosen = documents.filter((document) => !excluded.has(document.id)).length;

  return (
    <SideSection
      title="Материалы"
      meta={documents.length ? `выбрано ${chosen} из ${documents.length}` : undefined}
    >
      <div
        className={cx("st-materials", dropping && "is-over")}
        onDragOver={(event) => {
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length) onUpload(files);
        }}
      >
        {/* Пока материалов нет, загрузка — единственный осмысленный шаг и
            выглядит главной кнопкой. Дальше главным становится вопрос в центре. */}
        <button
          type="button"
          className={cx("st-btn st-btn-block", documents.length ? "st-btn-secondary" : "st-btn-primary")}
          onClick={() => picker.current?.click()}
        >
          <UploadIcon />
          <span>Загрузить файл</span>
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={MATERIAL_ACCEPT}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) onUpload(files);
          }}
        />
        <p className="st-side-note">
          Текст и таблицы: {MATERIAL_FORMATS}, до {MATERIAL_MAX_LABEL}.{" "}
          <button type="button" className="st-link" onClick={onManage}>
            Добавить ссылку
          </button>
        </p>

        {uploads.length ? (
          <ul className="st-uploads">
            {uploads.map((upload) => (
              <UploadRow
                key={upload.key}
                upload={upload}
                onRetry={onRetry}
                onDismiss={onDismiss}
                onReplace={() => {
                  onDismiss(upload.key);
                  picker.current?.click();
                }}
              />
            ))}
          </ul>
        ) : null}

        {documents.length ? (
          <ul className="st-sources" aria-label="Источники для ответа">
            {documents.map((document) => (
              <li key={document.id} className="st-source">
                <input
                  id={`source-${document.id}`}
                  type="checkbox"
                  checked={!excluded.has(document.id)}
                  onChange={() => onToggle(document.id)}
                />
                <label htmlFor={`source-${document.id}`} title={document.title}>
                  <span className="st-source-name">{document.title}</span>
                  {document.kind === "business" ? <span className="st-badge">о бизнесе</span> : null}
                </label>
                <button
                  type="button"
                  className="st-source-open"
                  onClick={() => onOpen(document.id)}
                  aria-label={`Посмотреть «${document.title}»`}
                  title="Посмотреть содержимое"
                >
                  <FileIcon />
                </button>
              </li>
            ))}
          </ul>
        ) : loaded && !uploads.length ? (
          <p className="st-side-empty">
            Пока пусто. Загрузите отзывы, релиз-ноуты или выгрузку метрик — то, что нужно разобрать.
          </p>
        ) : null}
      </div>
    </SideSection>
  );
}

/** Строка загрузки: идёт или сорвалась. Готовая загрузка строкой не висит — файл уже в списке. */
export function UploadRow({
  upload,
  onRetry,
  onDismiss,
  onReplace,
}: {
  upload: MaterialUpload;
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
  onReplace: () => void;
}) {
  if (upload.state === "working") {
    return (
      <li className="st-upload is-working">
        <span className="st-spinner" aria-hidden="true" />
        <span className="st-upload-text">
          <b>{upload.name}</b>
          {/* Индексация идёт внутри того же запроса, что и загрузка, поэтому
              этап один и процентов нет: выдуманный прогресс хуже честного «идёт». */}
          <span>Загружается и обрабатывается…</span>
        </span>
      </li>
    );
  }

  return (
    <li className="st-upload is-failed">
      <div className="st-upload-text" role="alert">
        <b>{upload.name}</b>
        <span>{upload.error ?? "Не загрузился."}</span>
      </div>
      <div className="st-upload-actions">
        <button type="button" className="st-link" onClick={() => onRetry(upload.key)}>
          Повторить
        </button>
        <button type="button" className="st-link" onClick={onReplace}>
          Выбрать другой файл
        </button>
        <button
          type="button"
          className="st-upload-close"
          onClick={() => onDismiss(upload.key)}
          aria-label={`Скрыть ошибку «${upload.name}»`}
          title="Скрыть"
        >
          <CloseIcon />
        </button>
      </div>
    </li>
  );
}
