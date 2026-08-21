"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

export type PendingSource = { title: string; content: string; source_kind: string };

const MAX_CHARS = 1_400_000;
const ACCEPTED = ".txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.html,.xml";

type UploadDialogProps = {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (sources: PendingSource[]) => void;
};

export function UploadDialog({ open, busy, error, onClose, onSubmit }: UploadDialogProps) {
  const [files, setFiles] = useState<PendingSource[]>([]);
  const [pastedTitle, setPastedTitle] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setPastedTitle("");
      setPastedText("");
      setLocalError(null);
      return;
    }
    dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  async function readFiles(event: ChangeEvent<HTMLInputElement>) {
    setLocalError(null);
    const selected = [...(event.target.files ?? [])];
    const parsed: PendingSource[] = [];
    for (const file of selected) {
      const text = await file.text();
      if (!text.trim()) {
        setLocalError(`Файл «${file.name}» пуст или не содержит текста.`);
        continue;
      }
      if (text.length > MAX_CHARS) {
        setLocalError(`Файл «${file.name}» слишком большой. Предел — ${MAX_CHARS.toLocaleString("ru-RU")} символов.`);
        continue;
      }
      parsed.push({ title: file.name, content: text, source_kind: "upload" });
    }
    setFiles(parsed);
  }

  function submit() {
    const sources = [...files];
    if (pastedText.trim()) {
      sources.push({
        title: pastedTitle.trim() || "Вставленный текст",
        content: pastedText,
        source_kind: "paste",
      });
    }
    if (!sources.length) {
      setLocalError("Выберите файлы или вставьте текст.");
      return;
    }
    onSubmit(sources);
  }

  return (
    <div className="ws-overlay" role="presentation" onClick={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div
        className="ws-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Загрузка данных"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => event.key === "Escape" && !busy && onClose()}
      >
        <header className="ws-dialog-head">
          <div>
            <h2>Загрузить данные</h2>
            <p>Документы разбиваются на фрагменты, индексируются и попадают в контекст ассистента.</p>
          </div>
          <button className="ws-icon-button" onClick={onClose} disabled={busy} aria-label="Закрыть">✕</button>
        </header>

        <div className="ws-dialog-body">
          <label className="ws-field">
            <span>Файлы</span>
            <input type="file" multiple accept={ACCEPTED} onChange={(event) => void readFiles(event)} disabled={busy} />
            <small>Текстовые форматы: txt, md, csv, json, log, yaml, xml, html.</small>
          </label>

          {files.length > 0 && (
            <ul className="ws-file-list">
              {files.map((file) => (
                <li key={file.title}>
                  <strong>{file.title}</strong>
                  <span>{file.content.length.toLocaleString("ru-RU")} символов</span>
                </li>
              ))}
            </ul>
          )}

          <div className="ws-divider"><span>или</span></div>

          <label className="ws-field">
            <span>Название</span>
            <input
              type="text"
              maxLength={300}
              value={pastedTitle}
              onChange={(event) => setPastedTitle(event.target.value)}
              placeholder="Например: отзывы из App Store за август"
              disabled={busy}
            />
          </label>
          <label className="ws-field">
            <span>Текст</span>
            <textarea
              rows={8}
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
              placeholder="Вставьте отзывы, заметки со встречи, changelog, выгрузку тикетов..."
              disabled={busy}
            />
          </label>

          {(localError || error) && <p className="form-error" role="alert">{localError ?? error}</p>}
        </div>

        <footer className="ws-dialog-foot">
          <button className="ws-button ws-button-quiet" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="ws-button ws-button-primary" onClick={submit} disabled={busy}>
            {busy ? "Индексируем..." : "Загрузить и проиндексировать"}
          </button>
        </footer>
      </div>
    </div>
  );
}
