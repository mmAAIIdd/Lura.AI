"use client";

import { useEffect, useRef, useState } from "react";

import type { StudioMessage, ToolTrace } from "@/lib/studio/types";

/**
 * Правая полоса — диалог с агентом.
 *
 * Здесь только разговор и работа инструментов: что спросили, куда агент
 * сходил, что нашёл. Сам отчёт живёт в центре и не уезжает вверх при
 * следующем вопросе. Такое разделение — общий приём у редакторов с ассистентом
 * и у чатов с артефактами: длинный результат в стороне, переписка узкой
 * колонкой рядом.
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
  model: string;
  onModel: (model: string) => void;
  onRerun: () => void;
  live: { text: string; tools: ToolTrace[]; model: string } | null;
  error: string | null;
  busy: boolean;
  selectedReport: string | null;
  runtime: { ready: boolean; models: string[]; search: string | null; storage?: string };
  onSelectReport: (messageId: string) => void;
  onSend: (prompt: string, attachments: ComposerAttachment[]) => void;
  onStop: () => void;
};

export function StudioChat({
  messages,
  model,
  onModel,
  onRerun,
  live,
  error,
  busy,
  selectedReport,
  runtime,
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

  const lastPrompt = [...messages].reverse().find((message) => message.role === "user");

  return (
    <section className="st-chat" aria-label="Диалог с агентом">
      <header className="st-chat-head">
        <h2>Диалог</h2>
        <div className="st-chat-badges">
          {lastPrompt ? (
            <button className="st-rerun" onClick={onRerun} disabled={busy} title="Повторить последний запрос">
              Перезапустить
            </button>
          ) : null}
          {!runtime.ready ? <span className="is-warn">нет ключа</span> : null}
        </div>
      </header>

      <div className="st-chat-stream" ref={stream}>
        {!messages.length && !live ? (
          <p className="st-chat-hint">Запрос и вложения — сюда.</p>
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
                className={`st-reply-card ${selectedReport === message.id ? "is-active" : ""}`}
                onClick={() => onSelectReport(message.id)}
              >
                <strong>Отчёт готов</strong>
                <span>
                  {message.text.length.toLocaleString("ru-RU")} символов
                  {message.tools?.length ? ` · ${message.tools.length} действий` : ""}
                </span>
              </button>
            </article>
          ),
        )}

        {live ? (
          <article className="st-reply">
            <ToolList tools={live.tools} running />
          </article>
        ) : null}

        {error ? <p className="st-chat-error">{error}</p> : null}

        <div ref={bottom} />
      </div>

      <div className="st-composer">
        {problem ? <p className="st-composer-problem">{problem}</p> : null}

        {attachments.length ? (
          <div className="st-chips">
            {attachments.map((attachment, index) => (
              <span key={`${attachment.name}-${index}`} className="st-chip">
                {attachment.name}
                <button
                  onClick={() => setAttachments((current) => current.filter((_, position) => position !== index))}
                  aria-label={`Убрать ${attachment.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="st-composer-box">
          <textarea
            ref={area}
            value={value}
            rows={2}
            placeholder="Что разобрать? Например: почему выросли жалобы на онбординг после релиза 2.4"
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
            <button className="st-attach" onClick={() => fileInput.current?.click()} disabled={busy}>
              Приложить
            </button>

            <select
              className="st-model"
              value={model}
              onChange={(event) => onModel(event.target.value)}
              disabled={busy}
              aria-label="Модель"
            >
              {runtime.models.map((name) => (
                <option key={name} value={name}>
                  {name.replace("gemini-", "")}
                </option>
              ))}
            </select>

            <span className="st-composer-gap" />
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
              <button className="st-send is-stop" onClick={onStop}>
                Остановить
              </button>
            ) : (
              <button className="st-send" onClick={send} disabled={!value.trim()}>
                Разобрать
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
    return running ? <p className="st-tool-idle">Агент планирует разбор…</p> : null;
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
