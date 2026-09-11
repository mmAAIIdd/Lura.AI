"use client";

import { useEffect, useRef } from "react";

import { CloseIcon, FileIcon } from "@/components/studio/icons";
import { cx } from "@/lib/studio/cx";
import type { StudioNode } from "@/lib/studio/types";

/**
 * Вкладки открытых файлов — как в редакторе кода.
 *
 * Открыть файл значит добавить вкладку, а не заменить единственный экран: к
 * отчёту, который правишь, постоянно возвращаешься из соседнего, и искать его
 * заново в дереве на каждом переходе утомительно.
 */

type Props = {
  tabs: StudioNode[];
  /** Активная вкладка; null — в центре сейчас разбор или кастомизация. */
  active: string | null;
  dirty: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

export function FileTabs({ tabs, active, dirty, onSelect, onClose }: Props) {
  const strip = useRef<HTMLDivElement>(null);

  /* Вкладок больше, чем влезает, — активная прокручивается в видимую часть. */
  useEffect(() => {
    strip.current?.querySelector(".st-filetab.is-on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);

  return (
    <div className="st-filetabs" role="tablist" aria-label="Открытые файлы" ref={strip}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        const changed = dirty.has(tab.id);
        return (
          <div
            key={tab.id}
            className={cx("st-filetab", on && "is-on")}
            /* Средняя кнопка мыши закрывает вкладку — привычка из браузера и редактора. */
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              onClose(tab.id);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={on}
              className="st-filetab-open"
              onClick={() => onSelect(tab.id)}
              title={tab.name}
            >
              <FileIcon />
              <span>{tab.name}</span>
            </button>
            <button
              type="button"
              className={cx("st-filetab-close", changed && "is-dirty")}
              onClick={() => onClose(tab.id)}
              title={changed ? "Есть несохранённые правки — закрыть" : "Закрыть"}
              aria-label={changed ? `Закрыть «${tab.name}», есть несохранённые правки` : `Закрыть «${tab.name}»`}
            >
              <span className="st-filetab-dot" aria-hidden="true" />
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
