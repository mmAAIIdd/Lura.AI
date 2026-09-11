"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LuraLogo } from "@/components/lura-logo";
import { FileExplorer } from "@/components/studio/file-explorer";
import { FileTabs } from "@/components/studio/file-tabs";
import { FileView } from "@/components/studio/file-view";
import { PanelIcon } from "@/components/studio/icons";
import { StudioContext } from "@/components/studio/studio-context";
import { StudioMaterials } from "@/components/studio/studio-materials";
import { StudioPanel, type ComposerAttachment } from "@/components/studio/studio-panel";
import { StudioReport } from "@/components/studio/studio-report";
import { StudioStart } from "@/components/studio/studio-start";
import { StudioThreads } from "@/components/studio/studio-threads";
import { REPORT_COMMAND, parsePrompt, titleFrom } from "@/lib/studio/command";
import { cx } from "@/lib/studio/cx";
import { MATERIAL_MAX_BYTES, MATERIAL_MAX_LABEL, type MaterialUpload } from "@/lib/studio/materials";
import type {
  LuraModel,
  RunMode,
  StudioDocument,
  StudioMessage,
  StudioNode,
  StudioThread,
  ToolTrace,
  WorkspaceState,
} from "@/lib/studio/types";

/**
 * Рабочее пространство.
 *
 * Три колонки с постоянным назначением. Слева — проект: материалы, разборы,
 * файлы. В центре — начало работы, ход разбора или открытый отчёт и файлы.
 * Справа — обсуждение. Весь экран подчинён одному пути: загрузить материалы →
 * отметить источники и написать вопрос → начать разбор → видеть, что
 * происходит → получить отчёт с основаниями.
 *
 * Состояние живёт здесь: все колонки — представления одного разговора и одного
 * проекта, а поток событий от агента один.
 */

const EMPTY: WorkspaceState = {
  documents: [],
  threads: [],
  runtime: { ready: true, models: ["lura-pro", "lura-fast"], search: null, storage: "", ephemeral: false },
};

/* Режим становится известен первым событием потока; до него — null. */
type Live = { text: string; tools: ToolTrace[]; mode: RunMode | null };
type View = "report" | "context" | "file";
/* На узком экране колонки открываются по одной. */
type Pane = "side" | "main" | "chat";

const PANES: { id: Pane; label: string }[] = [
  { id: "side", label: "Проект" },
  { id: "main", label: "Разбор" },
  { id: "chat", label: "Обсуждение" },
];

/* Границы правой колонки. Уже нижней не помещается поле ввода с выбором
   модели; шире верхней — центр сжимается до колонки текста в пол-экрана. */
const PANEL = { min: 360, max: 640, initial: 400 };
const WIDTH_KEY = "lura.studio.panel";
/* Храним снятые галочки, а не поставленные: новый материал сразу участвует в
   разборе, и его не нужно отдельно отмечать после загрузки. */
const EXCLUDED_KEY = "lura.studio.excluded";

/* После этих инструментов дерево файлов перечитывается сразу, а не по
   окончании ответа: файл появляется в проекте, пока агент ещё пишет. */
const PROJECT_WRITES = new Set(["create_folder", "write_project_file"]);

/**
 * Разговорный ответ живёт в обсуждении, в центр попадает только отчёт.
 * У старых сообщений режима нет — они показываются в центре, как и раньше.
 */
const isReport = (message: StudioMessage) => message.role === "agent" && message.mode !== "chat";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function questionOf(message: StudioMessage | undefined): string {
  if (!message) return "";
  const parsed = parsePrompt(message.text);
  return (parsed.text || parsed.raw).split("\n")[0];
}

export function StudioScreen() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [thread, setThread] = useState<StudioThread | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("report");
  const [pane, setPane] = useState<Pane>("main");
  const [announce, setAnnounce] = useState("");

  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<MaterialUpload[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [focusMaterial, setFocusMaterial] = useState<{ id: string; token: number } | null>(null);

  /* Вкладки открытых файлов, активная вкладка и те, где есть несохранённая
     правка. Счётчик дерева — счётчик, а не флаг: повторная запись агента в тот
     же файл обязана перечитать дерево снова. */
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
      setLoaded(true);
      return;
    }
    /* Молча пустое пространство выглядит как «материалов нет», хотя на самом
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
       Если в треде только разговор, он открывается в обсуждении. */
    const last = [...body.thread.messages].reverse().find(isReport);
    setSelectedReport(last?.id ?? null);
    if (last) {
      setView("report");
      setPane("main");
    } else {
      setPane("chat");
    }
  }, []);

  useEffect(() => {
    void refresh();
    /* Ссылка открывает то, что в ней указано: конкретный разбор или материалы.
       Готовый отчёт нужно уметь переслать, а не пересказывать. */
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "context") setView("context");
    const wanted = params.get("thread");
    if (wanted) void openThread(wanted);
  }, [refresh, openThread]);

  /* Ширина колонки и снятые галочки — настройки рабочего места: живут в
     браузере и переживают перезагрузку. Чтение только после монтирования,
     иначе разметка на сервере и в браузере разойдётся. */
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved) setPanelWidth(clamp(saved, PANEL.min, PANEL.max));
      const off = JSON.parse(localStorage.getItem(EXCLUDED_KEY) ?? "[]") as unknown;
      if (Array.isArray(off)) setExcluded(new Set(off.filter((id): id is string => typeof id === "string")));
    } catch {
      /* Хранилище недоступно — значения по умолчанию. */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(panelWidth));
      localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...excluded]));
    } catch {
      /* Не сохранилось — не повод ломать экран. */
    }
  }, [panelWidth, excluded]);

  const documents = workspace.documents;
  const chosen = documents.filter((document) => !excluded.has(document.id));
  const messages = thread?.messages ?? [];
  const reports = messages.filter(isReport);
  const shown =
    reports.find((message) => message.id === selectedReport) ?? reports[reports.length - 1] ?? null;

  const newAnalysis = useCallback(() => {
    setThread(null);
    setSelectedReport(null);
    setError(null);
    setView("report");
    setPane("main");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        newAnalysis();
      } else if (key === "j") {
        event.preventDefault();
        setPanelOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newAnalysis]);

  /* ---------- Материалы ---------- */

  function toggleSource(id: string) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function uploadOne(item: MaterialUpload, asBusiness: boolean) {
    const fail = (message: string) =>
      setUploads((current) =>
        current.map((upload) => (upload.key === item.key ? { ...upload, state: "failed", error: message } : upload)),
      );

    setUploads((current) =>
      current.map((upload) => (upload.key === item.key ? { ...upload, state: "working", error: undefined } : upload)),
    );
    setAnnounce(`Загружаем «${item.name}»`);

    if (item.file.size > MATERIAL_MAX_BYTES) {
      fail(`Файл больше ${MATERIAL_MAX_LABEL}. Разбейте выгрузку на части или сократите период.`);
      return;
    }

    const form = new FormData();
    form.append("files", item.file);
    form.append("kind", asBusiness ? "business" : "source");

    try {
      const response = await fetch("/api/studio/documents", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as
        | { error?: string; documents?: StudioDocument[] }
        | null;
      if (!response.ok) {
        fail(body?.error ?? "Сервер не принял файл.");
        return;
      }
      setUploads((current) => current.filter((upload) => upload.key !== item.key));
      setRecent((current) => [...current, ...(body?.documents ?? []).map((document) => document.title)]);
      setAnnounce(`«${item.name}» загружен и готов к разбору`);
      await refresh();
    } catch {
      fail("Нет связи с сервером. Проверьте интернет и повторите.");
    }
  }

  /* Файлы идут по одному: у каждого своя строка со своим исходом, и сорвавшийся
     пятый не хоронит четыре загруженных. */
  async function uploadMaterials(files: File[], asBusiness = false) {
    setError(null);
    const items: MaterialUpload[] = files.map((file) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      state: "working",
      file,
    }));
    setUploads((current) => [...current, ...items]);
    for (const item of items) await uploadOne(item, asBusiness);
  }

  async function uploadUrl(url: string, asBusiness: boolean) {
    setError(null);
    setAnnounce("Загружаем страницу по ссылке");
    const response = await fetch("/api/studio/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, kind: asBusiness ? "business" : "source" }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; documents?: StudioDocument[] } | null;
    if (!response.ok) {
      setError(body?.error ?? "Ссылка не загрузилась.");
      setAnnounce("");
      return;
    }
    setRecent((current) => [...current, ...(body?.documents ?? []).map((document) => document.title)]);
    setAnnounce("Страница загружена и готова к разбору");
    await refresh();
  }

  function openMaterials(id: string | null) {
    setFocusMaterial(id ? { id, token: Date.now() } : null);
    setView("context");
    setPane("main");
    window.history.replaceState(null, "", "/studio?view=context");
  }

  /* ---------- Вкладки ---------- */

  const openFile = useCallback((node: StudioNode) => {
    setTabs((current) => (current.some((tab) => tab.id === node.id) ? current : [...current, node]));
    setActiveTab(node.id);
    setView("file");
    setPane("main");
  }, []);

  /* Дерево перечитано: вкладки берут из него новые имена и отметки времени, а
     вкладки удалённых файлов закрываются. */
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

  /* ---------- Граница правой колонки ---------- */

  /**
   * Пока границу тянут, ширина пишется прямо в стиль корневого элемента, а не
   * в состояние: через состояние на каждый пиксель перерисовывался весь отчёт.
   * Слушатели на окне: курсор при быстром движении уходит с узкой полоски.
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

  function resizeByKey(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 40 : 12;
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    setPanelWidth((width) => clamp(width - direction * step, PANEL.min, PANEL.max));
  }

  /* ---------- Запуск ---------- */

  async function run(prompt: string, attachments: ComposerAttachment[], fresh = false) {
    const report = parsePrompt(prompt).mode === "report";
    const current = fresh ? null : thread;

    setBusy(true);
    setError(null);
    setLive({ text: "", tools: [], mode: null });
    if (!current?.id) setPending(report ? titleFrom(prompt) : null);
    if (report) {
      setRecent([]);
      setView("report");
      setPane("main");
    }

    /* Свой запрос показывается сразу: иначе между нажатием и первым событием
       экран выглядит так, будто ничего не приняли. */
    const base: StudioThread = current ?? {
      id: "",
      title: titleFrom(prompt),
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
        body: JSON.stringify({
          threadId: current?.id || undefined,
          prompt,
          model,
          attachments,
          /* Пока список материалов не получен, ограничивать агента нечем. */
          sources: loaded ? chosen.map((document) => document.id) : undefined,
        }),
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
            setLive((state) => (state ? { ...state, mode: event.mode } : state));
            if (event.mode === "report") {
              setView("report");
              setAnnounce("Разбор выполняется");
            }
          } else if (event.type === "text") {
            setLive((state) => (state ? { ...state, text: state.text + event.text } : state));
          } else if (event.type === "tool") {
            setLive((state) => {
              if (!state) return state;
              const tools = [...state.tools];
              if (event.phase === "start") tools.push(event.trace);
              else {
                const position = tools.findIndex(
                  (trace) => trace.name === event.trace.name && trace.argument === event.trace.argument && !trace.summary,
                );
                if (position >= 0) tools[position] = event.trace;
                else tools.push(event.trace);
              }
              return { ...state, tools };
            });
            if (event.phase === "done" && event.trace.ok && PROJECT_WRITES.has(event.trace.name)) {
              setTreeRevision((value) => value + 1);
            }
          } else if (event.type === "done") {
            setThread(event.thread);
            const answer = event.thread.messages[event.thread.messages.length - 1];
            if (answer && isReport(answer)) {
              setSelectedReport(answer.id);
              /* Отчёт лёг файлом в «Отчёты» — дерево должно его показать. */
              setTreeRevision((value) => value + 1);
              setAnnounce("Разбор завершён. Отчёт открыт.");
            } else {
              setAnnounce("Ответ получен");
            }
            setLive(null);
            window.history.replaceState(null, "", `/studio?thread=${event.thread.id}`);
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
      } else {
        setAnnounce("Остановлено");
      }
      setLive(null);
    } finally {
      abort.current = null;
      setPending(null);
      setBusy(false);
    }
  }

  const fileOnScreen = view === "file" && activeTab !== null;
  const lastQuestion = questionOf([...messages].reverse().find((message) => message.role === "user"));
  const shownQuestion = (() => {
    if (!shown) return "";
    const index = messages.findIndex((message) => message.id === shown.id);
    return (
      questionOf(messages.slice(0, index).reverse().find((message) => message.role === "user")) ||
      thread?.title ||
      "Разбор"
    );
  })();

  let center: React.ReactNode;
  if (view === "context") {
    center = (
      <StudioContext
        key={focusMaterial?.token ?? 0}
        focus={focusMaterial?.id ?? null}
        documents={documents}
        busy={busy}
        onUpload={(files, asBusiness) => uploadMaterials(files, asBusiness)}
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
          const document = documents.find((item) => item.id === id);
          if (document && !window.confirm(`Удалить материал «${document.title}»? Разборы по нему останутся.`)) return;
          await fetch(`/api/studio/documents/${id}`, { method: "DELETE" });
          await refresh();
        }}
      />
    );
  } else if (fileOnScreen) {
    center = null;
  } else if (live?.mode === "report") {
    center = (
      <StudioReport
        message={null}
        streaming={live}
        question={lastQuestion || "Разбор"}
        onStop={() => abort.current?.abort()}
        onNew={newAnalysis}
      />
    );
  } else if (shown) {
    center = (
      <StudioReport
        message={shown}
        streaming={null}
        question={shownQuestion}
        onStop={() => abort.current?.abort()}
        onNew={newAnalysis}
      />
    );
  } else {
    center = (
      <StudioStart
        documents={documents}
        loaded={loaded}
        excluded={excluded}
        uploads={uploads}
        recent={recent}
        busy={busy}
        ready={workspace.runtime.ready}
        onUpload={(files) => void uploadMaterials(files)}
        onRetry={(key) => {
          const item = uploads.find((upload) => upload.key === key);
          if (item) void uploadOne(item, false);
        }}
        onDismiss={(key) => setUploads((current) => current.filter((upload) => upload.key !== key))}
        onToggle={toggleSource}
        onManage={() => openMaterials(null)}
        onStart={(question) => void run(`${REPORT_COMMAND} ${question}`, [], true)}
      />
    );
  }

  return (
    <div
      ref={shell}
      className={cx("st", !panelOpen && "no-panel")}
      data-pane={pane}
      style={
        {
          "--st-panel-w": panelOpen ? `${panelWidth}px` : "0px",
          "--st-grip-w": panelOpen ? "6px" : "0px",
        } as React.CSSProperties
      }
    >
      <nav className="st-panes" aria-label="Колонки рабочего пространства">
        {PANES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cx("st-pane-btn", pane === item.id && "is-on")}
            aria-pressed={pane === item.id}
            onClick={() => setPane(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <aside className="st-side" aria-label="Проект">
        <div className="st-side-top">
          <LuraLogo className="st-brand-logo" />
          <span>Lura</span>
        </div>

        <div className="st-side-scroll">
          <StudioMaterials
            documents={documents}
            loaded={loaded}
            excluded={excluded}
            uploads={uploads}
            onToggle={toggleSource}
            onUpload={(files) => void uploadMaterials(files)}
            onRetry={(key) => {
              const item = uploads.find((upload) => upload.key === key);
              if (item) void uploadOne(item, false);
            }}
            onDismiss={(key) => setUploads((current) => current.filter((upload) => upload.key !== key))}
            onOpen={(id) => openMaterials(id)}
            onManage={() => openMaterials(null)}
          />

          <StudioThreads
            threads={workspace.threads}
            active={thread?.id || null}
            pending={pending}
            busy={busy}
            onNew={newAnalysis}
            onOpen={(id) => {
              void openThread(id);
              window.history.replaceState(null, "", `/studio?thread=${id}`);
            }}
            onRename={async (id, title) => {
              await fetch(`/api/studio/threads/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
              });
              if (thread?.id === id) setThread({ ...thread, title });
              await refresh();
            }}
            onDelete={async (id) => {
              await fetch(`/api/studio/threads/${id}`, { method: "DELETE" });
              if (thread?.id === id) {
                setThread(null);
                setSelectedReport(null);
              }
              await refresh();
            }}
          />

          <FileExplorer
            openedId={fileOnScreen ? activeTab : null}
            revision={treeRevision}
            onOpen={openFile}
            onNodes={syncTabs}
          />
        </div>
      </aside>

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
          {center}
        </div>
      </main>

      <div
        className="st-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ширина обсуждения"
        tabIndex={panelOpen ? 0 : -1}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
      />

      <StudioPanel
        messages={messages}
        live={live}
        error={error}
        busy={busy}
        ready={workspace.runtime.ready}
        ephemeral={workspace.runtime.ephemeral}
        loaded={loaded}
        sources={chosen}
        materials={documents.length}
        model={model}
        models={workspace.runtime.models}
        selectedReport={shown?.id ?? null}
        onModel={setModel}
        onSelectReport={(id) => {
          setSelectedReport(id);
          setView("report");
          setPane("main");
        }}
        onSend={(prompt, attachments) => void run(prompt, attachments)}
        onStop={() => abort.current?.abort()}
        onCollapse={() => setPanelOpen(false)}
        onNewThread={newAnalysis}
      />

      {/* Свёрнутую колонку нужно чем-то вернуть: кнопка, которая её прячет,
          уезжает вместе с ней. */}
      {!panelOpen ? (
        <button
          type="button"
          className="st-reveal"
          onClick={() => setPanelOpen(true)}
          aria-label="Показать обсуждение"
          data-tip="Показать обсуждение · Ctrl J"
        >
          <PanelIcon />
        </button>
      ) : null}

      {/* Сообщения о состоянии для экранных дикторов: загрузка, начало и конец разбора. */}
      <p className="st-sr" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
