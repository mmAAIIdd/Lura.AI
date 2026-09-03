"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PanelIcon } from "@/components/studio/icons";
import { cx } from "@/lib/studio/cx";
import { StudioContext } from "@/components/studio/studio-context";
import { StudioPanel, type ComposerAttachment } from "@/components/studio/studio-panel";
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
  runtime: { ready: true, models: ["lura-pro", "lura-fast"], search: null, storage: "", ephemeral: false },
};

type Live = { text: string; tools: ToolTrace[] };
type View = "report" | "context";

/* Границы панели. Уже нижней в ней не помещаются ни названия разборов, ни
   поле ввода; шире верхней — центр становится колонкой текста в пол-экрана. */
const PANEL = { min: 340, max: 760, initial: 440 };
const WIDTH_KEY = "lura.studio.panel";

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
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(PANEL.initial);
  const abort = useRef<AbortController | null>(null);
  const shell = useRef<HTMLDivElement>(null);

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

  /* Ширина панели — настройка рабочего места, а не состояние документа:
     живёт в браузере и переживает перезагрузку. Чтение только после
     монтирования, иначе разметка на сервере и в браузере разойдётся. */
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved) setPanelWidth(clamp(saved, PANEL.min, PANEL.max));
    } catch {
      /* Хранилище может быть недоступно — тогда просто ширина по умолчанию. */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(panelWidth));
    } catch {
      /* Не сохранилось — не повод ломать экран. */
    }
  }, [panelWidth]);

  const messages = thread?.messages ?? [];
  const reports = messages.filter((message) => message.role === "agent");
  const shown =
    reports.find((message) => message.id === selectedReport) ?? reports[reports.length - 1] ?? null;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        setThread(null);
        setSelectedReport(null);
        setView("report");
      } else if (key === "j") {
        event.preventDefault();
        setPanelOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Перетаскивание границы.
   *
   * Пока границу тянут, ширина пишется прямо в стиль корневого элемента, а не
   * в состояние: через состояние на каждый пиксель перерисовывался весь отчёт
   * с таблицами, и граница заметно отставала от курсора. В состояние уходит
   * только итог — его и нужно сохранить.
   *
   * Слушатели вешаются на окно, а не на саму границу: курсор при быстром
   * движении уходит с шестипиксельной полоски раньше, чем приходит событие, и
   * перетаскивание обрывалось на середине.
   */
  function startResize(event: React.PointerEvent) {
    event.preventDefault();
    const node = shell.current;
    const grip = event.currentTarget as HTMLElement;
    if (!node) return;

    const startX = event.clientX;
    let width = panelWidth;

    const move = (moved: PointerEvent) => {
      width = clamp(Math.round(panelWidth - (moved.clientX - startX)), PANEL.min, PANEL.max);
      node.style.setProperty("--st-panel-w", `${width}px`);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("st-resizing");
      grip.classList.remove("is-dragging");
      setPanelWidth(width);
    };

    document.body.classList.add("st-resizing");
    grip.classList.add("is-dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  /** Границу можно двигать и с клавиатуры: мышь есть не у всех. */
  function resizeByKey(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 40 : 12;
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    setPanelWidth((width) => clamp(width - direction * step, PANEL.min, PANEL.max));
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
      ref={shell}
      className={cx("st", !panelOpen && "no-panel")}
      style={
        {
          "--st-panel-w": panelOpen ? `${panelWidth}px` : "0px",
          "--st-grip-w": panelOpen ? "6px" : "0px",
        } as React.CSSProperties
      }
    >
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
        className="st-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ширина панели"
        tabIndex={panelOpen ? 0 : -1}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
      />

      <StudioPanel
        messages={messages}
        threads={workspace.threads}
        activeThread={thread?.id ?? null}
        view={view}
        model={model}
        models={workspace.runtime.models}
        live={live}
        error={error}
        busy={busy}
        ready={workspace.runtime.ready}
        ephemeral={workspace.runtime.ephemeral}
        selectedReport={shown?.id ?? null}
        onModel={setModel}
        onSelectReport={(id) => {
          setSelectedReport(id);
          setView("report");
        }}
        onSend={(prompt, attachments) => void run(prompt, attachments)}
        onStop={() => abort.current?.abort()}
        onCollapse={() => setPanelOpen(false)}
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

      {/* Свёрнутую панель нужно чем-то вернуть: кнопка, которая её прячет,
          уезжает вместе с ней. */}
      {!panelOpen ? (
        <button
          className="st-reveal"
          onClick={() => setPanelOpen(true)}
          title="Показать панель — Ctrl J"
          aria-label="Показать панель"
        >
          <PanelIcon />
        </button>
      ) : null}
    </div>
  );
}
