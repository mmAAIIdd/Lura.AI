"use client";

import { useEffect, useRef, useState } from "react";

import { ReportMarkdown } from "@/components/studio/report-markdown";
import type { StudioMessage, StudioMode, StudioThread, ToolTrace } from "@/lib/studio/types";

/**
 * Окно вывода: всё, что агент нашёл, разобрал и написал.
 *
 * Работа инструментов показывается по ходу дела, а не прячется за спиннер:
 * разбор с поиском и чтением страниц идёт минуты, и пользователь должен
 * видеть, куда агент сходил, — иначе непонятно, откуда взялся вывод.
 */

const TOOL_LABEL: Record<string, string> = {
  web_search: "Поиск",
  fetch_url: "Читает",
  search_documents: "Документы",
};

const MODE_TITLE: Record<StudioMode, string> = {
  reports: "Отчёты",
  updates: "Обновления",
};

const STARTERS: Record<StudioMode, string[]> = {
  reports: [
    "Что раздражает пользователей в нашем онбординге — найди отзывы и подтверди цифрами",
    "Стоит ли нам браться за интеграции? Докажи или опровергни",
  ],
  updates: [
    "Отчёт по последнему релизу: что изменилось и что было после",
    "Сравни две последние версии и реакцию на них",
  ],
};

type Props = {
  mode: StudioMode;
  thread: StudioThread | null;
  live: { text: string; tools: ToolTrace[]; model: string } | null;
  error: string | null;
  runtime: { ready: boolean; models: string[]; search: string | null; storage?: string };
  onStarter: (prompt: string) => void;
};

export function StudioOutput({ mode, thread, live, error, runtime, onStarter }: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  const messages = thread?.messages ?? [];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live?.text, live?.tools.length]);

  const empty = !messages.length && !live && !error;

  /* Показываем ту модель, которая реально отвечала: у 3.1 pro на бесплатном
     тарифе нулевая квота, и клиент спускается по цепочке. Написать в шапке
     основную модель значило бы соврать про то, кто считал отчёт. */
  let lastModel = "";
  for (const message of messages) if (message.model) lastModel = message.model;
  const model = live?.model || lastModel || runtime.models[0] || "—";

  return (
    <div className="st-output">
      <header className="st-output-head">
        <h1>{MODE_TITLE[mode]}</h1>
        <div className="st-badges">
          <span className="st-badge">{model}</span>
          {runtime.search ? <span className="st-badge st-badge-quiet">поиск: {runtime.search}</span> : null}
          {runtime.storage ? <span className="st-badge st-badge-quiet">{runtime.storage}</span> : null}
          {!runtime.ready ? <span className="st-badge st-badge-warn">нет ключа Gemini</span> : null}
        </div>
      </header>

      <div className="st-stream">
        {empty ? (
          <div className="st-starters">
            <p>
              {mode === "updates"
                ? "Разбор релиза: что изменилось, что произошло после и что с этим делать."
                : "Разбор по данным: агент ищет, читает источники и доказывает вывод."}
            </p>
            {STARTERS[mode].map((starter) => (
              <button key={starter} onClick={() => onStarter(starter)}>
                {starter}
              </button>
            ))}
          </div>
        ) : null}

        {messages.map((message) =>
          message.role === "user" ? (
            <UserBlock key={message.id} message={message} />
          ) : (
            <AgentBlock key={message.id} message={message} />
          ),
        )}

        {live ? (
          <article className="st-agent">
            <ToolTimeline tools={live.tools} running />
            {live.text ? <ReportMarkdown source={live.text} /> : <p className="st-thinking">Агент работает…</p>}
          </article>
        ) : null}

        {error ? <p className="st-error">{error}</p> : null}

        <div ref={bottom} />
      </div>
    </div>
  );
}

function UserBlock({ message }: { message: StudioMessage }) {
  return (
    <article className="st-user">
      <p>{message.text}</p>
      {message.attachments?.length ? (
        <div className="st-user-files">
          {message.attachments.map((attachment) => (
            <span key={attachment.name}>{attachment.name}</span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function AgentBlock({ message }: { message: StudioMessage }) {
  const [copied, setCopied] = useState(false);

  return (
    <article className="st-agent">
      <ToolTimeline tools={message.tools ?? []} />
      <ReportMarkdown source={message.text} />
      <footer className="st-agent-actions">
        {message.artifactId ? (
          <a href={`/api/studio/artifacts/${message.artifactId}`} download>
            Скачать .md
          </a>
        ) : null}
        <button
          onClick={() => {
            void navigator.clipboard.writeText(message.text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Скопировано" : "Копировать"}
        </button>
        {message.model ? <span>{message.model}</span> : null}
      </footer>
    </article>
  );
}

function ToolTimeline({ tools, running }: { tools: ToolTrace[]; running?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;

  const visible = open ? tools : tools.slice(-3);

  return (
    <div className="st-tools">
      {tools.length > 3 ? (
        <button className="st-tools-toggle" onClick={() => setOpen((value) => !value)}>
          {open ? "свернуть" : `показать все ${tools.length}`}
        </button>
      ) : null}
      {visible.map((trace, index) => (
        <div key={`${trace.name}-${index}`} className={`st-tool ${trace.ok ? "" : "is-failed"}`}>
          <span className="st-tool-name">{TOOL_LABEL[trace.name] ?? trace.name}</span>
          <span className="st-tool-arg" title={trace.argument}>
            {trace.argument}
          </span>
          <span className="st-tool-summary">{trace.summary || (running ? "…" : "")}</span>
        </div>
      ))}
    </div>
  );
}
