"use client";

import { useEffect, useRef, useState } from "react";

import { LuraLogo } from "@/components/lura-logo";
import {
  ChatIcon,
  ClipIcon,
  CloseIcon,
  CommandIcon,
  ExitIcon,
  HistoryIcon,
  LayersIcon,
  NewIcon,
  PanelIcon,
  PencilIcon,
  SearchIcon,
  SendIcon,
  StopIcon,
  TrashIcon,
} from "@/components/studio/icons";
import { ModelPicker } from "@/components/studio/model-picker";
import { REPORT_COMMAND } from "@/lib/studio/command";
import { cx } from "@/lib/studio/cx";
import type { LuraModel, StudioMessage, ThreadSummary, ToolTrace } from "@/lib/studio/types";

/**
 * Боковая панель — единственная в интерфейсе.
 *
 * Раньше управление было слева, а разговор справа, и глаз ходил через весь
 * экран между двумя узкими колонками. Теперь всё, кроме самого ответа, живёт
 * здесь: шапка с действиями, две вкладки — переписка и список разборов — и
 * поле ввода внизу. Центр остался тем, ради чего всё и затевалось: ответом.
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

type Tab = "chat" | "threads";

/**
 * Ответ для строки диалога.
 *
 * В переписке идёт разговор, а не документ: решётки заголовков, звёздочки
 * жирного и палки таблиц читаются здесь как мусор. Размеченный ответ целиком
 * лежит в центре — сюда попадает то же самое человеческим текстом.
 */
function plainPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}\|.*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*_]{3,}\s*$/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "• ")
    .replace(/^\s{0,3}\d+\.\s+/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/__([\s\S]*?)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

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
  threads: ThreadSummary[];
  activeThread: string | null;
  view: "report" | "context";
  model: LuraModel;
  models: LuraModel[];
  live: { text: string; tools: ToolTrace[] } | null;
  error: string | null;
  busy: boolean;
  ready: boolean;
  ephemeral: boolean;
  selectedReport: string | null;
  onModel: (model: LuraModel) => void;
  onSelectReport: (messageId: string) => void;
  onSend: (prompt: string, attachments: ComposerAttachment[]) => void;
  onStop: () => void;
  onCollapse: () => void;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onOpenContext: () => void;
  onRenameThread: (id: string, title: string) => void;
  onDeleteThread: (id: string) => void;
};

export function StudioPanel({
  messages,
  threads,
  activeThread,
  view,
  model,
  models,
  live,
  error,
  busy,
  ready,
  ephemeral,
  selectedReport,
  onModel,
  onSelectReport,
  onSend,
  onStop,
  onCollapse,
  onNewThread,
  onOpenThread,
  onOpenContext,
  onRenameThread,
  onDeleteThread,
}: Props) {
  const [tab, setTab] = useState<Tab>("chat");
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
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
  }, [tab]);

  useEffect(() => {
    stick.current = true;
  }, [messages.length]);

  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live?.tools.length, live?.text, tab]);

  /* Ctrl+K ведёт к поиску по разборам — вместе с переключением на вкладку,
     где он живёт: иначе сочетание срабатывало бы вхолостую. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setTab("threads");
      window.setTimeout(() => searchField.current?.focus(), 0);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    /* Отправка всегда возвращает к переписке: ответ придёт туда, и оставлять
       пользователя на списке разборов значило бы спрятать от него результат. */
    setTab("chat");
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

  function commitRename(id: string) {
    const title = draft.trim();
    setEditing(null);
    if (title) onRenameThread(id, title);
  }

  const needle = query.trim().toLowerCase();
  const visibleThreads = needle
    ? threads.filter((thread) => thread.title.toLowerCase().includes(needle))
    : threads;

  return (
    <section className="st-panel" aria-label="Панель Lura">
      <header className="st-panel-head">
        <div className="st-brand">
          <LuraLogo className="st-brand-logo" />
          <span>Lura</span>
        </div>

        <div className="st-panel-actions">
          <button
            className="st-act"
            onClick={() => {
              setTab("chat");
              onNewThread();
            }}
            disabled={busy}
            title="Новый разбор — Ctrl N"
            aria-label="Новый разбор"
          >
            <NewIcon />
          </button>
          <button
            className={cx("st-act", view === "context" && "is-on")}
            onClick={onOpenContext}
            title="Кастомизация: документы о бизнесе и источники"
            aria-label="Кастомизация"
            aria-pressed={view === "context"}
          >
            <LayersIcon />
          </button>
          <button
            className="st-act"
            onClick={async () => {
              await fetch("/auth/signout", { method: "POST" });
              window.location.href = "/register";
            }}
            title="Выйти"
            aria-label="Выйти"
          >
            <ExitIcon />
          </button>

          <span className="st-act-split" aria-hidden="true" />

          <button className="st-act" onClick={onCollapse} title="Скрыть панель — Ctrl J" aria-label="Скрыть панель">
            <PanelIcon />
          </button>
        </div>
      </header>

      <div className="st-tabs" role="tablist" aria-label="Содержимое панели">
        <button
          role="tab"
          aria-selected={tab === "chat"}
          className={cx("st-tab", tab === "chat" && "is-on")}
          onClick={() => setTab("chat")}
        >
          <ChatIcon />
          <span>Чат</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "threads"}
          className={cx("st-tab", tab === "threads" && "is-on")}
          onClick={() => setTab("threads")}
        >
          <HistoryIcon />
          <span>Разборы</span>
          {threads.length ? <em>{threads.length}</em> : null}
        </button>
      </div>

      {tab === "chat" ? (
        <div className="st-stream" ref={stream}>
          {!ready ? (
            <p className="st-warn">
              Не задан ключ модели — ответы не запускаются. Добавьте GEMINI_API_KEY в переменные окружения
              и пересоберите приложение.
            </p>
          ) : null}
          {ephemeral ? (
            <p className="st-warn">
              Хранилище временное: документы и разборы пропадут при перезапуске. Задайте STUDIO_DATABASE_URL,
              чтобы они сохранялись.
            </p>
          ) : null}

          {!messages.length && !live ? (
            <p className="st-hint">
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
                  className={cx("st-reply-text", selectedReport === message.id && "is-active")}
                  onClick={() => onSelectReport(message.id)}
                  title="Показать в центре"
                >
                  {plainPreview(message.text)}
                </button>
              </article>
            ),
          )}

          {live ? (
            <article className="st-reply">
              <ToolList tools={live.tools} running />
              {live.text ? <div className="st-reply-text is-live">{plainPreview(live.text)}</div> : null}
            </article>
          ) : null}

          {error ? <p className="st-error">{error}</p> : null}

          <div ref={bottom} />
        </div>
      ) : (
        <div className="st-stream">
          <div className="st-search">
            <SearchIcon />
            <input
              ref={searchField}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по разборам"
              aria-label="Поиск по разборам"
            />
            {query ? (
              <button onClick={() => setQuery("")} aria-label="Очистить">
                <CloseIcon />
              </button>
            ) : null}
          </div>

          {visibleThreads.length ? (
            <div className="st-thread-list">
              {visibleThreads.map((thread) =>
                editing === thread.id ? (
                  <input
                    key={thread.id}
                    className="st-thread-edit"
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commitRename(thread.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename(thread.id);
                      if (event.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <div
                    key={thread.id}
                    className={cx("st-thread", activeThread === thread.id && "is-active")}
                  >
                    <button
                      className="st-thread-open"
                      onClick={() => {
                        onOpenThread(thread.id);
                        setTab("chat");
                      }}
                      disabled={busy}
                      title={thread.title}
                    >
                      <span className="st-thread-title">{thread.title}</span>
                      <span className="st-thread-meta">{thread.messages} сообщений</span>
                    </button>

                    <span className="st-thread-tools">
                      <button
                        onClick={() => {
                          setEditing(thread.id);
                          setDraft(thread.title);
                        }}
                        title="Переименовать"
                        aria-label="Переименовать"
                      >
                        <PencilIcon />
                      </button>
                      <button onClick={() => onDeleteThread(thread.id)} title="Удалить" aria-label="Удалить">
                        <TrashIcon />
                      </button>
                    </span>
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="st-hint">{needle ? "Ничего не нашлось." : "Разборов пока нет."}</p>
          )}
        </div>
      )}

      <div className="st-composer">
        {problem ? <p className="st-composer-problem">{problem}</p> : null}

        <div className={cx("st-composer-box", commandOn && "is-command")}>
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
              <ClipIcon />
            </button>

            <button
              className={cx("st-icon", commandOn && "is-on")}
              onClick={toggleCommand}
              disabled={busy}
              title={`Разбор по пайплайну: ${REPORT_COMMAND}`}
              aria-label="Режим разбора"
              aria-pressed={commandOn}
            >
              <CommandIcon />
            </button>

            <span className="st-composer-sep" aria-hidden="true" />

            <div className="st-chips">
              {attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`} className="st-chip">
                  <span className="st-chip-name">{attachment.name}</span>
                  <button
                    onClick={() => setAttachments((current) => current.filter((_, position) => position !== index))}
                    aria-label={`Убрать ${attachment.name}`}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>

            <span className="st-composer-gap" />

            <ModelPicker value={model} options={models} disabled={busy} onChange={onModel} />

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
                <SendIcon />
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
        <div key={`${trace.name}-${index}`} className={cx("st-tool", !trace.ok && "is-failed")}>
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
