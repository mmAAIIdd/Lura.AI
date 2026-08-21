"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Minimal Markdown renderer for assistant replies.
 *
 * The web app intentionally has no runtime dependencies beyond React, so this covers the
 * subset models actually emit — headings, bold, italics, inline code, lists, rules — and
 * renders everything else as plain text. Nothing is injected as HTML.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return <code key={index}>{token.slice(1, -1)}</code>;
    }
    if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }
    return <Fragment key={index}>{token}</Fragment>;
  });
}

type Block =
  | { kind: "heading"; level: 3 | 4; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length <= 3 ? 3 : 4, text: heading[2] });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)![1];
      if (list && list.ordered === ordered) list.items.push(item);
      else {
        flushList();
        list = { ordered, items: [item] };
      }
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export function Markdown({ children }: { children: string }) {
  const blocks = parseBlocks(children);

  return (
    <div className="md">
      {blocks.map((block, index) => {
        if (block.kind === "rule") return <hr key={index} />;
        if (block.kind === "heading") {
          return block.level === 3
            ? <h3 key={index}>{renderInline(block.text)}</h3>
            : <h4 key={index}>{renderInline(block.text)}</h4>;
        }
        if (block.kind === "list") {
          const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>);
          return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
        }
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}
