"use client";

import type { ProductContextSummary, WorkspaceDocument } from "@/lib/api";
import { formatDate } from "@/lib/workspace-data";

type SourcesPaneProps = {
  documents: WorkspaceDocument[];
  summary: ProductContextSummary | null;
  seeding: boolean;
  onUpload: () => void;
  onSeed: () => void;
  onDelete: (documentId: string) => void;
};

export function SourcesPane({ documents, summary, seeding, onUpload, onSeed, onDelete }: SourcesPaneProps) {
  const chunks = documents.reduce((total, document) => total + document.chunk_count, 0);

  return (
    <aside className="ws-sources" aria-label="Источники">
      <div className="ws-pane-head">
        <h2>Источники</h2>
        <span className="ws-count">{documents.length}</span>
      </div>

      <button className="ws-button ws-button-primary ws-block" onClick={onUpload}>
        + Загрузить данные
      </button>

      {documents.length > 0 && (
        <p className="ws-hint">
          {chunks} фрагмент(ов) в индексе. Ассистент подбирает подходящие к каждому вопросу.
        </p>
      )}

      <div className="ws-source-list">
        {documents.length === 0 && (
          <p className="ws-empty">
            Загрузите отзывы, changelog, заметки со встреч или выгрузку тикетов — они станут
            контекстом для ассистента.
          </p>
        )}
        {documents.map((document) => (
          <article className="ws-source" key={document.id}>
            <div className="ws-source-main">
              <strong title={document.title}>{document.title}</strong>
              <span>
                {document.chunk_count} фр. · {formatDate(document.created_at)}
              </span>
            </div>
            <button
              className="ws-icon-button"
              onClick={() => onDelete(document.id)}
              aria-label={`Удалить ${document.title}`}
              title="Удалить"
            >
              ✕
            </button>
          </article>
        ))}
      </div>

      <div className="ws-sources-foot">
        <p className="ws-pane-label">Продуктовые данные</p>
        <div className="ws-mini-stats">
          <span>{summary?.releases ?? 0} релизов</span>
          <span>{summary?.feedback_signals ?? 0} сигналов</span>
          <span>{summary?.metric_snapshots ?? 0} метрик</span>
        </div>
        <button className="ws-button ws-button-quiet ws-block" onClick={onSeed} disabled={seeding}>
          {seeding ? "Загружаем..." : "Демо-набор"}
        </button>
      </div>
    </aside>
  );
}
