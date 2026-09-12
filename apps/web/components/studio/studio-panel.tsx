"use client";

import { useEffect, useRef, useState } from "react";

import {
  ClipIcon,
  CloseIcon,
  ExitIcon,
  LayersIcon,
  NewIcon,
  PanelIcon,
  SendIcon,
  StopIcon,
} from "@/components/studio/icons";
import { ModelPicker } from "@/components/studio/model-picker";
import { ReportMarkdown } from "@/components/studio/report-markdown";
import { REPORT_COMMAND, parsePrompt } from "@/lib/studio/command";
import { cx } from "@/lib/studio/cx";
import type { LuraModel, RunMode, StudioDocument, StudioMessage, ToolTrace } from "@/lib/studio/types";

/**
 * Обсуждение — правая колонка.
 *
 * Здесь разговор с Lura: переписка и поле ввода. Короткий ответ живёт здесь
 * целиком, отчёт открывается в центре. Список разборов и файлы проекта — в
 * левой колонке: они про проект, а не про разговор.
 *
 * Полный разбор включается кнопкой «Разбор» у поля ввода, а материалы, на
 * которых Lura отвечает, открываются кнопкой в шапке. Про состав материалов
 * говорит первая строка переписки: переоценить доступ агента к данным — значит
 * поверить ответу, у которого нет опоры.
 */

export type ComposerAttachment = { name: string; mimeType: string; data: string; text?: string };

/* Предел на все вложения разом. Тело запроса на бессерверной площадке
   ограничено примерно 4.5 МБ, а base64 раздувает данные на треть — поэтому
   считается сумма, а не размер отдельного файла. */
const MAX_ATTACHMENTS_TOTAL_BYTES = 3 * 1024 * 1024;

const TOOL_LABEL: Record<string, string> = {
  web_search: "Ищет в интернете",
  fetch_url: "Читает страницу",
  search_documents: "Ищет в материалах",
  read_document: "Читает материал",
  analyze_table: "Считает показатели",
  count_groups: "Считает темы",
  list_project: "Смотрит файлы проекта",
  read_project_file: "Открывает файл",
  create_folder: "Создаёт папку",
  write_project_file: "Записывает файл",
};

/** Отчёт в переписке — одной-двумя фразами без разметки: целиком он лежит в центре. */
function brief(markdown: string, limit = 180): string {
  const flat = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}\|.*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= limit) return flat;
  const window = flat.slice(0, limit + 60);
  const stop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  return stop > 60 ? window.slice(0, stop + 1) : `${flat.slice(0, limit).trimEnd()}…`;
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
  live: { text: string; tools: ToolTrace[]; mode: RunMode | null } | null;
  error: string | null;
  busy: boolean;
  ready: boolean;
  ephemeral: boolean;
  loaded: boolean;
  /** Материалы, отмеченные для ответа. */
  sources: StudioDocument[];
  /** Сколько материалов загружено всего. */
  materials: number;
  model: LuraModel;
  models: LuraModel[];
  selectedReport: string | null;
  onModel: (model: LuraModel) => void;
  onSelectReport: (messageId: string) => void;
  onSend: (prompt: string, attachments: ComposerAttachment[]) => void;
  onStop: () => void;
  onCollapse: () => void;
  onNewThread: () => void;
  onOpenMaterials: () => void;
};

export function StudioPanel({
  messages,
  live,
  error,
  busy,
  ready,
  ephemeral,
  loaded,
  sources,
  materials,
  model,
  models,
  selectedReport,
  onModel,
  onSelectReport,
  onSend,
  onStop,
  onCollapse,
  onNewThread,
  onOpenMaterials,
}: Props) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  /* Полный разбор включается подписанной кнопкой у поля ввода: команду
     «/lur manager-dev start» нельзя ни запомнить, ни набрать без ошибки. */
  const [report, setReport] = useState(false);

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
          `«${file.name}» не помещается: на вложения к одному сообщению отведено 3 МБ. ` +
            "Большой файл загрузите в «Материалы» слева.",
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
    onSend(report ? `${REPORT_COMMAND} ${prompt}` : prompt, attachments);
    setValue("");
    setAttachments([]);
    /* Режим разбора снимается после отправки: он стоит минут работы, и
       случайно уехать в него следующим вопросом нельзя. */
    setReport(false);
    if (area.current) area.current.style.height = "auto";
  }

  /* Приветствие говорит о фактическом контексте, а не о приложении вообще:
     «источники не выбраны» — только когда список материалов уже получен. */
  const greeting = !loaded
    ? null
    : !materials
      ? "Материалов пока нет. Загрузите их кнопкой «Материалы» в шапке — и спрашивайте по ним."
      : !sources.length
        ? "Ни один материал не отмечен для ответов. Отметьте нужные в «Материалах»."
        : `Спросите по материалам (${sources.length} из ${materials}) — ответ придёт сюда. Для отчёта включите «Разбор» у поля ввода.`;

  return (
    <section className="st-panel" aria-label="Обсуждение">
      <header className="st-panel-head">
        <h2 className="st-panel-title">Обсуждение</h2>

        <div className="st-panel-actions">
          <button
            type="button"
            className="st-act"
            onClick={onNewThread}
            disabled={busy}
            aria-label="Новый разговор"
            data-tip="Новый разговор · Ctrl N"
          >
            <NewIcon />
          </button>
          <button
            type="button"
            className="st-act"
            onClick={onOpenMaterials}
            aria-label="Материалы: файлы и ссылки для ответов"
            data-tip="Материалы"
          >
            <LayersIcon />
          </button>
          <button
            type="button"
            className="st-act"
            onClick={async () => {
              await fetch("/auth/signout", { method: "POST" });
              window.location.href = "/register";
            }}
            aria-label="Выйти из аккаунта"
            data-tip="Выйти из аккаунта"
          >
            <ExitIcon />
          </button>

          <span className="st-act-split" aria-hidden="true" />

          <button
            type="button"
            className="st-act"
            onClick={onCollapse}
            aria-label="Скрыть обсуждение"
            data-tip="Скрыть · Ctrl J"
          >
            <PanelIcon />
          </button>
        </div>
      </header>

      <div className="st-stream" ref={stream}>
        {!ready ? (
          <p className="st-warn">
            Ответы не запускаются: у рабочего пространства не настроена модель. Нужен GEMINI_API_KEY в переменных
            окружения.
          </p>
        ) : null}
        {ephemeral ? (
          <p className="st-warn">
            Хранилище временное: материалы и разборы пропадут при перезапуске. Задайте STUDIO_DATABASE_URL, чтобы они
            сохранялись.
          </p>
        ) : null}

        {!messages.length && !live && greeting ? <p className="st-hint">{greeting}</p> : null}

        {messages.map((message) => {
          if (message.role === "user") {
            const parsed = parsePrompt(message.text);
            return (
              <article className="st-said" key={message.id}>
                {parsed.mode === "report" ? <span className="st-said-kind">Разбор</span> : null}
                <p>{parsed.text || parsed.raw}</p>
                {message.attachments?.length ? (
                  <div className="st-said-files">
                    {message.attachments.map((file) => (
                      <span key={file.name}>{file.name}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          }
          return (
            <Reply
              key={message.id}
              message={message}
              active={selectedReport === message.id}
              onSelect={() => onSelectReport(message.id)}
            />
          );
        })}

        {live ? (
          <article className="st-reply">
            {live.mode === "report" ? (
              <p className="st-reply-state" role="status">
                Разбор выполняется — ход работы виден в центре.
              </p>
            ) : (
              <>
                <ToolList tools={live.tools} running />
                {live.text ? (
                  <div className="st-reply-body">
                    <ReportMarkdown source={live.text} />
                  </div>
                ) : null}
              </>
            )}
          </article>
        ) : null}

        {error ? (
          <p className="st-error" role="alert">
            {error}
          </p>
        ) : null}

        <div ref={bottom} />
      </div>

      <div className="st-composer">
        {problem ? (
          <p className="st-composer-problem" role="alert">
            {problem}
          </p>
        ) : null}

        <div className={cx("st-composer-box", report && "is-report")}>
          <textarea
            ref={area}
            value={value}
            rows={1}
            placeholder={report ? "Что разобрать? Например: как встретили релиз 5.2" : "Спросите Lura"}
            aria-label={report ? "Что разобрать" : "Сообщение для Lura"}
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

          {attachments.length ? (
            <div className="st-chips" aria-label="Вложения к этому сообщению">
              <span className="st-chips-label">Вложения:</span>
              {attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`} className="st-chip">
                  <span className="st-chip-name">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((_, position) => position !== index))}
                    aria-label={`Убрать вложение «${attachment.name}»`}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="st-composer-row">
            <button
              type="button"
              className="st-icon"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              aria-label="Приложить файл или картинку к сообщению"
              data-tip="Приложить к сообщению"
            >
              <ClipIcon />
            </button>

            <button
              type="button"
              className={cx("st-mode", report && "is-on")}
              onClick={() => setReport((on) => !on)}
              disabled={busy}
              aria-pressed={report}
              data-tip="Полный разбор с отчётом, несколько минут"
            >
              Разбор
            </button>

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
              <button type="button" className="st-send is-stop" onClick={onStop} aria-label="Остановить ответ" data-tip="Остановить">
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                className="st-send"
                onClick={send}
                disabled={!value.trim()}
                aria-label="Отправить сообщение"
                data-tip="Отправить · Enter"
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

function Reply({
  message,
  active,
  onSelect,
}: {
  message: StudioMessage;
  active: boolean;
  onSelect: () => void;
}) {
  /* Разговорный ответ в центр не уходит, поэтому здесь он целиком и с
     разметкой: список или маленькая таблица без неё превращаются в кашу. */
  if (message.mode === "chat") {
    return (
      <article className="st-reply">
        <ToolList tools={message.tools ?? []} />
        <div className="st-reply-body">
          <ReportMarkdown source={message.text} />
        </div>
      </article>
    );
  }

  return (
    <article className="st-reply">
      <button
        type="button"
        className={cx("st-reply-report", active && "is-active")}
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
      >
        <span className="st-reply-kind">Отчёт готов</span>
        <span className="st-reply-brief">{brief(message.text)}</span>
        <span className="st-reply-more">{active ? "Открыт в центре" : "Открыть отчёт"}</span>
      </button>
    </article>
  );
}

function ToolList({ tools, running }: { tools: ToolTrace[]; running?: boolean }) {
  if (!tools.length) {
    return running ? (
      <p className="st-tool-idle" role="status">
        Lura думает…
      </p>
    ) : null;
  }

  return (
    <div className="st-tools">
      {tools.map((trace, index) => (
        <div key={`${trace.name}-${index}`} className={cx("st-tool", !trace.ok && "is-failed")}>
          <span className="st-tool-name">{TOOL_LABEL[trace.name] ?? trace.name}</span>
          {trace.argument ? (
            <span className="st-tool-arg" title={trace.argument}>
              {trace.argument}
            </span>
          ) : null}
          <span className="st-tool-note">{trace.summary || (running ? "…" : "")}</span>
        </div>
      ))}
    </div>
  );
}
