"use client";

import { useId, useState, type ReactNode } from "react";

import { ChevronIcon } from "@/components/studio/icons";
import { cx } from "@/lib/studio/cx";

/**
 * Раздел левой колонки: заголовок, который сворачивает содержимое, короткая
 * подпись и действия раздела.
 *
 * Разделов три — материалы, разборы, файлы проекта, — и на невысоком экране
 * все сразу не помещаются: свернуть ненужный сейчас удобнее, чем прокручивать
 * мимо него.
 */

type Props = {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function SideSection({ title, meta, actions, children, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <section className={cx("st-side-section", !open && "is-closed")} aria-labelledby={`${id}-title`}>
      <div className="st-side-head">
        <h2 className="st-side-title" id={`${id}-title`}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => setOpen((value) => !value)}
          >
            <span className={cx("st-side-caret", open && "is-open")} aria-hidden="true">
              <ChevronIcon />
            </span>
            {title}
          </button>
        </h2>
        {meta ? <span className="st-side-meta">{meta}</span> : null}
        {actions ? <div className="st-side-actions">{actions}</div> : null}
      </div>
      <div className="st-side-body" id={`${id}-body`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
