"use client";

import { useEffect, useRef, useState } from "react";

import { CheckIcon, CloseIcon, PencilIcon } from "@/components/studio/icons";
import { ReportMarkdown } from "@/components/studio/report-markdown";
import { cx } from "@/lib/studio/cx";
import { checkReport, checkVerdict, type Finding } from "@/lib/studio/review";
import type { StudioNode } from "@/lib/studio/types";

/**
 * Открытый файл проекта — содержимое одной вкладки.
 *
 * Два состояния: чтение — отчёт как он выглядит, правка — исходный текст. Одно
 * не подменяет другое: разметку удобно читать отрисованной, а исправлять
 * только в исходнике, и попытка совместить даёт редактор, в котором неудобно
 * ни то ни другое.
 *
 * Вкладка остаётся смонтированной, пока открыта, и только прячется: иначе
 * переход на соседнюю вкладку стирал бы несохранённую правку.
 */

type Props = {
  node: StudioNode;
  hidden: boolean;
  onSaved: () => void;
  /** Есть ли несохранённая правка: вкладка показывает точку и переспрашивает перед закрытием. */
  onDirty: (id: string, dirty: boolean) => void;
};

export function FileView({ node, hidden, onSaved, onDirty }: Props) {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "failed">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);

  const dirty = editing && draft !== content;
  const dirtyRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
    onDirty(node.id, dirty);
  }, [dirty, node.id, onDirty]);

  /* Файл перечитывается и тогда, когда сменилась его отметка времени: агент мог
     переписать его, пока вкладка открыта. Несохранённая правка важнее — поверх
     неё ничего не перечитывается, иначе набранное пропало бы без предупреждения. */
  useEffect(() => {
    if (dirtyRef.current) return;
    let alive = true;
    (async () => {
      const response = await fetch(`/api/studio/files/${node.id}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { content?: string } | null;
      if (!alive) return;
      if (!response.ok) {
        setState("failed");
        return;
      }
      setContent(body?.content ?? "");
      setDraft(body?.content ?? "");
      setState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [node.id, node.updatedAt]);

  async function save() {
    if (state !== "ready") return;
    setState("saving");
    setProblem(null);
    const response = await fetch(`/api/studio/files/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: draft }),
    });
    if (!response.ok) {
      /* Правка остаётся в редакторе: сорвавшееся сохранение не должно стоить набранного текста. */
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setProblem(body?.error ?? "Не сохранилось. Попробуйте ещё раз.");
      setState("ready");
      return;
    }
    setContent(draft);
    setEditing(false);
    setState("ready");
    onSaved();
  }

  const verdict = findings ? checkVerdict(findings) : null;

  return (
    <div className="st-file" hidden={hidden}>
      <header className="st-file-head">
        <div className="st-file-title">
          <strong>{node.name}</strong>
          <span>
            {state === "loading"
              ? "открывается…"
              : problem ?? `${(editing ? draft : content).length.toLocaleString("ru-RU")} символов`}
          </span>
        </div>

        <div className="st-file-tools">
          <button
            type="button"
            onClick={() => setFindings(checkReport(editing ? draft : content))}
            disabled={state === "loading" || state === "failed"}
            title="Проверить отчёт: разделы, пометки, источники"
          >
            <CheckIcon />
            <span>Проверить</span>
          </button>
          {editing ? (
            <>
              <button type="button" className="st-file-primary" onClick={save} disabled={state === "saving"}>
                {state === "saving" ? "Сохраняем…" : "Сохранить"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(content);
                  setEditing(false);
                  setProblem(null);
                }}
              >
                Отменить
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} disabled={state !== "ready"}>
              <PencilIcon />
              <span>Править</span>
            </button>
          )}
        </div>
      </header>

      {verdict ? (
        <section className={cx("st-verdict", `is-${verdict.level}`)} aria-label="Результат проверки">
          <div className="st-verdict-head">
            <CheckIcon />
            <strong>{verdict.text}</strong>
            <button type="button" onClick={() => setFindings(null)} aria-label="Скрыть проверку">
              <CloseIcon />
            </button>
          </div>
          <ul>
            {findings?.map((finding, index) => (
              <li key={index} className={`is-${finding.level}`}>
                <span>{finding.title}</span>
                {finding.detail ? <em>{finding.detail}</em> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="st-file-body">
        {state === "failed" ? (
          <p className="st-file-error">Файл не открылся. Закройте вкладку и откройте его из проводника снова.</p>
        ) : editing ? (
          <textarea
            className="st-file-editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              /* Ctrl+S сохраняет, а не открывает браузерное «Сохранить страницу». */
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                void save();
              }
            }}
            spellCheck={false}
            aria-label={`Текст файла «${node.name}»`}
          />
        ) : content.trim() ? (
          <div className="st-report-body">
            <ReportMarkdown source={content} />
          </div>
        ) : state === "ready" ? (
          <p className="st-file-error">Файл пуст. Нажмите «Править» и напишите текст, либо попросите Луру записать сюда что-нибудь.</p>
        ) : null}
      </div>
    </div>
  );
}
