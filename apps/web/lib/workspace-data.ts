import {
  ApiError,
  luraApi,
  type FeedbackSignal,
  type MetricSnapshot,
  type ProductContextSummary,
  type ProductRelease,
} from "@/lib/api";

const UNTITLED_TOPIC = "Без темы";

export type TopicCluster = {
  key: string;
  topic: string;
  signals: FeedbackSignal[];
  total: number;
  negative: number;
  neutral: number;
  positive: number;
  share: number;
  firstSeen: string;
  lastSeen: string;
  linkedReleaseIds: string[];
};

export type Confidence = {
  /** Latin key so it can be used directly in a CSS class name. */
  level: "low" | "medium" | "high";
  label: string;
  reason: string;
};

export type MetricComparison = {
  metricKey: string;
  label: string;
  segment: string;
  unit: string | null;
  before: number;
  after: number;
  delta: number;
};

export type ReleaseComparison = {
  release: ProductRelease;
  metrics: MetricComparison[];
  feedbackBefore: number;
  feedbackAfter: number;
};

/** Groups signals by `topic`. Matching is exact after normalisation — no semantic clustering. */
export function groupFeedbackByTopic(signals: FeedbackSignal[]): TopicCluster[] {
  const buckets = new Map<string, { label: string; signals: FeedbackSignal[] }>();

  for (const signal of signals) {
    const label = signal.topic?.trim() || UNTITLED_TOPIC;
    const key = label.toLowerCase();
    const bucket = buckets.get(key) ?? { label, signals: [] };
    bucket.signals.push(signal);
    buckets.set(key, bucket);
  }

  const clusters = [...buckets.entries()].map(([key, bucket]) => {
    const occurred = bucket.signals.map((signal) => signal.occurred_at).sort();
    return {
      key,
      topic: bucket.label,
      signals: [...bucket.signals].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      total: bucket.signals.length,
      negative: bucket.signals.filter((signal) => signal.sentiment === "negative").length,
      neutral: bucket.signals.filter((signal) => signal.sentiment === "neutral").length,
      positive: bucket.signals.filter((signal) => signal.sentiment === "positive").length,
      share: signals.length ? bucket.signals.length / signals.length : 0,
      firstSeen: occurred[0] ?? "",
      lastSeen: occurred[occurred.length - 1] ?? "",
      linkedReleaseIds: [...new Set(bucket.signals.map((signal) => signal.release_id).filter((id): id is string => Boolean(id)))],
    };
  });

  return clusters.sort((a, b) => b.total - a.total || b.negative - a.negative);
}

/**
 * Splits signals around a release date. With `windowDays` both sides are bounded to that window,
 * which keeps a comparison from reaching across neighbouring releases.
 */
export function splitAroundRelease(
  signals: FeedbackSignal[],
  release: ProductRelease,
  windowDays?: number,
): { before: FeedbackSignal[]; after: FeedbackSignal[] } {
  const releasedAt = Date.parse(release.released_at);
  const span = windowDays === undefined ? undefined : windowDays * 24 * 60 * 60 * 1000;
  const before: FeedbackSignal[] = [];
  const after: FeedbackSignal[] = [];

  for (const signal of signals) {
    const occurredAt = Date.parse(signal.occurred_at);
    if (Number.isNaN(occurredAt)) continue;
    if (occurredAt < releasedAt) {
      if (span === undefined || occurredAt >= releasedAt - span) before.push(signal);
    } else if (span === undefined || occurredAt <= releasedAt + span) {
      after.push(signal);
    }
  }

  return { before, after };
}

/** Last value before the release vs first value after it, per metric and segment. */
export function compareMetricAroundRelease(
  snapshots: MetricSnapshot[],
  release: ProductRelease,
): MetricComparison[] {
  const releasedAt = Date.parse(release.released_at);
  const series = new Map<string, MetricSnapshot[]>();

  for (const snapshot of snapshots) {
    const key = `${snapshot.metric_key}::${snapshot.segment}`;
    series.set(key, [...(series.get(key) ?? []), snapshot]);
  }

  const comparisons: MetricComparison[] = [];
  for (const points of series.values()) {
    const ordered = [...points].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
    const before = [...ordered].reverse().find((point) => Date.parse(point.measured_at) < releasedAt);
    const after = ordered.find((point) => Date.parse(point.measured_at) >= releasedAt);
    if (!before || !after) continue;
    comparisons.push({
      metricKey: after.metric_key,
      label: after.label,
      segment: after.segment,
      unit: after.unit,
      before: before.value,
      after: after.value,
      delta: after.value - before.value,
    });
  }

  return comparisons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function buildReleaseComparisons(
  releases: ProductRelease[],
  signals: FeedbackSignal[],
  snapshots: MetricSnapshot[],
  windowDays = 14,
): ReleaseComparison[] {
  return [...releases]
    .sort((a, b) => b.released_at.localeCompare(a.released_at))
    .map((release) => {
      const split = splitAroundRelease(signals, release, windowDays);
      return {
        release,
        metrics: compareMetricAroundRelease(snapshots, release),
        feedbackBefore: split.before.length,
        feedbackAfter: split.after.length,
      };
    });
}

/** Confidence reflects sample size and how clearly the cluster attaches to a release — never a model's opinion. */
export function clusterConfidence(cluster: TopicCluster): Confidence {
  const linkedShare = cluster.signals.filter((signal) => signal.release_id).length / cluster.total;

  const attribution = `${cluster.total} сигналов, ${Math.round(linkedShare * 100)}% привязаны к релизу`;

  if (cluster.total < 5) {
    return { level: "low", label: "низкая", reason: `выборка мала — ${cluster.total} сигнал(ов)` };
  }
  if (linkedShare >= 0.6 && cluster.total >= 10) {
    return { level: "high", label: "высокая", reason: attribution };
  }
  return { level: "medium", label: "средняя", reason: attribution };
}

export function formatMetricValue(value: number, unit: string | null): string {
  const rounded = Math.round(value * 100) / 100;
  return unit ? `${rounded}${unit === "%" ? "%" : ` ${unit}`}` : String(rounded);
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

export type WorkspaceContext = {
  projectName: string;
  summary: ProductContextSummary | null;
  clusters: TopicCluster[];
  comparisons: ReleaseComparison[];
};

export type SlashCommand = {
  slug: string;
  label: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  buildPrompt?: (context: WorkspaceContext) => string;
};

const ANALYSIS_CONTRACT = [
  "Раздели ответ на пять частей и подпиши каждую:",
  "1. Факты — только то, что есть в данных выше.",
  "2. Корреляции — что совпало по времени. Совпадение не равно причине.",
  "3. Гипотезы — возможные объяснения, каждое с уровнем уверенности.",
  "4. Контраргументы — что говорит против каждой гипотезы.",
  "5. Рекомендация и проверка — одно действие и измеримый способ оценить результат.",
  "",
  "Не придумывай числа, которых нет выше. Если данных не хватает — скажи, каких именно.",
].join("\n");

function describeClusters(clusters: TopicCluster[]): string {
  if (!clusters.length) return "Обратной связи в проекте нет.";
  return clusters
    .slice(0, 8)
    .map(
      (cluster) =>
        `- ${cluster.topic}: ${cluster.total} сигналов (негативных ${cluster.negative}, нейтральных ${cluster.neutral}, позитивных ${cluster.positive}), ` +
        `${Math.round(cluster.share * 100)}% всего объёма, с ${formatDate(cluster.firstSeen)} по ${formatDate(cluster.lastSeen)}`,
    )
    .join("\n");
}

function describeComparisons(comparisons: ReleaseComparison[]): string {
  if (!comparisons.length) return "Релизов в проекте нет.";
  return comparisons
    .slice(0, 6)
    .map((comparison) => {
      const metrics = comparison.metrics.length
        ? comparison.metrics
            .map(
              (metric) =>
                `    · ${metric.label} [${metric.segment}]: ${formatMetricValue(metric.before, metric.unit)} → ` +
                `${formatMetricValue(metric.after, metric.unit)} (${metric.delta >= 0 ? "+" : ""}${Math.round(metric.delta * 100) / 100})`,
            )
            .join("\n")
        : "    · метрик вокруг этого релиза нет";
      return (
        `- ${comparison.release.version} «${comparison.release.title}» от ${formatDate(comparison.release.released_at)}\n` +
        `    · обратная связь за 14 дней: до ${comparison.feedbackBefore}, после ${comparison.feedbackAfter}\n${metrics}`
      );
    })
    .join("\n");
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    slug: "/анализ фидбека",
    label: "/анализ фидбека",
    description: "Разбор обратной связи компании по темам и релизам",
    enabled: true,
    buildPrompt: (context) =>
      [
        `Проанализируй обратную связь по продукту «${context.projectName}».`,
        "",
        "ДАННЫЕ (посчитаны из базы проекта, это единственный источник цифр):",
        `Всего сигналов: ${context.summary?.feedback_signals ?? 0}, из них негативных ${context.summary?.negative_feedback ?? 0}, ` +
          `не привязанных к релизу ${context.summary?.unlinked_feedback ?? 0}.`,
        "",
        "Темы:",
        describeClusters(context.clusters),
        "",
        "Релизы и метрики вокруг них:",
        describeComparisons(context.comparisons),
        "",
        ANALYSIS_CONTRACT,
      ].join("\n"),
  },
  {
    slug: "/обзор обновлений",
    label: "/обзор обновлений",
    description: "Что изменилось в релизах и что произошло после",
    enabled: true,
    buildPrompt: (context) =>
      [
        `Сделай обзор последствий релизов продукта «${context.projectName}».`,
        "",
        "ДАННЫЕ (посчитаны из базы проекта, это единственный источник цифр):",
        describeComparisons(context.comparisons),
        "",
        "Темы обратной связи для сопоставления:",
        describeClusters(context.clusters),
        "",
        "Для каждого релиза с заметным сдвигом оцени, связан ли сдвиг именно с ним.",
        "",
        ANALYSIS_CONTRACT,
      ].join("\n"),
  },
  {
    slug: "/аналитика покупок",
    label: "/аналитика покупок",
    description: "Выручка, конверсия в оплату, отток по тарифам",
    enabled: false,
    disabledReason: "нет источника данных о покупках",
  },
  {
    slug: "/внешняя оценка",
    label: "/внешняя оценка",
    description: "Отзывы на внешних площадках и оценки рынка",
    enabled: false,
    disabledReason: "нет подключённых внешних источников",
  },
];

// ---------------------------------------------------------------------------
// Demo dataset
// ---------------------------------------------------------------------------

type DemoFeedback = {
  ref: string;
  releaseVersion: string | null;
  source: FeedbackSignal["source"];
  sentiment: FeedbackSignal["sentiment"];
  topic: string;
  occurredAt: string;
  content: string;
};

const DEMO_RELEASES: Array<Omit<ProductRelease, "id" | "project_id" | "created_at" | "updated_at">> = [
  {
    version: "4.0",
    title: "Новая навигация рабочей области",
    summary: "Переработано боковое меню, разделы сгруппированы по сценариям.",
    status: "released",
    released_at: "2026-06-15T09:00:00Z",
  },
  {
    version: "4.1",
    title: "Переработанный onboarding",
    summary:
      "Добавлен обязательный шаг выбора рабочей области, объединены экраны приглашения команды, изменена терминология.",
    status: "released",
    released_at: "2026-07-20T09:00:00Z",
  },
  {
    version: "4.2",
    title: "Экспорт отчётов и ускорение поиска",
    summary: "Добавлен экспорт в CSV, перестроен индекс поиска.",
    status: "released",
    released_at: "2026-08-05T09:00:00Z",
  },
];

const DEMO_FEEDBACK: DemoFeedback[] = [
  // --- before 4.1: baseline, onboarding barely mentioned -------------------
  { ref: "demo-001", releaseVersion: "4.0", source: "review", sentiment: "positive", topic: "навигация", occurredAt: "2026-06-18T10:12:00Z", content: "Новое меню намного понятнее, наконец нашёл настройки без поиска." },
  { ref: "demo-002", releaseVersion: "4.0", source: "review", sentiment: "neutral", topic: "навигация", occurredAt: "2026-06-19T14:30:00Z", content: "Перестановка разделов сбивала пару дней, потом привык." },
  { ref: "demo-003", releaseVersion: null, source: "support", sentiment: "negative", topic: "производительность", occurredAt: "2026-06-21T08:05:00Z", content: "Список задач грузится по 6-7 секунд на больших проектах." },
  { ref: "demo-004", releaseVersion: null, source: "review", sentiment: "negative", topic: "цена", occurredAt: "2026-06-24T16:40:00Z", content: "Стоимость на пользователя слишком высокая для команды из 20 человек." },
  { ref: "demo-005", releaseVersion: null, source: "survey", sentiment: "neutral", topic: "onboarding", occurredAt: "2026-06-26T11:00:00Z", content: "Регистрация прошла нормально, вопросов не возникло." },
  { ref: "demo-006", releaseVersion: null, source: "support", sentiment: "negative", topic: "производительность", occurredAt: "2026-06-29T09:20:00Z", content: "Поиск иногда отваливается по таймауту." },
  { ref: "demo-007", releaseVersion: null, source: "review", sentiment: "positive", topic: "навигация", occurredAt: "2026-07-02T13:15:00Z", content: "Группировка разделов по сценариям — правильное решение." },
  { ref: "demo-008", releaseVersion: null, source: "interview", sentiment: "negative", topic: "экспорт", occurredAt: "2026-07-05T10:45:00Z", content: "Не хватает выгрузки в CSV, приходится копировать вручную." },
  { ref: "demo-009", releaseVersion: null, source: "review", sentiment: "negative", topic: "цена", occurredAt: "2026-07-08T18:20:00Z", content: "Перешли бы на годовой тариф, если бы была скидка за объём." },
  { ref: "demo-010", releaseVersion: null, source: "survey", sentiment: "positive", topic: "onboarding", occurredAt: "2026-07-11T09:35:00Z", content: "Настроил первый проект за десять минут, всё логично." },
  { ref: "demo-011", releaseVersion: null, source: "support", sentiment: "negative", topic: "производительность", occurredAt: "2026-07-14T15:50:00Z", content: "Экспорт большого проекта висит и ничего не показывает." },
  { ref: "demo-012", releaseVersion: null, source: "review", sentiment: "neutral", topic: "поиск", occurredAt: "2026-07-17T12:05:00Z", content: "Поиск находит, но сортировка результатов странная." },

  // --- after 4.1: onboarding complaints spike, mostly mobile wording -------
  { ref: "demo-013", releaseVersion: "4.1", source: "support", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-21T08:40:00Z", content: "После обновления не понимаю, что делать дальше на втором шаге." },
  { ref: "demo-014", releaseVersion: "4.1", source: "support", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-21T11:25:00Z", content: "С телефона экран выбора рабочей области обрезан, кнопка не видна." },
  { ref: "demo-015", releaseVersion: "4.1", source: "review", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-22T09:10:00Z", content: "Что такое «рабочая область»? Раньше был просто проект, теперь путаница." },
  { ref: "demo-016", releaseVersion: "4.1", source: "support", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-22T14:55:00Z", content: "Пригласил команду, никто не смог пройти настройку до конца." },
  { ref: "demo-017", releaseVersion: "4.1", source: "review", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-23T10:30:00Z", content: "Раньше было проще. Новый обязательный шаг непонятно зачем нужен." },
  { ref: "demo-018", releaseVersion: "4.1", source: "support", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-23T16:15:00Z", content: "На мобильном приложении регистрация зависает после выбора области." },
  { ref: "demo-019", releaseVersion: "4.1", source: "support", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-24T08:50:00Z", content: "Слишком долго искал кнопку продолжения, она уехала вниз." },
  { ref: "demo-020", releaseVersion: "4.1", source: "review", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-24T13:40:00Z", content: "Не понял куда нажать, чтобы пропустить приглашение коллег." },
  { ref: "demo-021", releaseVersion: "4.1", source: "interview", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-25T11:20:00Z", content: "Объединённый экран приглашения перегружен, три действия сразу." },
  { ref: "demo-022", releaseVersion: "4.1", source: "support", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-26T09:05:00Z", content: "После обновления неудобно, на планшете половина формы не помещается." },
  { ref: "demo-023", releaseVersion: "4.1", source: "survey", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-27T15:30:00Z", content: "Бросил регистрацию на шаге выбора области, вернусь позже." },
  { ref: "demo-024", releaseVersion: "4.1", source: "support", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-28T10:10:00Z", content: "Ошибка при сохранении рабочей области с телефона, на компьютере всё нормально." },
  { ref: "demo-025", releaseVersion: "4.1", source: "review", sentiment: "neutral", topic: "onboarding", occurredAt: "2026-07-29T12:45:00Z", content: "Разобрался со второй попытки, но подсказок явно не хватает." },
  { ref: "demo-026", releaseVersion: "4.1", source: "support", sentiment: "negative", topic: "onboarding", occurredAt: "2026-07-30T14:20:00Z", content: "Коллега не смог войти в общую область, ушёл в поддержку." },
  { ref: "demo-027", releaseVersion: "4.1", source: "review", sentiment: "positive", topic: "onboarding", occurredAt: "2026-07-31T09:55:00Z", content: "Идея с рабочими областями хорошая, но объяснить бы её сразу." },
  { ref: "demo-028", releaseVersion: "4.1", source: "support", sentiment: "negative", topic: "onboarding", occurredAt: "2026-08-01T11:35:00Z", content: "Мобильная версия предлагает создать область, но кнопка не нажимается." },

  // --- unrelated streams continuing -------------------------------------
  { ref: "demo-029", releaseVersion: null, source: "review", sentiment: "negative", topic: "цена", occurredAt: "2026-07-26T17:00:00Z", content: "Тариф вырос, а ценность для маленькой команды не изменилась." },
  { ref: "demo-030", releaseVersion: null, source: "support", sentiment: "negative", topic: "производительность", occurredAt: "2026-07-29T08:25:00Z", content: "Дашборд открывается дольше десяти секунд по утрам." },
  { ref: "demo-031", releaseVersion: null, source: "review", sentiment: "neutral", topic: "поиск", occurredAt: "2026-08-01T13:50:00Z", content: "Поиск по тегам работает, по содержимому — нет." },
  { ref: "demo-032", releaseVersion: null, source: "interview", sentiment: "negative", topic: "экспорт", occurredAt: "2026-08-02T10:15:00Z", content: "Отчёты нужны в таблице, сейчас только скриншоты." },

  // --- after 4.2: search and export improve ------------------------------
  { ref: "demo-033", releaseVersion: "4.2", source: "review", sentiment: "positive", topic: "экспорт", occurredAt: "2026-08-06T09:30:00Z", content: "Экспорт в CSV закрыл нашу основную боль, спасибо." },
  { ref: "demo-034", releaseVersion: "4.2", source: "review", sentiment: "positive", topic: "поиск", occurredAt: "2026-08-06T14:05:00Z", content: "Поиск стал заметно быстрее, результаты релевантные." },
  { ref: "demo-035", releaseVersion: "4.2", source: "support", sentiment: "neutral", topic: "экспорт", occurredAt: "2026-08-07T11:45:00Z", content: "CSV выгружается, но кодировка ломает кириллицу в Excel." },
  { ref: "demo-036", releaseVersion: "4.2", source: "review", sentiment: "positive", topic: "поиск", occurredAt: "2026-08-08T10:20:00Z", content: "Наконец находит по содержимому карточек." },
  { ref: "demo-037", releaseVersion: "4.2", source: "support", sentiment: "negative", topic: "производительность", occurredAt: "2026-08-09T15:10:00Z", content: "После обновления поиска выросло время первой загрузки." },
  { ref: "demo-038", releaseVersion: "4.2", source: "survey", sentiment: "positive", topic: "экспорт", occurredAt: "2026-08-10T12:35:00Z", content: "Выгрузка отчётов сократила ручную работу на пару часов в неделю." },
  { ref: "demo-039", releaseVersion: null, source: "review", sentiment: "negative", topic: "onboarding", occurredAt: "2026-08-11T09:15:00Z", content: "Новые сотрудники всё ещё путаются на первом входе." },
  { ref: "demo-040", releaseVersion: null, source: "support", sentiment: "negative", topic: "цена", occurredAt: "2026-08-12T16:50:00Z", content: "Просят перевести на тариф без лишних мест, иначе уйдут." },
];

const DEMO_METRICS: Array<Omit<MetricSnapshot, "id" | "project_id" | "created_at" | "updated_at">> = [
  // registration completion, %
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 76.4, unit: "%", segment: "all", measured_at: "2026-07-13T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 75.9, unit: "%", segment: "all", measured_at: "2026-07-19T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 63.2, unit: "%", segment: "all", measured_at: "2026-07-27T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 64.8, unit: "%", segment: "all", measured_at: "2026-08-03T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 71.1, unit: "%", segment: "web", measured_at: "2026-07-13T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 70.6, unit: "%", segment: "web", measured_at: "2026-07-19T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 69.4, unit: "%", segment: "web", measured_at: "2026-07-27T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 70.2, unit: "%", segment: "web", measured_at: "2026-08-03T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 81.3, unit: "%", segment: "mobile", measured_at: "2026-07-13T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 80.7, unit: "%", segment: "mobile", measured_at: "2026-07-19T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 54.1, unit: "%", segment: "mobile", measured_at: "2026-07-27T00:00:00Z" },
  { metric_key: "registration_completion_rate", label: "Завершение регистрации", value: 56.9, unit: "%", segment: "mobile", measured_at: "2026-08-03T00:00:00Z" },
  // activation, %
  { metric_key: "activation_rate", label: "Активация за 7 дней", value: 48.2, unit: "%", segment: "all", measured_at: "2026-07-13T00:00:00Z" },
  { metric_key: "activation_rate", label: "Активация за 7 дней", value: 47.6, unit: "%", segment: "all", measured_at: "2026-07-27T00:00:00Z" },
  { metric_key: "activation_rate", label: "Активация за 7 дней", value: 42.3, unit: "%", segment: "all", measured_at: "2026-08-03T00:00:00Z" },
  { metric_key: "activation_rate", label: "Активация за 7 дней", value: 44.9, unit: "%", segment: "mobile", measured_at: "2026-07-13T00:00:00Z" },
  { metric_key: "activation_rate", label: "Активация за 7 дней", value: 36.1, unit: "%", segment: "mobile", measured_at: "2026-07-27T00:00:00Z" },
  { metric_key: "activation_rate", label: "Активация за 7 дней", value: 37.4, unit: "%", segment: "mobile", measured_at: "2026-08-03T00:00:00Z" },
  // search latency, ms
  { metric_key: "search_latency_p95", label: "Задержка поиска p95", value: 1840, unit: "ms", segment: "all", measured_at: "2026-07-27T00:00:00Z" },
  { metric_key: "search_latency_p95", label: "Задержка поиска p95", value: 1795, unit: "ms", segment: "all", measured_at: "2026-08-03T00:00:00Z" },
  { metric_key: "search_latency_p95", label: "Задержка поиска p95", value: 620, unit: "ms", segment: "all", measured_at: "2026-08-10T00:00:00Z" },
];

export type SeedResult = { created: number; skipped: number };

async function runInChunks<T>(items: T[], size: number, task: (item: T) => Promise<boolean>): Promise<SeedResult> {
  let created = 0;
  let skipped = 0;
  for (let index = 0; index < items.length; index += size) {
    const results = await Promise.all(items.slice(index, index + size).map(task));
    for (const wasCreated of results) {
      if (wasCreated) created += 1;
      else skipped += 1;
    }
  }
  return { created, skipped };
}

/** A 409 means the row is already there — re-running the seed must stay harmless. */
async function createIgnoringConflict(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return false;
    throw error;
  }
}

export async function seedDemoData(projectId: string): Promise<SeedResult> {
  const existing = await luraApi.getReleases(projectId);
  const missing = DEMO_RELEASES.filter(
    (release) => !existing.some((item) => item.version === release.version),
  );
  for (const release of missing) {
    await createIgnoringConflict(() => luraApi.createRelease(projectId, release));
  }

  const releases = await luraApi.getReleases(projectId);
  const releaseIdByVersion = new Map(releases.map((release) => [release.version, release.id]));

  const feedbackResult = await runInChunks(DEMO_FEEDBACK, 6, (item) =>
    createIgnoringConflict(() =>
      luraApi.createFeedback(projectId, {
        release_id: item.releaseVersion ? releaseIdByVersion.get(item.releaseVersion) ?? null : null,
        source: item.source,
        external_ref: item.ref,
        content: item.content,
        sentiment: item.sentiment,
        topic: item.topic,
        occurred_at: item.occurredAt,
      }),
    ),
  );

  const metricResult = await runInChunks(DEMO_METRICS, 6, (item) =>
    createIgnoringConflict(() => luraApi.createMetricSnapshot(projectId, item)),
  );

  return {
    created: missing.length + feedbackResult.created + metricResult.created,
    skipped: DEMO_RELEASES.length - missing.length + feedbackResult.skipped + metricResult.skipped,
  };
}
