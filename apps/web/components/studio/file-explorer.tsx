"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ChevronIcon,
  CloseIcon,
  FilePlusIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/studio/icons";
import { SideSection } from "@/components/studio/side-section";
import { cx } from "@/lib/studio/cx";
import { nodePath } from "@/lib/studio/project";
import type { StudioNode } from "@/lib/studio/types";

/**
 * Файлы проекта: отчёты разборов и документы, которые ведут пользователь и агент.
 *
 * Это не материалы для анализа — те загружаются в «Материалы». Поэтому здесь
 * нет загрузки с компьютера: две кнопки «загрузить» в соседних разделах
 * заставляли угадывать, какая из них кормит разбор. Создать документ или папку
 * — редкие действия, им место в небольшом меню у заголовка, а не во всю ширину
 * колонки.
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

const ROOT_LABEL = "Проект";

export function FileExplorer({ openedId, onOpen, onNodes, revision }: Props) {
  const [nodes, setNodes] = useState<StudioNode[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  /* Выделение отдельно от открытого файла: папку можно выбрать, но не открыть,
     и именно выбранная папка решает, куда лягут новые элементы. */
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/studio/files", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { nodes?: StudioNode[]; error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "Файлы проекта не открылись.");
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
    return folder ? `${ROOT_LABEL}/${nodePath(nodes, folder)}` : ROOT_LABEL;
  }, [nodes, target]);

  /** Раскрыть папку со всеми предками, чтобы новый элемент было видно. */
  function reveal(folderId: string | null) {
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
    /* Новый документ сразу открывается: создают его затем, чтобы писать. */
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
            placeholder={draft.kind === "folder" ? "Имя папки" : "Имя документа"}
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
            aria-expanded={folder ? expanded : undefined}
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
              <button
                type="button"
                onClick={() => setRenaming(node.id)}
                title="Переименовать"
                aria-label={`Переименовать «${node.name}»`}
              >
                <PencilIcon />
              </button>
              <button type="button" onClick={() => remove(node)} title="Удалить" aria-label={`Удалить «${node.name}»`}>
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
    <SideSection
      title="Файлы проекта"
      meta={files ? `${files} ${plural(files)}` : undefined}
      actions={<CreateMenu target={targetLabel} onPick={startDraft} />}
    >
      <div className="st-explorer-body">
        <button
          type="button"
          className={cx("st-tree-root", selected === null && "is-target")}
          onClick={() => setSelected(null)}
          title="Выбрать корень проекта: новые документы и папки лягут сюда"
        >
          {ROOT_LABEL}
        </button>

        <ul className="st-tree-list">
          {(children.get(null) ?? []).map((node) => renderRow(node, 1))}
          {draftRow(null, 1)}
        </ul>

        {loaded && !nodes.length && !draft ? (
          <p className="st-side-empty">
            Отчёты разборов появятся здесь сами. Документ или папку можно создать кнопкой «+» у заголовка.
          </p>
        ) : null}

        {error ? (
          <p className="st-explorer-error" role="alert">
            {error}
            <button type="button" onClick={() => setError(null)} aria-label="Скрыть ошибку">
              <CloseIcon />
            </button>
          </p>
        ) : null}
      </div>
    </SideSection>
  );
}

/**
 * Меню «Создать» у заголовка раздела.
 *
 * Поведение обычного меню: фокус на первом пункте, стрелки водят, Escape
 * закрывает и возвращает фокус на кнопку, клик мимо закрывает.
 */
function CreateMenu({ target, onPick }: { target: string; onPick: (kind: StudioNode["kind"]) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function pick(kind: StudioNode["kind"]) {
    setOpen(false);
    onPick(kind);
  }

  return (
    <div className="st-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="st-side-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Создать документ или папку"
        data-tip="Создать документ или папку"
        onClick={() => setOpen((value) => !value)}
      >
        <PlusIcon />
      </button>

      {open ? (
        <div
          className="st-menu-list"
          role="menu"
          aria-label="Создать в проекте"
          onKeyDown={(event) => {
            const list = items.current.filter((item): item is HTMLButtonElement => Boolean(item));
            const index = list.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              list[(index + 1) % list.length]?.focus();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              list[(index - 1 + list.length) % list.length]?.focus();
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          <button
            ref={(element) => {
              items.current[0] = element;
            }}
            type="button"
            role="menuitem"
            onClick={() => pick("file")}
          >
            <FilePlusIcon />
            <span>Создать документ</span>
          </button>
          <button
            ref={(element) => {
              items.current[1] = element;
            }}
            type="button"
            role="menuitem"
            onClick={() => pick("folder")}
          >
            <FolderPlusIcon />
            <span>Создать папку</span>
          </button>
          <p className="st-menu-note" title={target}>
            Куда: {target}
          </p>
        </div>
      ) : null}
    </div>
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
