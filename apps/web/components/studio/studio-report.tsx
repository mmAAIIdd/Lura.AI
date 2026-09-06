"use client";

import { LuraLogo } from "@/components/lura-logo";
import { ReportMarkdown } from "@/components/studio/report-markdown";
import { REPORT_COMMAND } from "@/lib/studio/command";
import type { StudioMessage, ToolTrace } from "@/lib/studio/types";

/**
 * Центральное окно — поле ответа и ничего больше.
 *
 * Ни заголовков, ни кнопок поверх текста: всё служебное живёт в панели
 * справа. Пока ответа нет, здесь стоит начальный экран: один знак посреди
 * белого поля читается как незагрузившаяся страница, а не как «спросите».
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
          <div className="st-idle-inner">
            {/* Знак в рамке, а не сам по себе: выцветший силуэт посреди пустого
                листа читается как недогрузившаяся картинка, а не как состояние
                экрана. */}
            <span className="st-idle-badge">
              <LuraLogo className="st-idle-mark" />
            </span>
            <h1>Ответ появится здесь</h1>
            <p>
              Спросите Луру в панели рядом. Полный разбор продукта с отчётом запускает
              команда <code>{REPORT_COMMAND}</code>.
            </p>
          </div>
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
