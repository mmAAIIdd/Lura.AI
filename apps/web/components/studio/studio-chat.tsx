"use client";

import { useEffect, useRef, useState } from "react";

import { REPORT_COMMAND } from "@/lib/studio/command";
import type { LuraModel, StudioMessage, ToolTrace } from "@/lib/studio/types";

/**
 * Правая полоса — диалог с агентом.
 *
 * Здесь только разговор и работа инструментов: что спросили, куда агент
 * сходил, что нашёл, что ответил. Служебного тут нет ничего: состояние,
 * настройки и действия над ответом живут в левой панели, полный ответ — в
 * центре. Такое разделение — общий приём у редакторов с ассистентом: длинный
 * результат в стороне, переписка узкой колонкой рядом.
 */

export type ComposerAttachment = { name: string; mimeType: string; data: string; text?: string };

/* Предел на все вложения разом. Тело запроса на бессерверной площадке
   ограничено примерно 4.5 МБ, а base64 раздувает данные на треть — поэтому
   считается сумма, а не размер отдельного файла. */
const MAX_ATTACHMENTS_TOTAL_BYTES = 3 * 1024 * 1024;

const TOOL_LABEL: Record<string, string> = {
  web_search: "Поиск",
  fetch_url: "Читает",
  search_documents: "Документы",
};

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
  messages: StudioMessage[];
  model: LuraModel;
  onModel: (model: LuraModel) => void;
  live: { text: string; tools: ToolTrace[] } | null;
  error: string | null;
  busy: boolean;
  selectedReport: string | null;
  models: LuraModel[];
  onSelectReport: (messageId: string) => void;
  onSend: (prompt: string, attachments: ComposerAttachment[]) => void;
  onStop: () => void;
};

export function StudioChat({
  messages,
  model,
  onModel,
  live,
  error,
  busy,
  selectedReport,
  models,
  onSelectReport,
  onSend,
  onStop,
}: Props) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const stream = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const node = stream.current;
    if (!node) return;
    const onScroll = () => {
      stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    stick.current = true;
  }, [messages.length]);

  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live?.tools.length, live?.text]);

  async function attach(files: File[]) {
    setProblem(null);
    const next: ComposerAttachment[] = [];
    let budget = MAX_ATTACHMENTS_TOTAL_BYTES - attachments.reduce((sum, item) => sum + attachmentSize(item), 0);

    for (const file of files.slice(0, 6)) {
      if (file.size > budget) {
        setProblem(
          `«${file.name}» не помещается: на вложения к одному запросу отведено 3 МБ. ` +
            "Большой файл загрузите в «Кастомизации».",
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

  /* Команда разбора набирается кнопкой, а не с клавиатуры: запомнить
     «/lur manager-dev start» нельзя, а промахнуться в нём — легко, и тогда
     запрос молча уходит обычным вопросом. Повторное нажатие снимает её. */
  const commandOn = value.trimStart().toLowerCase().startsWith(REPORT_COMMAND);

  function toggleCommand() {
    setValue((current) => {
      const trimmed = current.trimStart();
      if (trimmed.toLowerCase().startsWith(REPORT_COMMAND)) {
        return trimmed.slice(REPORT_COMMAND.length).trimStart();
      }
      return `${REPORT_COMMAND} ${trimmed}`;
    });
    area.current?.focus();
  }

  return (
    <section className="st-chat" aria-label="Диалог с Лурой">
      <div className="st-chat-stream" ref={stream}>
        {!messages.length && !live ? (
          <p className="st-chat-hint">
            Спросите о чём угодно. Полный разбор с отчётом запускает команда «{REPORT_COMMAND}».
          </p>
        ) : null}

        {messages.map((message) =>
          message.role === "user" ? (
            <article className="st-said" key={message.id}>
              <p>{message.text}</p>
              {message.attachments?.length ? (
                <div className="st-said-files">
                  {message.attachments.map((file) => (
                    <span key={file.name}>{file.name}</span>
                  ))}
                </div>
              ) : null}
            </article>
          ) : (
            <article className="st-reply" key={message.id}>
              <ToolList tools={message.tools ?? []} />
              <button
                className={`st-reply-text ${selectedReport === message.id ? "is-active" : ""}`}
                onClick={() => onSelectReport(message.id)}
                title="Показать в центре"
              >
                {message.text}
              </button>
            </article>
          ),
        )}

        {live ? (
          <article className="st-reply">
            <ToolList tools={live.tools} running />
            {live.text ? <div className="st-reply-text is-live">{live.text}</div> : null}
          </article>
        ) : null}

        {error ? <p className="st-chat-error">{error}</p> : null}

        <div ref={bottom} />
      </div>

      <div className="st-composer">
        {problem ? <p className="st-composer-problem">{problem}</p> : null}

        <div className={`st-composer-box ${commandOn ? "is-command" : ""}`}>
          <textarea
            ref={area}
            value={value}
            rows={1}
            placeholder="Спросите Луру"
            onChange={(event) => {
              setValue(event.target.value);
              const element = event.target;
              element.style.height = "auto";
              element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
            }}
            onKeyDown={(event) => {
              /* Enter отправляет, Shift+Enter переносит строку. */
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

          <div className="st-composer-row">
            <button
              className="st-icon"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              title="Приложить файл или картинку"
              aria-label="Приложить файл"
            >
              <PlusIcon />
            </button>

            <button
              className={`st-icon ${commandOn ? "is-on" : ""}`}
              onClick={toggleCommand}
              disabled={busy}
              title={`Разбор по пайплайну: ${REPORT_COMMAND}`}
              aria-label="Режим разбора"
              aria-pressed={commandOn}
            >
              <SlashIcon />
            </button>

            <span className="st-composer-sep" aria-hidden="true" />

            <div className="st-chips">
              {attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`} className="st-chip">
                  <FileIcon />
                  <span className="st-chip-name">{attachment.name}</span>
                  <button
                    onClick={() => setAttachments((current) => current.filter((_, position) => position !== index))}
                    aria-label={`Убрать ${attachment.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            <span className="st-composer-gap" />

            <select
              className="st-model"
              value={model}
              onChange={(event) => onModel(event.target.value as LuraModel)}
              disabled={busy}
              aria-label="Модель"
            >
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

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

            {busy ? (
              <button className="st-send is-stop" onClick={onStop} title="Остановить" aria-label="Остановить">
                <StopIcon />
              </button>
            ) : (
              <button
                className="st-send"
                onClick={send}
                disabled={!value.trim()}
                title="Отправить"
                aria-label="Отправить"
              >
                <ArrowUpIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ToolList({ tools, running }: { tools: ToolTrace[]; running?: boolean }) {
  if (!tools.length) {
    return running ? <p className="st-tool-idle">Lura думает…</p> : null;
  }

  return (
    <div className="st-tools">
      {tools.map((trace, index) => (
        <div key={`${trace.name}-${index}`} className={`st-tool ${trace.ok ? "" : "is-failed"}`}>
          <span className="st-tool-name">{TOOL_LABEL[trace.name] ?? trace.name}</span>
          <span className="st-tool-arg" title={trace.argument}>
            {trace.argument}
          </span>
          <span className="st-tool-note">{trace.summary || (running ? "…" : "")}</span>
        </div>
      ))}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function SlashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
      <path d="M9.5 5.5 6.5 10.5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2H4.5v12h7V4.5z" />
      <path d="M9 2v2.5h2.5" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 12.5v-9M4 7.5 8 3.5l4 4" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="6" height="6" rx="1.2" />
    </svg>
  );
}
