"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StudioComposer, type ComposerAttachment } from "@/components/studio/studio-composer";
import { StudioOutput } from "@/components/studio/studio-output";
import { StudioSidebar } from "@/components/studio/studio-sidebar";
import type { StudioMode, StudioThread, ToolTrace, WorkspaceState } from "@/lib/studio/types";

/**
 * Рабочее пространство целиком.
 *
 * Состояние живёт здесь: боковая панель, окно вывода и командная строка —
 * представления, а поток событий от агента один, и разводить его по трём
 * компонентам значило бы синхронизировать их между собой на каждом токене.
 */

const EMPTY: WorkspaceState = {
  documents: [],
  threads: [],
  runtime: { ready: true, models: [], search: null, storage: "" },
};

type Live = { text: string; tools: ToolTrace[]; model: string };

export function StudioScreen() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY);
  const [mode, setMode] = useState<StudioMode>("reports");
  const [thread, setThread] = useState<StudioThread | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    setMode(body.thread.mode);
    setError(null);
  }, []);

  useEffect(() => {
    void refresh();
    const saved = window.localStorage.getItem("lura-studio-mode");
    if (saved === "updates" || saved === "reports") setMode(saved);

    /* Ссылка на разбор открывает именно его: готовый отчёт нужно уметь
       переслать коллеге, а не пересказывать. */
    const wanted = new URLSearchParams(window.location.search).get("thread");
    if (wanted) void openThread(wanted);
  }, [refresh, openThread]);

  function switchMode(next: StudioMode) {
    setMode(next);
    window.localStorage.setItem("lura-studio-mode", next);
    /* Разбор принадлежит режиму: показывать отчёт по релизу в «Отчётах» —
       значит стереть разницу между двумя окнами. */
    if (thread && thread.mode !== next) setThread(null);
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
    setLive({ text: "", tools: [], model: "" });

    /* Свой запрос показывается сразу, не дожидаясь сервера: иначе между
       нажатием и первым событием экран выглядит так, будто ничего не приняли. */
    const optimistic: StudioThread = thread ?? {
      id: "",
      mode,
      title: prompt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    setThread({
      ...optimistic,
      messages: [
        ...optimistic.messages,
        {
          id: `local-${Date.now()}`,
          role: "user",
          mode,
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
        body: JSON.stringify({ threadId: thread?.id || undefined, prompt, mode, attachments }),
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
      <StudioSidebar
        mode={mode}
        onMode={switchMode}
        documents={workspace.documents}
        threads={workspace.threads}
        activeThread={thread?.id ?? null}
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
        onDeleteDocument={async (id) => {
          await fetch(`/api/studio/documents/${id}`, { method: "DELETE" });
          await refresh();
        }}
        onOpenThread={(id) => {
          void openThread(id);
          window.history.replaceState(null, "", `/studio?thread=${id}`);
        }}
        onNewThread={() => {
          setThread(null);
          setError(null);
        }}
      />

      <main className="st-main">
        <StudioOutput
          mode={mode}
          thread={thread}
          live={live}
          error={error}
          runtime={workspace.runtime}
          onStarter={(prompt) => void run(prompt, [])}
        />
        <StudioComposer
          mode={mode}
          busy={busy}
          onSend={(prompt, attachments) => void run(prompt, attachments)}
          onStop={() => abort.current?.abort()}
        />
      </main>
    </div>
  );
}
