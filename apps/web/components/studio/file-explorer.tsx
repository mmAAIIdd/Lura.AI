"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  NewIcon,
  PencilIcon,
  TrashIcon,
} from "@/components/studio/icons";
import { cx } from "@/lib/studio/cx";
import type { StudioNode } from "@/lib/studio/types";

/**
 * Проводник проекта.
 *
 * Отчёты Луры — это файлы, и обращаться с ними нужно как с файлами: раскладывать
 * по папкам, переименовывать, удалять. Пока результат жил одним «последним
 * ответом», всё, кроме свежего разбора, было недоступно.
 *
 * Дерево собирается из плоского списка на каждый рендер: узлов здесь десятки, а
 * не тысячи, и держать вторую, вложенную копию состояния — значит держать её
 * в согласии с первой при каждом переименовании.
 */

type Draft = { parentId: string | null; kind: StudioNode["kind"] } | null;

type Props = {
  openedId: string | null;
  onOpen: (node: StudioNode) => void;
  onCheck: (node: StudioNode) => void;
  onClosed: (id: string) => void;
  /** Счётчик обновлений снаружи: агент дописал отчёт — дерево перечитывается. */
  revision: number;
};

const ROOT = "LURA_PROJECT";

export function FileExplorer({ openedId, onOpen, onCheck, onClosed, revision }: Props) {
  const [nodes, setNodes] = useState<StudioNode[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [rootOpen, setRootOpen] = useState(true);
  const [draft, setDraft] = useState<Draft>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/studio/files", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { nodes?: StudioNode[]; error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "Проект не открылся.");
      return;
    }
    setNodes(body?.nodes ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load, revision]);

  useEffect(() => {
    if (draft || renaming) input.current?.focus();
  }, [draft, renaming]);

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
    const opened = nodes.find((node) => node.id === openedId);
    if (!opened) return null;
    return opened.kind === "folder" ? opened.id : opened.parentId;
  }, [nodes, openedId]);

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setError(null);
    const response = await fetch(url, init);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Не получилось.");
      return false;
    }
    await load();
    return true;
  }

  async function create(name: string) {
    if (!draft) return;
    const ok = await send("/api/studio/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: draft.parentId, kind: draft.kind, name }),
    });
    if (ok && draft.parentId) setOpen((current) => new Set(current).add(draft.parentId as string));
    setDraft(null);
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
    if (await send(`/api/studio/files/${node.id}`, { method: "DELETE" })) onClosed(node.id);
  }

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderRow(node: StudioNode, depth: number) {
    const folder = node.kind === "folder";
    const expanded = open.has(node.id);
    const editing = renaming === node.id;

    return (
      <li key={node.id}>
        <div
          className={cx("st-tree-row", openedId === node.id && "is-on")}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <button
            type="button"
            className="st-tree-main"
            onClick={() => (folder ? toggle(node.id) : onOpen(node))}
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
            {draft && draft.parentId === node.id ? (
              <li>
                <div className="st-tree-row" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                  <NameInput
                    inputRef={input}
                    initial=""
                    placeholder={draft.kind === "folder" ? "Имя папки" : "Имя файла"}
                    onCancel={() => setDraft(null)}
                    onCommit={create}
                  />
                </div>
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  }

  const opened = nodes.find((node) => node.id === openedId) ?? null;
  const files = nodes.filter((node) => node.kind === "file").length;

  return (
    <aside className="st-explorer" aria-label="Проводник проекта">
      <div className="st-explorer-head">
        <span>Проводник</span>
        <span className="st-explorer-count">{files ? `${files} ${plural(files)}` : ""}</span>
      </div>

      <div className="st-explorer-body">
        <button type="button" className="st-tree-root" onClick={() => setRootOpen((value) => !value)}>
          <span className={cx("st-tree-caret", rootOpen && "is-open")} aria-hidden="true">
            <ChevronIcon />
          </span>
          {ROOT}
        </button>

        {rootOpen ? (
          <ul className="st-tree-list">
            {(children.get(null) ?? []).map((node) => renderRow(node, 1))}
            {draft && draft.parentId === null ? (
              <li>
                <div className="st-tree-row" style={{ paddingLeft: 22 }}>
                  <NameInput
                    inputRef={input}
                    initial=""
                    placeholder={draft.kind === "folder" ? "Имя папки" : "Имя файла"}
                    onCancel={() => setDraft(null)}
                    onCommit={create}
                  />
                </div>
              </li>
            ) : null}
          </ul>
        ) : null}

        {loaded && !nodes.length && !draft ? (
          <p className="st-explorer-empty">
            Пусто. Создайте папку или файл — Лура будет складывать сюда готовые отчёты.
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

      <div className="st-explorer-bar">
        <button
          type="button"
          onClick={() => setDraft({ parentId: target, kind: "file" })}
          title="Новый файл"
          aria-label="Новый файл"
        >
          <NewIcon />
        </button>
        <button
          type="button"
          onClick={() => setDraft({ parentId: target, kind: "folder" })}
          title="Новая папка"
          aria-label="Новая папка"
        >
          <FolderPlusIcon />
        </button>
        <button type="button" onClick={() => void load()} title="Обновить" aria-label="Обновить">
          <RefreshIcon />
        </button>
        <button
          type="button"
          onClick={() => setOpen(new Set())}
          disabled={!open.size}
          title="Свернуть все папки"
          aria-label="Свернуть все папки"
        >
          <CollapseIcon />
        </button>
        <span className="st-explorer-gap" />
        <button
          type="button"
          className="st-explorer-check"
          onClick={() => opened && opened.kind === "file" && onCheck(opened)}
          disabled={!opened || opened.kind !== "file"}
          title={opened?.kind === "file" ? `Проверить «${opened.name}»` : "Откройте файл, чтобы проверить"}
        >
          <CheckIcon />
          <span>Проверка</span>
        </button>
      </div>
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

function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v3" />
      <path d="M16 17h6" />
      <path d="M19 14v6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9h6V3" />
      <path d="M20 15h-6v6" />
      <path d="M14 10 21 3" />
      <path d="M3 21l7-7" />
    </svg>
  );
}
