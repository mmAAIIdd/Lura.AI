"use client";

import { useEffect, useState } from "react";

import { CheckIcon, CloseIcon, PencilIcon } from "@/components/studio/icons";
import { ReportMarkdown } from "@/components/studio/report-markdown";
import { cx } from "@/lib/studio/cx";
import { checkReport, checkVerdict, type Finding } from "@/lib/studio/review";
import type { StudioNode } from "@/lib/studio/types";

/**
 * Открытый файл проекта.
 *
 * Два состояния: чтение — отчёт как он выглядит, правка — исходный текст. Одно
 * не подменяет другое: разметку удобно читать отрисованной, а исправлять
 * только в исходнике, и попытка совместить даёт редактор, в котором неудобно
 * ни то ни другое.
 */

type Props = {
  node: StudioNode;
  /** Ненулевое значение — снаружи попросили проверку (кнопка в проводнике). */
  checkToken: number;
  onSaved: () => void;
  onClose: () => void;
};

export function FileView({ node, checkToken, onSaved, onClose }: Props) {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "failed">("loading");
  const [findings, setFindings] = useState<Finding[] | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    setEditing(false);
    setFindings(null);
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
  }, [node.id]);

  /* Проверка запускается кнопкой из проводника, поэтому приходит счётчиком:
     повторное нажатие на тот же файл обязано перезапустить её, а не молчать. */
  useEffect(() => {
    if (!checkToken || state !== "ready") return;
    setFindings(checkReport(editing ? draft : content));
  }, [checkToken, state, content, draft, editing]);

  async function save() {
    setState("saving");
    const response = await fetch(`/api/studio/files/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: draft }),
    });
    if (!response.ok) {
      setState("failed");
      return;
    }
    setContent(draft);
    setEditing(false);
    setState("ready");
    onSaved();
  }

  const verdict = findings ? checkVerdict(findings) : null;

  return (
    <div className="st-file">
      <header className="st-file-head">
        <div className="st-file-title">
          <strong>{node.name}</strong>
          <span>{state === "loading" ? "открывается…" : `${content.length.toLocaleString("ru-RU")} символов`}</span>
        </div>

        <div className="st-file-tools">
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
          <button type="button" onClick={onClose} title="Закрыть файл" aria-label="Закрыть файл">
            <CloseIcon />
          </button>
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
          <p className="st-file-error">Файл не открылся. Обновите проводник и попробуйте снова.</p>
        ) : editing ? (
          <textarea
            className="st-file-editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            aria-label="Исходный текст отчёта"
          />
        ) : content.trim() ? (
          <div className="st-report-body">
            <ReportMarkdown source={content} />
          </div>
        ) : (
          <p className="st-file-error">Файл пуст. Нажмите «Править» и напишите текст, либо попросите Луру записать сюда разбор.</p>
        )}
      </div>
    </div>
  );
}
