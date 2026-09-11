"use client";

import { useId, useMemo, useRef, useState } from "react";

import { UploadIcon } from "@/components/studio/icons";
import { UploadRow } from "@/components/studio/studio-materials";
import { cx } from "@/lib/studio/cx";
import {
  MATERIAL_ACCEPT,
  MATERIAL_FORMATS,
  MATERIAL_MAX_LABEL,
  exampleQuestions,
  type MaterialUpload,
} from "@/lib/studio/materials";
import type { StudioDocument } from "@/lib/studio/types";

/**
 * Начало работы — центр экрана, пока не открыт отчёт или файл.
 *
 * Экран ведёт по одному пути: загрузить материалы → отметить, что использовать,
 * и написать вопрос → начать разбор. На каждом шаге главная кнопка одна, и это
 * кнопка следующего шага. Раньше здесь стояло описание того, как устроено
 * приложение, и первый полезный результат приходилось искать самому.
 */

type Props = {
  documents: StudioDocument[];
  loaded: boolean;
  excluded: ReadonlySet<string>;
  uploads: MaterialUpload[];
  /** Материалы, загруженные в этой сессии: экран подтверждает, что они готовы. */
  recent: string[];
  busy: boolean;
  ready: boolean;
  onUpload: (files: File[]) => void;
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
  onToggle: (id: string) => void;
  onManage: () => void;
  onStart: (question: string) => void;
};

export function StudioStart({
  documents,
  loaded,
  excluded,
  uploads,
  recent,
  busy,
  ready,
  onUpload,
  onRetry,
  onDismiss,
  onToggle,
  onManage,
  onStart,
}: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [question, setQuestion] = useState("");
  const [dropping, setDropping] = useState(false);
  const questionId = useId();
  const reasonId = useId();

  const chosen = useMemo(() => documents.filter((document) => !excluded.has(document.id)), [documents, excluded]);
  const examples = useMemo(() => exampleQuestions(chosen.length ? chosen : documents), [chosen, documents]);

  const uploadRows = uploads.length ? (
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
  ) : null;

  const fileInput = (
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
  );

  const dropHandlers = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setDropping(true);
    },
    onDragLeave: () => setDropping(false),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setDropping(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length) onUpload(files);
    },
  };

  if (!loaded) {
    return (
      <div className="st-start">
        <p className="st-start-loading" role="status">
          Открываем рабочее пространство…
        </p>
      </div>
    );
  }

  /* Шаг первый: материалов нет, и единственное полезное действие — загрузить. */
  if (!documents.length) {
    return (
      <div className="st-start">
        <div className={cx("st-start-card", dropping && "is-over")} {...dropHandlers}>
          <h1>Начните разбор материалов продукта</h1>
          <p className="st-start-lead">Загрузите файл, затем укажите, что хотите выяснить.</p>

          <button type="button" className="st-btn st-btn-primary st-btn-lg" onClick={() => picker.current?.click()}>
            <UploadIcon />
            <span>Загрузить файл</span>
          </button>
          {fileInput}

          <p className="st-start-caption">
            Текстовые файлы и таблицы: {MATERIAL_FORMATS} — до {MATERIAL_MAX_LABEL} каждый. У таблицы нужны
            заголовки столбцов и дата в отдельном столбце. Файл можно перетащить сюда или{" "}
            <button type="button" className="st-link" onClick={onManage}>
              добавить ссылку на страницу
            </button>
            .
          </p>

          {uploadRows}

          <p className="st-start-aside">Без материалов тоже можно: задайте вопрос в чате справа.</p>
        </div>
      </div>
    );
  }

  /* Шаг второй: материалы есть — отметить источники, написать вопрос, запустить. */
  const reason = !ready
    ? "Разбор недоступен: у рабочего пространства не настроена модель."
    : busy
      ? "Дождитесь, пока Lura закончит текущий ответ."
      : !chosen.length
        ? "Отметьте хотя бы один материал."
        : !question.trim()
          ? "Напишите, что нужно выяснить."
          : null;
  const business = documents.some((document) => document.kind === "business");

  return (
    <div className="st-start">
      <form
        ref={form}
        className="st-start-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!reason) onStart(question.trim());
        }}
      >
        <h1>{recent.length ? "Материалы готовы" : "Что нужно выяснить?"}</h1>
        <p className="st-start-lead">
          {recent.length
            ? `Добавлено: ${recent.map((title) => `«${title}»`).join(", ")}. Отметьте, что использовать, и напишите вопрос.`
            : "Отметьте материалы и напишите вопрос. Lura прочитает их, посчитает и соберёт отчёт с основаниями."}
        </p>

        <fieldset className="st-start-sources">
          <legend>
            Источники для разбора{" "}
            <span>
              выбрано {chosen.length} из {documents.length}
            </span>
          </legend>
          <ul>
            {documents.map((document) => (
              <li key={document.id}>
                <input
                  id={`start-source-${document.id}`}
                  type="checkbox"
                  checked={!excluded.has(document.id)}
                  onChange={() => onToggle(document.id)}
                />
                <label htmlFor={`start-source-${document.id}`}>
                  <span className="st-source-name">{document.title}</span>
                  {document.kind === "business" ? <span className="st-badge">о бизнесе</span> : null}
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className="st-link" onClick={() => picker.current?.click()}>
            Загрузить ещё файл
          </button>
          {fileInput}
          {uploadRows}
        </fieldset>

        <label className="st-start-label" htmlFor={questionId}>
          Ваш вопрос
        </label>
        <textarea
          id={questionId}
          className="st-start-question"
          rows={3}
          value={question}
          placeholder={`Например: ${examples[0]}`}
          aria-describedby={reasonId}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            /* Ctrl+Enter запускает: Enter в многострочном поле — это перенос строки. */
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              form.current?.requestSubmit();
            }
          }}
        />

        <div className="st-start-examples">
          <span>Например:</span>
          {examples.map((example) => (
            <button key={example} type="button" className="st-example" onClick={() => setQuestion(example)}>
              {example}
            </button>
          ))}
        </div>

        <div className="st-start-go">
          <button
            type="submit"
            className={cx("st-btn st-btn-primary st-btn-lg", reason && "is-unavailable")}
            aria-disabled={Boolean(reason)}
            aria-describedby={reasonId}
          >
            Начать разбор
          </button>
          <p id={reasonId} className={cx("st-start-reason", reason && "is-blocked")} aria-live="polite">
            {reason ?? "Разбор займёт несколько минут — ход работы будет виден здесь."}
          </p>
        </div>

        {!business ? (
          <p className="st-start-aside">
            Выводы точнее, когда Lura знает компанию.{" "}
            <button type="button" className="st-link" onClick={onManage}>
              Добавить документ о бизнесе
            </button>
          </p>
        ) : null}
        <p className="st-start-aside">Короткий вопрос без отчёта можно задать в чате справа.</p>
      </form>
    </div>
  );
}
