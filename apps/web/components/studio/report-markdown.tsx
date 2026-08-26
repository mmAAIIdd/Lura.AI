"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Рендер отчёта.
 *
 * Отдельно от components/markdown.tsx: тому хватает заголовков и списков, а
 * здесь нужны таблицы — сравнение «до и после» агент выдаёт именно ими, и без
 * поддержки таблиц отчёт превращается в строку с палками. Библиотека не
 * ставится: приложение живёт без рантайм-зависимостей, а нужен разбор шести
 * видов блоков. Ничего не вставляется как HTML.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\([^)\s]+\))/g;

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
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
    if (link) {
      const href = link[2];
      /* Только http(s): javascript: в ссылке из ответа модели — это XSS. */
      if (/^https?:\/\//i.test(href)) {
        return (
          <a key={index} href={href} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>
        );
      }
      return <Fragment key={index}>{link[1]}</Fragment>;
    }
    return <Fragment key={index}>{token}</Fragment>;
  });
}

type Block =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

function tableCells(line: string): string[] {
  return line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function isDivider(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flush();
      continue;
    }

    if (trimmed.startsWith("```")) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const depth = heading[1].length;
      blocks.push({ kind: "heading", level: depth <= 2 ? 2 : depth === 3 ? 3 : 4, text: heading[2] });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    if (trimmed.startsWith("|") && isDivider(lines[i + 1] ?? "")) {
      flush();
      const head = tableCells(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(tableCells(lines[i].trim()));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flush();
      blocks.push({ kind: "quote", text: trimmed.slice(2) });
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const previous = blocks[blocks.length - 1];
      const item = (bullet ? bullet[1] : numbered![2]).trim();
      if (previous?.kind === "list" && previous.ordered === ordered) previous.items.push(item);
      /* Нумерация берётся из самого текста. Вложенные пояснения разрывают
         список, и без start второй пункт «2.» отрисовывался снова единицей —
         в отчёте с решениями это читается как две разные первые задачи. */
      else blocks.push({ kind: "list", ordered, start: ordered ? Number(numbered![1]) || 1 : 1, items: [item] });
      continue;
    }

    paragraph.push(trimmed);
  }

  flush();
  return blocks;
}

export function ReportMarkdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);

  return (
    <div className="report">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const Tag = (`h${block.level}` as unknown) as "h2";
          return <Tag key={index}>{renderInline(block.text)}</Tag>;
        }
        if (block.kind === "list") {
          if (block.ordered) {
            return (
              <ol key={index} start={block.start}>
                {block.items.map((item, position) => (
                  <li key={position}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          }
          const Tag = "ul";
          return (
            <Tag key={index}>
              {block.items.map((item, position) => (
                <li key={position}>{renderInline(item)}</li>
              ))}
            </Tag>
          );
        }
        if (block.kind === "table") {
          return (
            <div className="report-table" key={index}>
              <table>
                <thead>
                  <tr>
                    {block.head.map((cell, position) => (
                      <th key={position}>{renderInline(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, position) => (
                        <td key={position}>{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.kind === "code") return <pre key={index}>{block.text}</pre>;
        if (block.kind === "quote") return <blockquote key={index}>{renderInline(block.text)}</blockquote>;
        if (block.kind === "rule") return <hr key={index} />;
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}
