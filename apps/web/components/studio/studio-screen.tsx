"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StudioChat, type ComposerAttachment } from "@/components/studio/studio-chat";
import { StudioContext } from "@/components/studio/studio-context";
import { StudioRail } from "@/components/studio/studio-rail";
import { StudioReport } from "@/components/studio/studio-report";
import type { StudioThread, ToolTrace, WorkspaceState } from "@/lib/studio/types";

/**
 * Рабочее пространство: рельса, отчёт и диалог.
 *
 * Состояние живёт здесь: все три панели — представления одного разбора, а
 * поток событий от агента один. Разводить его по компонентам значило бы
 * синхронизировать их между собой на каждом токене.
 */

const EMPTY: WorkspaceState = {
  documents: [],
  threads: [],
  runtime: { ready: true, models: [], search: null, storage: "" },
};

type Live = { text: string; tools: ToolTrace[]; model: string };
type View = "report" | "context";

export function StudioScreen() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY);
  const [thread, setThread] = useState<StudioThread | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("report");
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
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
    /* Открывая разбор, показываем его последний отчёт: он и есть результат. */
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

  const messages = thread?.messages ?? [];
  const reports = messages.filter((message) => message.role === "agent");
  const shown =
    reports.find((message) => message.id === selectedReport) ?? reports[reports.length - 1] ?? null;
  const business = workspace.documents.find((document) => document.kind === "business");

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
    setLive({ text: "", tools: [], model: "" });

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
        body: JSON.stringify({ threadId: thread?.id || undefined, prompt, attachments }),
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
            | { type: "model"; model: string }
            | { type: "text"; text: string }
            | { type: "tool"; phase: "start" | "done"; trace: ToolTrace }
            | { type: "done"; thread: StudioThread }
            | { type: "error"; message: string };

          if (event.type === "model") {
            setLive((current) => (current ? { ...current, model: event.model } : current));
          } else if (event.type === "text") {
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
        setError(caught instanceof Error ? caught.message : "Разбор прервался.");
      }
      setLive(null);
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  return (
    <div className="st">
      <StudioRail
        threads={workspace.threads}
        activeThread={thread?.id ?? null}
        view={view}
        busy={busy}
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

      <StudioChat
        messages={messages}
        live={live}
        error={error}
        busy={busy}
        selectedReport={shown?.id ?? null}
        runtime={workspace.runtime}
        onSelectReport={(id) => {
          setSelectedReport(id);
          setView("report");
        }}
        onSend={(prompt, attachments) => void run(prompt, attachments)}
        onStop={() => abort.current?.abort()}
      />

      {/* Статусная строка вместо подписей по всему экрану: состояние видно
          всегда, а место занимает одну полоску. */}
      <footer className="st-status">
        <span className={busy ? "is-live" : undefined}>{busy ? "● разбор идёт" : "● готов"}</span>
        <span>
          модель <b>{live?.model || workspace.runtime.models[0] || "—"}</b>
        </span>
        <span>
          поиск <b>{workspace.runtime.search ?? "авто"}</b>
        </span>
        <span>
          контекст <b>{workspace.documents.length}</b>
        </span>
        {!business ? <span className="is-warn">нет документа о бизнесе</span> : null}
        {!workspace.runtime.ready ? <span className="is-warn">нет ключа Gemini</span> : null}

        <span className="st-status-spacer" />
        {shown ? (
          <>
            <button onClick={() => void navigator.clipboard.writeText(shown.text)}>копировать</button>
            {shown.artifactId ? (
              <a href={`/api/studio/artifacts/${shown.artifactId}`} download>
                скачать .md
              </a>
            ) : null}
          </>
        ) : null}
      </footer>
    </div>
  );
}
