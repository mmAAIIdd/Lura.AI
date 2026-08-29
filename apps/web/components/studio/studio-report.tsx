"use client";

import { LuraLogo } from "@/components/lura-logo";
import { ReportMarkdown } from "@/components/studio/report-markdown";
import type { StudioMessage, ToolTrace } from "@/lib/studio/types";

/**
 * Центральное окно — поле ответа и ничего больше.
 *
 * Ни заголовков, ни подсказок, ни кнопок поверх текста: всё служебное живёт
 * в рельсе и в статусной строке. Пока разбора нет — пустое поле со знаком.
 */

type Props = {
  message: StudioMessage | null;
  streaming: { text: string; tools: ToolTrace[] } | null;
};

export function StudioReport({ message, streaming }: Props) {
  if (streaming) {
    return (
      <div className="st-report">
        <div className="st-report-body">
          {streaming.text ? <ReportMarkdown source={streaming.text} /> : <Working tools={streaming.tools} />}
        </div>
      </div>
    );
  }

  if (!message) {
    return (
      <div className="st-report">
        <div className="st-idle">
          <LuraLogo className="st-idle-mark" />
        </div>
      </div>
    );
  }

  const sources = [...new Map((message.tools ?? []).flatMap((t) => t.sources ?? []).map((s) => [s.url, s])).values()];

  return (
    <div className="st-report">
      <div className="st-report-body">
        <ReportMarkdown source={message.text} />

        {sources.length ? (
          <section className="st-report-sources">
            <ul>
              {sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.title || source.url}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Пока текста нет — то, чем агент занят прямо сейчас. */
function Working({ tools }: { tools: ToolTrace[] }) {
  const last = tools[tools.length - 1];
  return (
    <div className="st-working">
      <p>{last ? describe(last) : "…"}</p>
      <span />
      <span />
      <span />
    </div>
  );
}

function describe(trace: ToolTrace): string {
  if (trace.name === "web_search") return `Ищет: ${trace.argument}`;
  if (trace.name === "fetch_url") return `Читает: ${trace.argument}`;
  return `Документы: ${trace.argument}`;
}
