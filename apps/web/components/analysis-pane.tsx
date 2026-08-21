"use client";

import type { ProductContextSummary } from "@/lib/api";
import {
  clusterConfidence,
  formatDate,
  formatMetricValue,
  type ReleaseComparison,
  type TopicCluster,
} from "@/lib/workspace-data";

type AnalysisPaneProps = {
  summary: ProductContextSummary | null;
  clusters: TopicCluster[];
  comparisons: ReleaseComparison[];
  seeding: boolean;
  onSeed: () => void;
};

/** Up to three quotes, negatives first — they carry the signal a reader is looking for. */
function pickQuotes(cluster: TopicCluster): string[] {
  const negative = cluster.signals.filter((signal) => signal.sentiment === "negative");
  const rest = cluster.signals.filter((signal) => signal.sentiment !== "negative");
  return [...negative, ...rest].slice(0, 3).map((signal) => signal.content);
}

function sourceSummary(cluster: TopicCluster): string {
  const counts = new Map<string, number>();
  for (const signal of cluster.signals) {
    counts.set(signal.source, (counts.get(signal.source) ?? 0) + 1);
  }
  return [...counts.entries()].map(([source, count]) => `${source} ${count}`).join(", ");
}

export function AnalysisPane({ summary, clusters, comparisons, seeding, onSeed }: AnalysisPaneProps) {
  const hasData = Boolean(summary && (summary.feedback_signals || summary.releases || summary.metric_snapshots));

  return (
    <section className="analysis-pane" aria-label="Результаты анализа">
      <div className="ws-pane-head">
        <h2>Что говорят данные</h2>
        <span className="ws-pane-note">факты и корреляции считаются по базе</span>
      </div>

      {!hasData ? (
        <div className="pane-empty">
          <div className="pane-empty-card">
            <h3>Продуктовых данных пока нет</h3>
            <p>
              Этот раздел строится из релизов, обратной связи и метрик. Он считается напрямую по базе,
              без участия модели — поэтому здесь только факты и корреляции.
            </p>
            <p className="ws-hint">
              Гипотезы и рекомендации формируются отдельно, в панели ассистента справа.
            </p>
            <button className="ws-button ws-button-primary" onClick={onSeed} disabled={seeding}>
              {seeding ? "Загружаем..." : "Загрузить демо-набор"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="summary-strip">
            <div><strong>{summary?.releases ?? 0}</strong><span>релизов</span></div>
            <div><strong>{summary?.feedback_signals ?? 0}</strong><span>сигналов</span></div>
            <div><strong>{summary?.negative_feedback ?? 0}</strong><span>негативных</span></div>
            <div><strong>{summary?.metric_snapshots ?? 0}</strong><span>замеров метрик</span></div>
            <div><strong>{summary?.unlinked_feedback ?? 0}</strong><span>без релиза</span></div>
          </div>

          <h3 className="pane-section-title">Темы обратной связи</h3>
          {clusters.length === 0 && <p className="empty-state">Обратной связи пока нет.</p>}
          {clusters.map((cluster) => {
            const confidence = clusterConfidence(cluster);
            return (
              <article className="finding-card" key={cluster.key}>
                <header>
                  <h4>{cluster.topic}</h4>
                  <span className={`confidence-badge confidence-${confidence.level}`}>
                    уверенность: {confidence.label}
                  </span>
                </header>

                <div className="finding-section">
                  <span className="finding-label">Наблюдение</span>
                  <p>
                    {cluster.total} сигнал(ов) по теме «{cluster.topic}», из них {cluster.negative} негативных.
                    Период: {formatDate(cluster.firstSeen)} — {formatDate(cluster.lastSeen)}.
                  </p>
                </div>

                <div className="finding-section">
                  <span className="finding-label">Доказательства</span>
                  <ul className="evidence-list">
                    <li>Источники: {sourceSummary(cluster)}</li>
                    <li>Доля от всего объёма: {Math.round(cluster.share * 100)}%</li>
                    <li>
                      Привязано к релизу: {cluster.signals.filter((signal) => signal.release_id).length} из {cluster.total}
                    </li>
                  </ul>
                  {pickQuotes(cluster).map((quote, index) => (
                    <p className="quote" key={index}>«{quote}»</p>
                  ))}
                </div>

                <div className="finding-section">
                  <span className="finding-label">Влияние</span>
                  <p>
                    негативных {cluster.negative} · нейтральных {cluster.neutral} · позитивных {cluster.positive}
                  </p>
                </div>

                <div className="finding-section">
                  <span className="finding-label">Уверенность</span>
                  <p>{confidence.reason}</p>
                </div>

                <div className="pending-block">
                  <span className="finding-label">Гипотезы и рекомендация</span>
                  <p>
                    Не рассчитываются автоматически. Эти уровни требуют интерпретации — запросите их
                    в командной панели: <code>/анализ фидбека</code>
                  </p>
                </div>
              </article>
            );
          })}

          <h3 className="pane-section-title">До и после релиза</h3>
          {comparisons.length === 0 && <p className="empty-state">Релизов пока нет.</p>}
          {comparisons.map((comparison) => (
            <article className="release-compare" key={comparison.release.id}>
              <header>
                <h4>
                  {comparison.release.version} · {comparison.release.title}
                </h4>
                <span>{formatDate(comparison.release.released_at)}</span>
              </header>
              {comparison.release.summary && <p className="release-summary">{comparison.release.summary}</p>}
              <p className="release-volume">
                Обратная связь за 14 дней: до {comparison.feedbackBefore} → после {comparison.feedbackAfter}
              </p>
              {comparison.metrics.length === 0 ? (
                <p className="empty-state">Метрик вокруг этого релиза нет.</p>
              ) : (
                <ul className="metric-list">
                  {comparison.metrics.map((metric) => (
                    <li key={`${metric.metricKey}-${metric.segment}`}>
                      <span className="metric-name">
                        {metric.label} <em>[{metric.segment}]</em>
                      </span>
                      <span className="metric-values">
                        {formatMetricValue(metric.before, metric.unit)} → {formatMetricValue(metric.after, metric.unit)}
                        <strong className={metric.delta >= 0 ? "metric-delta metric-up" : "metric-delta metric-down"}>
                          {metric.delta >= 0 ? "+" : ""}
                          {Math.round(metric.delta * 100) / 100}
                        </strong>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
