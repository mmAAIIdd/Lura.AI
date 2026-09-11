"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FileExplorer } from "@/components/studio/file-explorer";
import { FileTabs } from "@/components/studio/file-tabs";
import { FileView } from "@/components/studio/file-view";
import { PanelIcon } from "@/components/studio/icons";
import { cx } from "@/lib/studio/cx";
import { StudioContext } from "@/components/studio/studio-context";
import { StudioPanel, type ComposerAttachment } from "@/components/studio/studio-panel";
import { StudioReport } from "@/components/studio/studio-report";
import type {
  LuraModel,
  RunMode,
  StudioMessage,
  StudioNode,
  StudioThread,
  ToolTrace,
  WorkspaceState,
} from "@/lib/studio/types";

/**
 * Рабочее пространство: проводник, вкладки файлов с окном вывода и диалог.
 *
 * Состояние живёт здесь: все панели — представления одного разговора и одного
 * проекта, а поток событий от агента один. Разводить его по компонентам значило
 * бы синхронизировать их между собой на каждом токене.
 */

const EMPTY: WorkspaceState = {
  documents: [],
  threads: [],
  runtime: { ready: true, models: ["lura-pro", "lura-fast"], search: null, storage: "", ephemeral: false },
};

/* Режим становится известен первым событием потока; до него — null, и ответ
   ещё некуда показывать. */
type Live = { text: string; tools: ToolTrace[]; mode: RunMode | null };
type View = "report" | "context" | "file";

/* Границы панели. Уже нижней в ней не помещаются ни названия разборов, ни
   поле ввода; шире верхней — центр становится колонкой текста в пол-экрана. */
const PANEL = { min: 340, max: 760, initial: 440 };
const WIDTH_KEY = "lura.studio.panel";

/* После этих инструментов дерево перечитывается сразу, а не по окончании
   ответа: файл появляется в проводнике, пока агент ещё пишет. */
const PROJECT_WRITES = new Set(["create_folder", "write_project_file"]);

/**
 * Разговорный ответ живёт в чате, в окно вывода попадает только разбор.
 * У старых сообщений режима нет — они показываются в центре, как и раньше.
 */
const isReport = (message: StudioMessage) => message.role === "agent" && message.mode !== "chat";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function StudioScreen() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY);
  const [thread, setThread] = useState<StudioThread | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("report");
  /* Вкладки открытых файлов, активная вкладка и те, где есть несохранённая
     правка. Счётчик дерева — счётчик, а не флаг: повторная запись агента в тот
     же файл обязана перечитать проводник снова. */
  const [tabs, setTabs] = useState<StudioNode[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [treeRevision, setTreeRevision] = useState(0);
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
    setError(null);
    /* Открывая разбор, показываем его последний отчёт: он и есть результат.
       Если в треде только разговор, открытый файл остаётся на месте. */
    const last = [...body.thread.messages].reverse().find(isReport);
    setSelectedReport(last?.id ?? null);
    if (last) setView("report");
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
  const reports = messages.filter(isReport);
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

  /* ---------- Вкладки ---------- */

  const openFile = useCallback((node: StudioNode) => {
    setTabs((current) => (current.some((tab) => tab.id === node.id) ? current : [...current, node]));
    setActiveTab(node.id);
    setView("file");
  }, []);

  /* Дерево перечитано: вкладки берут из него новые имена и отметки времени, а
     вкладки удалённых файлов закрываются — иначе открытым остался бы файл,
     которого уже нет. */
  const syncTabs = useCallback((nodes: StudioNode[]) => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    setTabs((current) => {
      const next = current.flatMap((tab) => byId.get(tab.id) ?? []);
      const same =
        next.length === current.length &&
        next.every((node, index) => node.name === current[index].name && node.updatedAt === current[index].updatedAt);
      return same ? current : next;
    });
  }, []);

  const markDirty = useCallback((id: string, value: boolean) => {
    setDirty((current) => {
      if (current.has(id) === value) return current;
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function closeTab(id: string) {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    if (dirty.has(id) && !window.confirm(`В «${tabs[index].name}» есть несохранённые правки. Закрыть без сохранения?`)) {
      return;
    }
    const rest = tabs.filter((tab) => tab.id !== id);
    setTabs(rest);
    markDirty(id, false);
    if (activeTab !== id) return;
    /* Как в редакторе кода: активной становится соседняя справа, если её нет — слева. */
    const neighbour = rest[index] ?? rest[index - 1] ?? null;
    setActiveTab(neighbour?.id ?? null);
    if (!neighbour && view === "file") setView("report");
  }

  /* Активная вкладка исчезла при сверке с деревом — файл удалили. */
  useEffect(() => {
    if (!activeTab || tabs.some((tab) => tab.id === activeTab)) return;
    const fallback = tabs[tabs.length - 1] ?? null;
    setActiveTab(fallback?.id ?? null);
    if (!fallback) setView((current) => (current === "file" ? "report" : current));
  }, [tabs, activeTab]);

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
    setLive({ text: "", tools: [], mode: null });

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
            | { type: "mode"; mode: RunMode }
            | { type: "text"; text: string }
            | { type: "tool"; phase: "start" | "done"; trace: ToolTrace }
            | { type: "done"; thread: StudioThread }
            | { type: "error"; message: string };

          if (event.type === "mode") {
            setLive((current) => (current ? { ...current, mode: event.mode } : current));
            /* Разбор занимает окно вывода с первой секунды. Разговор его не
               трогает: открытый файл остаётся на месте, ответ придёт в чат. */
            if (event.mode === "report") setView("report");
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
            if (event.phase === "done" && event.trace.ok && PROJECT_WRITES.has(event.trace.name)) {
              setTreeRevision((value) => value + 1);
            }
          } else if (event.type === "done") {
            setThread(event.thread);
            const answer = event.thread.messages[event.thread.messages.length - 1];
            if (answer && isReport(answer)) {
              setSelectedReport(answer.id);
              /* Разбор лёг файлом в «Отчёты» — проводник должен его показать. */
              setTreeRevision((value) => value + 1);
            }
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

  const fileOnScreen = view === "file" && activeTab !== null;

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
      <FileExplorer
        openedId={fileOnScreen ? activeTab : null}
        revision={treeRevision}
        onOpen={openFile}
        onNodes={syncTabs}
      />

      <main className="st-main">
        {tabs.length ? (
          <FileTabs
            tabs={tabs}
            active={fileOnScreen ? activeTab : null}
            dirty={dirty}
            onSelect={(id) => {
              setActiveTab(id);
              setView("file");
            }}
            onClose={closeTab}
          />
        ) : null}

        <div className="st-main-body">
          {tabs.map((tab) => (
            <FileView
              key={tab.id}
              node={tab}
              hidden={!fileOnScreen || tab.id !== activeTab}
              onDirty={markDirty}
              onSaved={() => setTreeRevision((value) => value + 1)}
            />
          ))}

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
          ) : fileOnScreen ? null : (
            <StudioReport message={shown} streaming={live?.mode === "report" ? live : null} />
          )}
        </div>
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
        view={view === "context" ? "context" : "report"}
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
