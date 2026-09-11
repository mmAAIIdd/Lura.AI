"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ChevronIcon,
  CloseIcon,
  FilePlusIcon,
  FolderPlusIcon,
  PencilIcon,
  TrashIcon,
  UploadIcon,
} from "@/components/studio/icons";
import { cx } from "@/lib/studio/cx";
import { MAX_FILE_CHARS, PROJECT_ROOT, nodePath } from "@/lib/studio/project";
import type { StudioNode } from "@/lib/studio/types";

/**
 * Проводник проекта.
 *
 * Отчёты Луры — это файлы, и обращаться с ними нужно как с файлами: раскладывать
 * по папкам, переименовывать, удалять. Пока результат жил одним «последним
 * ответом», всё, кроме свежего разбора, было недоступно.
 *
 * Действий наверху три, и все подписаны словами: значок «папка с плюсом» в
 * шестнадцать пикселей не объясняет, что он делает, пока на него не нажмёшь.
 * Переименование и удаление живут в самой строке — там, где понятно, к чему
 * они относятся.
 *
 * Дерево собирается из плоского списка на каждый рендер: узлов здесь десятки, а
 * не тысячи, и держать вторую, вложенную копию состояния — значит держать её
 * в согласии с первой при каждом переименовании.
 */

type Draft = { parentId: string | null; kind: StudioNode["kind"] } | null;

type Props = {
  /** Файл активной вкладки: выделяется в дереве. */
  openedId: string | null;
  onOpen: (node: StudioNode) => void;
  /** Свежее дерево после каждой загрузки: вкладки сверяют с ним имена и удалённые файлы. */
  onNodes: (nodes: StudioNode[]) => void;
  /** Счётчик обновлений снаружи: агент записал файл — дерево перечитывается. */
  revision: number;
};

/* Файл уходит в теле JSON-запроса, а тело на бессерверной площадке ограничено
   примерно 4.5 МБ. */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const UPLOAD_ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.xml,.html,.htm";

export function FileExplorer({ openedId, onOpen, onNodes, revision }: Props) {
  const [nodes, setNodes] = useState<StudioNode[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [rootOpen, setRootOpen] = useState(true);
  /* Выделение отдельно от открытого файла: папку можно выбрать, но не открыть,
     и именно выбранная папка решает, куда лягут новые элементы. */
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/studio/files", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { nodes?: StudioNode[]; error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "Проект не открылся.");
      return;
    }
    const list = body?.nodes ?? [];
    setNodes(list);
    setLoaded(true);
    onNodes(list);
  }, [onNodes]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  useEffect(() => {
    if (draft || renaming) input.current?.focus();
  }, [draft, renaming]);

  /* Переключили вкладку — в дереве выделяется её файл, как в редакторе кода. */
  useEffect(() => {
    if (openedId) setSelected(openedId);
  }, [openedId]);

  const children = useMemo(() => {
    const map = new Map<string | null, StudioNode[]>();
    for (const node of nodes) {
      const list = map.get(node.parentId) ?? [];
      list.push(node);
      map.set(node.parentId, list);
    }
    /* Папки выше файлов, дальше по алфавиту: так дерево не перестраивается на
       глазах после каждого переименования. */
    for (const list of map.values()) {
      list.sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name, "ru") : a.kind === "folder" ? -1 : 1,
      );
    }
    return map;
  }, [nodes]);

  /* Куда попадёт новый элемент: в выделенную папку, иначе рядом с выделенным
     файлом, иначе в корень. Это ровно то, чего ждёшь от проводника. */
  const target = useMemo(() => {
    const node = nodes.find((item) => item.id === selected);
    if (!node) return null;
    return node.kind === "folder" ? node.id : node.parentId;
  }, [nodes, selected]);

  const targetLabel = useMemo(() => {
    const folder = nodes.find((item) => item.id === target);
    return folder ? nodePath(nodes, folder) : PROJECT_ROOT;
  }, [nodes, target]);

  /** Раскрыть папку со всеми предками, чтобы новый элемент было видно. */
  function reveal(folderId: string | null) {
    setRootOpen(true);
    if (!folderId) return;
    setOpen((current) => {
      const next = new Set(current);
      let id: string | null = folderId;
      for (let guard = 0; id && guard <= nodes.length; guard += 1) {
        const at: string = id;
        next.add(at);
        id = nodes.find((node) => node.id === at)?.parentId ?? null;
      }
      return next;
    });
  }

  async function send(url: string, init: RequestInit): Promise<{ node?: StudioNode } | null> {
    setError(null);
    const response = await fetch(url, init);
    const body = (await response.json().catch(() => null)) as { node?: StudioNode; error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "Не получилось.");
      return null;
    }
    await load();
    return body ?? {};
  }

  function startDraft(kind: StudioNode["kind"]) {
    setRenaming(null);
    setDraft({ parentId: target, kind });
    reveal(target);
  }

  async function create(name: string) {
    if (!draft) return;
    const current = draft;
    setDraft(null);
    const result = await send("/api/studio/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: current.parentId, kind: current.kind, name }),
    });
    const node = result?.node;
    if (!node) return;
    setSelected(node.id);
    /* Новый файл сразу открывается: создают его затем, чтобы писать. */
    if (node.kind === "file") onOpen(node);
  }

  async function rename(id: string, name: string) {
    await send(`/api/studio/files/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRenaming(null);
  }

  async function remove(node: StudioNode) {
    const inside = node.kind === "folder" ? countInside(children, node.id) : 0;
    const question = inside
      ? `Удалить папку «${node.name}» и всё внутри (${inside})?`
      : `Удалить «${node.name}»?`;
    if (!window.confirm(question)) return;
    await send(`/api/studio/files/${node.id}`, { method: "DELETE" });
  }

  /**
   * Файлы с компьютера ложатся в проект как есть, текстом.
   *
   * Проблемные файлы не останавливают остальные: из пяти выбранных четыре
   * должны загрузиться, а про пятый — сказано, что с ним не так.
   */
  async function upload(files: File[]) {
    if (!files.length) return;
    const parentId = target;
    setError(null);
    setUploading(true);

    const problems: string[] = [];
    let last: StudioNode | null = null;
    try {
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          problems.push(`«${file.name}» больше 3 МБ`);
          continue;
        }
        const content = await file.text().catch(() => null);
        /* Нулевой символ в «тексте» бывает только у двоичного файла: картинка,
           прочитанная как строка, превращается в экран мусора. */
        if (content === null || content.includes(String.fromCharCode(0))) {
          problems.push(`«${file.name}» — не текстовый файл`);
          continue;
        }
        if (content.length > MAX_FILE_CHARS) {
          problems.push(`«${file.name}» длиннее ${MAX_FILE_CHARS.toLocaleString("ru-RU")} символов`);
          continue;
        }

        const response = await fetch("/api/studio/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId, kind: "file", name: file.name, content }),
        });
        const body = (await response.json().catch(() => null)) as { node?: StudioNode; error?: string } | null;
        if (!response.ok || !body?.node) {
          problems.push(`«${file.name}»: ${body?.error ?? "не загрузился"}`);
          continue;
        }
        last = body.node;
      }
    } finally {
      setUploading(false);
    }

    reveal(parentId);
    await load();
    if (last) {
      setSelected(last.id);
      onOpen(last);
    }
    if (problems.length) setError(`Не загрузились: ${problems.join("; ")}.`);
  }

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function draftRow(parentId: string | null, depth: number) {
    if (!draft || draft.parentId !== parentId) return null;
    return (
      <li>
        <div className="st-tree-row" style={{ paddingLeft: 8 + depth * 14 }}>
          <NameInput
            inputRef={input}
            initial=""
            placeholder={draft.kind === "folder" ? "Имя папки" : "Имя файла"}
            onCancel={() => setDraft(null)}
            onCommit={create}
          />
        </div>
      </li>
    );
  }

  function renderRow(node: StudioNode, depth: number) {
    const folder = node.kind === "folder";
    const expanded = open.has(node.id);
    const editing = renaming === node.id;

    return (
      <li key={node.id}>
        <div
          className={cx("st-tree-row", selected === node.id && "is-on")}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <button
            type="button"
            className="st-tree-main"
            onClick={() => {
              setSelected(node.id);
              if (folder) toggle(node.id);
              else onOpen(node);
            }}
            title={folder ? node.name : `${node.name} — ${node.chars ?? 0} символов`}
          >
            <span className={cx("st-tree-caret", folder && expanded && "is-open")} aria-hidden="true">
              {folder ? <ChevronIcon /> : null}
            </span>
            {editing ? null : <span className="st-tree-name">{node.name}</span>}
          </button>

          {editing ? (
            <NameInput
              inputRef={input}
              initial={node.name}
              onCancel={() => setRenaming(null)}
              onCommit={(value) => rename(node.id, value)}
            />
          ) : (
            <span className="st-tree-tools">
              <button type="button" onClick={() => setRenaming(node.id)} title="Переименовать" aria-label="Переименовать">
                <PencilIcon />
              </button>
              <button type="button" onClick={() => remove(node)} title="Удалить" aria-label="Удалить">
                <TrashIcon />
              </button>
            </span>
          )}
        </div>

        {folder && expanded ? (
          <ul className="st-tree-list">
            {(children.get(node.id) ?? []).map((child) => renderRow(child, depth + 1))}
            {draftRow(node.id, depth + 1)}
          </ul>
        ) : null}
      </li>
    );
  }

  const files = nodes.filter((node) => node.kind === "file").length;

  return (
    <aside className="st-explorer" aria-label="Проводник проекта">
      <div className="st-explorer-head">
        <span>Проводник</span>
        <span className="st-explorer-count">{files ? `${files} ${plural(files)}` : ""}</span>
      </div>

      <div className="st-explorer-actions">
        <button type="button" className="st-explorer-action" onClick={() => startDraft("folder")}>
          <FolderPlusIcon />
          <span>Добавить папку</span>
        </button>
        <button type="button" className="st-explorer-action" onClick={() => startDraft("file")}>
          <FilePlusIcon />
          <span>Добавить файл</span>
        </button>
        <button
          type="button"
          className="st-explorer-action"
          onClick={() => picker.current?.click()}
          disabled={uploading}
          title={`Текстовые файлы: ${UPLOAD_ACCEPT.replaceAll(",", " ")}`}
        >
          <UploadIcon />
          <span>{uploading ? "Загружаем…" : "Загрузить с компьютера"}</span>
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={UPLOAD_ACCEPT}
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = "";
            void upload(chosen);
          }}
        />
        <p className="st-explorer-target" title={targetLabel}>
          Куда: <b>{targetLabel}</b>
        </p>
      </div>

      <div className="st-explorer-body">
        <button
          type="button"
          className="st-tree-root"
          onClick={() => {
            setSelected(null);
            setRootOpen((value) => !value);
          }}
        >
          <span className={cx("st-tree-caret", rootOpen && "is-open")} aria-hidden="true">
            <ChevronIcon />
          </span>
          {PROJECT_ROOT}
        </button>

        {rootOpen ? (
          <ul className="st-tree-list">
            {(children.get(null) ?? []).map((node) => renderRow(node, 1))}
            {draftRow(null, 1)}
          </ul>
        ) : null}

        {loaded && !nodes.length && !draft ? (
          <p className="st-explorer-empty">
            Пусто. Добавьте папку или файл — сюда же Лура складывает отчёты и файлы, которые вы попросите её записать.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="st-explorer-error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Скрыть">
            <CloseIcon />
          </button>
        </p>
      ) : null}
    </aside>
  );
}

function plural(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return "файлов";
  switch (count % 10) {
    case 1:
      return "файл";
    case 2:
    case 3:
    case 4:
      return "файла";
    default:
      return "файлов";
  }
}

function countInside(children: Map<string | null, StudioNode[]>, id: string): number {
  const list = children.get(id) ?? [];
  return list.reduce((sum, node) => sum + 1 + countInside(children, node.id), 0);
}

function NameInput({
  inputRef,
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  initial: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);

  return (
    <input
      ref={inputRef}
      className="st-tree-input"
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (value.trim()) onCommit(value.trim());
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      /* Уход фокуса подтверждает ввод, а не отменяет: набранное имя, стёртое
         кликом мимо, — самая обидная потеря в проводнике. */
      onBlur={() => (value.trim() && value.trim() !== initial ? onCommit(value.trim()) : onCancel())}
      aria-label={placeholder ?? "Имя"}
    />
  );
}
