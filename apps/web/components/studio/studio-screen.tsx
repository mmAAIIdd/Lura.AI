"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StudioChat, type ComposerAttachment } from "@/components/studio/studio-chat";
import { StudioContext } from "@/components/studio/studio-context";
import { StudioRail } from "@/components/studio/studio-rail";
import { StudioReport } from "@/components/studio/studio-report";
import type { LuraModel, StudioThread, ToolTrace, WorkspaceState } from "@/lib/studio/types";

/**
 * Рабочее пространство: рельса, окно вывода и диалог.
 *
 * Состояние живёт здесь: все три панели — представления одного разговора, а
 * поток событий от агента один. Разводить его по компонентам значило бы
 * синхронизировать их между собой на каждом токене.
 */

const EMPTY: WorkspaceState = {
  documents: [],
  threads: [],
  runtime: { ready: true, models: ["lura-pro", "lura-fast"], search: null, storage: "" },
};

type Live = { text: string; tools: ToolTrace[] };
type View = "report" | "context";

/* Границы панелей. Уже нижней рельса перестаёт вмещать названия разборов,
   шире верхней — центр становится колонкой текста в пол-экрана. */
const RAIL = { min: 190, max: 460, initial: 248 };
const CHAT = { min: 300, max: 720, initial: 400 };
const WIDTHS_KEY = "lura.studio.widths";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function StudioScreen() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY);
  const [thread, setThread] = useState<StudioThread | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("report");
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [model, setModel] = useState<LuraModel>("lura-pro");
  const [railOpen, setRailOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [railWidth, setRailWidth] = useState(RAIL.initial);
  const [chatWidth, setChatWidth] = useState(CHAT.initial);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/studio/workspace", { cache: "no-store" });
    if (response.ok) {
      setWorkspace((await response.json()) as WorkspaceState);
      return;
    }
    /* Молча пустое пространство выглядит как «документов нет», хотя на самом
       деле их некуда положить. */
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) setError(body.error);
  }, []);

  const openThread = useCallback(async (id: string) => {
    const response = await fetch(`/api/studio/threads/${id}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { thread: StudioThread };
    setThread(body.thread);
    setView("report");
    setError(null);
    /* Открывая разбор, показываем его последний ответ: он и есть результат. */
    const last = [...body.thread.messages].reverse().find((message) => message.role === "agent");
    setSelectedReport(last?.id ?? null);
  }, []);

  useEffect(() => {
    void refresh();
    /* Ссылка открывает то, что в ней указано: конкретный разбор или экран
       контекста. Готовый отчёт нужно уметь переслать, а не пересказывать. */
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "context") setView("context");
    const wanted = params.get("thread");
    if (wanted) void openThread(wanted);
  }, [refresh, openThread]);

  /* Ширины панелей — настройка рабочего места, а не состояние документа:
     живут в браузере и переживают перезагрузку. Чтение только после
     монтирования, иначе разметка на сервере и в браузере разойдётся. */
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? "null") as
        | { rail?: number; chat?: number }
        | null;
      if (saved?.rail) setRailWidth(clamp(saved.rail, RAIL.min, RAIL.max));
      if (saved?.chat) setChatWidth(clamp(saved.chat, CHAT.min, CHAT.max));
    } catch {
      /* Хранилище может быть недоступно — тогда просто ширины по умолчанию. */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTHS_KEY, JSON.stringify({ rail: railWidth, chat: chatWidth }));
    } catch {
      /* Не сохранилось — не повод ломать экран. */
    }
  }, [railWidth, chatWidth]);

  const messages = thread?.messages ?? [];
  const reports = messages.filter((message) => message.role === "agent");
  const shown =
    reports.find((message) => message.id === selectedReport) ?? reports[reports.length - 1] ?? null;
  const business = workspace.documents.find((document) => document.kind === "business");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        setThread(null);
        setSelectedReport(null);
        setView("report");
      } else if (key === "b") {
        event.preventDefault();
        setRailOpen((open) => !open);
      } else if (key === "j") {
        event.preventDefault();
        setChatOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Перетаскивание границы.
   *
   * Слушатели вешаются на окно, а не на саму границу: курсор при быстром
   * движении уходит с шестипиксельной полоски раньше, чем приходит событие, и
   * перетаскивание обрывалось на середине.
   */
  function startResize(event: React.PointerEvent, side: "rail" | "chat") {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "rail" ? railWidth : chatWidth;

    const move = (moved: PointerEvent) => {
      const delta = moved.clientX - startX;
      if (side === "rail") setRailWidth(clamp(startWidth + delta, RAIL.min, RAIL.max));
      else setChatWidth(clamp(startWidth - delta, CHAT.min, CHAT.max));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("st-resizing");
    };

    document.body.classList.add("st-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  /** Границу можно двигать и с клавиатуры: мышь есть не у всех. */
  function resizeByKey(event: React.KeyboardEvent, side: "rail" | "chat") {
    const step = event.shiftKey ? 40 : 12;
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    if (side === "rail") setRailWidth((width) => clamp(width + direction * step, RAIL.min, RAIL.max));
    else setChatWidth((width) => clamp(width - direction * step, CHAT.min, CHAT.max));
  }

  async function upload(files: File[], asBusiness: boolean) {
    setError(null);
    const form = new FormData();
    for (const file of files) form.append("files", file);
    form.append("kind", asBusiness ? "business" : "source");

    const response = await fetch("/api/studio/documents", { method: "POST", body: form });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Документ не загрузился.");
      return;
    }
    await refresh();
  }

  async function uploadUrl(url: string, asBusiness: boolean) {
    setError(null);
    const response = await fetch("/api/studio/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, kind: asBusiness ? "business" : "source" }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Ссылка не загрузилась.");
      return;
    }
    await refresh();
  }

  async function run(prompt: string, attachments: ComposerAttachment[]) {
    setBusy(true);
    setError(null);
    setView("report");
    setLive({ text: "", tools: [] });

    /* Свой запрос показывается сразу: иначе между нажатием и первым событием
       экран выглядит так, будто ничего не приняли. */
    const base: StudioThread = thread ?? {
      id: "",
      title: prompt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    setThread({
      ...base,
      messages: [
        ...base.messages,
        {
          id: `local-${Date.now()}`,
          role: "user",
          text: prompt,
          createdAt: new Date().toISOString(),
          attachments: attachments.map((attachment) => ({ name: attachment.name, mime: attachment.mimeType })),
        },
      ],
    });

    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await fetch("/api/studio/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread?.id || undefined, prompt, model, attachments }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Сервер ответил ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          if (!frame.startsWith("data:")) continue;

          const event = JSON.parse(frame.slice(5).trim()) as
            | { type: "model"; model: LuraModel }
            | { type: "mode"; mode: "chat" | "report" }
            | { type: "text"; text: string }
            | { type: "tool"; phase: "start" | "done"; trace: ToolTrace }
            | { type: "done"; thread: StudioThread }
            | { type: "error"; message: string };

          if (event.type === "text") {
            setLive((current) => (current ? { ...current, text: current.text + event.text } : current));
          } else if (event.type === "tool") {
            setLive((current) => {
              if (!current) return current;
              const tools = [...current.tools];
              if (event.phase === "start") tools.push(event.trace);
              else {
                const position = tools.findIndex(
                  (trace) => trace.name === event.trace.name && trace.argument === event.trace.argument && !trace.summary,
                );
                if (position >= 0) tools[position] = event.trace;
                else tools.push(event.trace);
              }
              return { ...current, tools };
            });
          } else if (event.type === "done") {
            setThread(event.thread);
            const last = [...event.thread.messages].reverse().find((message) => message.role === "agent");
            setSelectedReport(last?.id ?? null);
            setLive(null);
            void refresh();
          } else if (event.type === "error") {
            setError(event.message);
            setLive(null);
          }
        }
      }
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") {
        setError(caught instanceof Error ? caught.message : "Ответ прервался.");
      }
      setLive(null);
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  return (
    <div
      className={`st ${railOpen ? "" : "no-rail"} ${chatOpen ? "" : "no-chat"}`}
      style={
        {
          "--st-rail-w": railOpen ? `${railWidth}px` : "0px",
          "--st-chat-w": chatOpen ? `${chatWidth}px` : "0px",
          "--st-grip-l": railOpen ? "6px" : "0px",
          "--st-grip-r": chatOpen ? "6px" : "0px",
        } as React.CSSProperties
      }
    >
      <StudioRail
        threads={workspace.threads}
        activeThread={thread?.id ?? null}
        view={view}
        busy={busy}
        ready={workspace.runtime.ready}
        model={model}
        search={workspace.runtime.search}
        documents={workspace.documents.length}
        hasBusinessDoc={Boolean(business)}
        railOpen={railOpen}
        chatOpen={chatOpen}
        answer={shown ? { text: shown.text, artifactId: shown.artifactId } : null}
        onToggleRail={() => setRailOpen((open) => !open)}
        onToggleChat={() => setChatOpen((open) => !open)}
        onNewThread={() => {
          setThread(null);
          setSelectedReport(null);
          setError(null);
          setView("report");
        }}
        onOpenThread={(id) => {
          void openThread(id);
          window.history.replaceState(null, "", `/studio?thread=${id}`);
        }}
        onOpenContext={() => {
          setView("context");
          window.history.replaceState(null, "", "/studio?view=context");
        }}
        onRenameThread={async (id, title) => {
          await fetch(`/api/studio/threads/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          });
          if (thread?.id === id) setThread({ ...thread, title });
          await refresh();
        }}
        onDeleteThread={async (id) => {
          await fetch(`/api/studio/threads/${id}`, { method: "DELETE" });
          if (thread?.id === id) {
            setThread(null);
            setSelectedReport(null);
          }
          await refresh();
        }}
      />

      <div
        className="st-grip is-rail"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ширина панели управления"
        tabIndex={railOpen ? 0 : -1}
        onPointerDown={(event) => startResize(event, "rail")}
        onKeyDown={(event) => resizeByKey(event, "rail")}
      />

      <main className="st-main">
        {view === "context" ? (
          <StudioContext
            documents={workspace.documents}
            busy={busy}
            onUpload={upload}
            onUploadUrl={uploadUrl}
            onMakeBusiness={async (id) => {
              await fetch(`/api/studio/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "business" }),
              });
              await refresh();
            }}
            onDelete={async (id) => {
              await fetch(`/api/studio/documents/${id}`, { method: "DELETE" });
              await refresh();
            }}
          />
        ) : (
          <StudioReport message={shown} streaming={live} />
        )}
      </main>

      <div
        className="st-grip is-chat"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ширина диалога"
        tabIndex={chatOpen ? 0 : -1}
        onPointerDown={(event) => startResize(event, "chat")}
        onKeyDown={(event) => resizeByKey(event, "chat")}
      />

      <StudioChat
        messages={messages}
        live={live}
        error={error}
        busy={busy}
        selectedReport={shown?.id ?? null}
        models={workspace.runtime.models}
        onSelectReport={(id) => {
          setSelectedReport(id);
          setView("report");
        }}
        model={model}
        onModel={setModel}
        onSend={(prompt, attachments) => void run(prompt, attachments)}
        onStop={() => abort.current?.abort()}
      />

      {/* Свёрнутую панель нужно чем-то вернуть: кнопка, которая её прячет,
          уезжает вместе с ней. */}
      {!railOpen ? (
        <button className="st-reveal is-left" onClick={() => setRailOpen(true)} title="Ctrl+B">
          <ChevronIcon />
          <span className="st-reveal-label">Панель</span>
        </button>
      ) : null}
      {!chatOpen ? (
        <button className="st-reveal is-right" onClick={() => setChatOpen(true)} title="Ctrl+J">
          <span className="st-reveal-label">Диалог</span>
          <ChevronIcon flip />
        </button>
      ) : null}
    </div>
  );
}

function ChevronIcon({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={flip ? { transform: "rotate(180deg)" } : undefined}
      aria-hidden="true"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}
