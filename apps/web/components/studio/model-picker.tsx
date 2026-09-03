"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "@/lib/studio/cx";
import type { LuraModel } from "@/lib/studio/types";

/**
 * Выбор модели.
 *
 * Своё меню вместо <select>: системный список рисует операционная система, и
 * в нём нельзя ни объяснить разницу между моделями, ни попасть в оформление
 * остального интерфейса. Здесь у каждой модели есть строка о том, чем она
 * отличается, — иначе выбор сводится к угадыванию по имени.
 *
 * Поведение обычного списка сохранено: стрелки водят по пунктам, Enter
 * выбирает, Escape отменяет и возвращает фокус на кнопку, клик мимо закрывает.
 */

const ABOUT: Record<LuraModel, string> = {
  "lura-pro": "Точнее, отвечает дольше",
  "lura-fast": "Быстрые ответы",
};

type Props = {
  value: LuraModel;
  options: LuraModel[];
  disabled?: boolean;
  onChange: (model: LuraModel) => void;
};

export function ModelPicker({ value, options, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  /* Меню закрывается при клике мимо и при уходе фокуса из него: открытый
     список, переживший переход к другому элементу, перекрывает интерфейс. */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  /* Кнопка отключается на время ответа — открытое меню в этот момент повисло
     бы поверх недоступного выбора. */
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function show() {
    setActive(Math.max(options.indexOf(value), 0));
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function choose(model: LuraModel) {
    onChange(model);
    close();
  }

  return (
    <div className="st-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={cx("st-picker-trigger", open && "is-open")}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Модель: ${value}`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span>{value}</span>
        <ChevronIcon />
      </button>

      {open ? (
        <div
          ref={list}
          className="st-picker-menu"
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`model-${options[active]}`}
          onBlur={(event) => {
            if (!root.current?.contains(event.relatedTarget as Node)) setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => (index + 1) % options.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => (index - 1 + options.length) % options.length);
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              choose(options[active]);
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {options.map((model, index) => (
            <div
              key={model}
              id={`model-${model}`}
              role="option"
              aria-selected={model === value}
              className={cx("st-picker-item", index === active && "is-active", model === value && "is-current")}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(model)}
            >
              <span className="st-picker-mark" aria-hidden="true">
                {model === value ? <CheckIcon /> : null}
              </span>
              <span className="st-picker-text">
                <b>{model}</b>
                <small>{ABOUT[model] ?? ""}</small>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 9.75 8 6.25l3.5 3.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5l6-7" />
    </svg>
  );
}
