"use client";

import { useRef, useState } from "react";

import type { StudioMode } from "@/lib/studio/types";

/**
 * Командная строка рабочего пространства.
 *
 * Вложения читаются здесь, в браузере: изображения уходят в base64 для
 * зрения модели, текстовые файлы — текстом. Так за один разбор можно
 * приложить скриншот дашборда и выгрузку отзывов, не заводя их документами.
 */

export type ComposerAttachment = { name: string; mimeType: string; data: string; text?: string };

const PLACEHOLDER: Record<StudioMode, string> = {
  reports: "Разбери, почему выросли жалобы на онбординг в этом месяце",
  updates: "Сделай отчёт по релизу 2.4 и реакции на него",
};

/* Предел на все вложения разом. Тело запроса на бессерверной площадке
   ограничено примерно 4.5 МБ, а base64 раздувает данные на треть — поэтому
   считается сумма, а не размер отдельного файла. */
const MAX_ATTACHMENTS_TOTAL_BYTES = 3 * 1024 * 1024;

/** Сколько весит уже приложенное: base64 длиннее исходных байтов на треть. */
function attachmentSize(attachment: ComposerAttachment): number {
  return attachment.text ? attachment.text.length : Math.floor(attachment.data.length * 0.75);
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Файл не прочитался."));
    reader.readAsDataURL(file);
  });
}

type Props = {
  mode: StudioMode;
  busy: boolean;
  onSend: (prompt: string, attachments: ComposerAttachment[]) => void;
  onStop: () => void;
};

export function StudioComposer({ mode, busy, onSend, onStop }: Props) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  async function attach(files: File[]) {
    setProblem(null);
    const next: ComposerAttachment[] = [];
    let budget = MAX_ATTACHMENTS_TOTAL_BYTES - attachments.reduce((sum, item) => sum + attachmentSize(item), 0);

    for (const file of files.slice(0, 6)) {
      if (file.size > budget) {
        setProblem(
          `«${file.name}» не помещается: на вложения к одному запросу отведено 3 МБ. ` +
            "Большой файл лучше загрузить документом в боковой панели.",
        );
        continue;
      }
      budget -= file.size;
      try {
        if (file.type.startsWith("image/")) {
          next.push({ name: file.name, mimeType: file.type, data: await readAsBase64(file) });
        } else {
          next.push({ name: file.name, mimeType: file.type || "text/plain", data: "", text: await file.text() });
        }
      } catch {
        setProblem(`«${file.name}» не прочитался.`);
      }
    }
    if (next.length) setAttachments((current) => [...current, ...next].slice(0, 6));
  }

  function send() {
    const prompt = value.trim();
    if (!prompt || busy) return;
    onSend(prompt, attachments);
    setValue("");
    setAttachments([]);
    if (area.current) area.current.style.height = "auto";
  }

  return (
    <div className="st-composer">
      {problem ? <p className="st-composer-problem">{problem}</p> : null}

      {attachments.length ? (
        <div className="st-chips">
          {attachments.map((attachment, index) => (
            <span key={`${attachment.name}-${index}`} className="st-chip">
              {attachment.text ? "📄" : "🖼"} {attachment.name}
              <button onClick={() => setAttachments((current) => current.filter((_, position) => position !== index))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="st-composer-row">
        <button
          className="st-attach"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          title="Приложить файл или изображение"
        >
          +
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void attach(files);
          }}
        />

        <textarea
          ref={area}
          value={value}
          rows={1}
          placeholder={PLACEHOLDER[mode]}
          onChange={(event) => {
            setValue(event.target.value);
            const element = event.target;
            element.style.height = "auto";
            element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
          }}
          onKeyDown={(event) => {
            /* Enter отправляет, Shift+Enter переносит строку — как в командной
               строке, а не как в текстовом редакторе. */
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              void attach(files);
            }
          }}
        />

        {busy ? (
          <button className="st-send is-stop" onClick={onStop} title="Остановить">
            ■
          </button>
        ) : (
          <button className="st-send" onClick={send} disabled={!value.trim()} title="Отправить">
            ↑
          </button>
        )}
      </div>
    </div>
  );
}
