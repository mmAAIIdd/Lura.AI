/**
 * Проверка готового отчёта.
 *
 * Сверяет текст с контрактом, по которому Лура его писала: шесть разделов в
 * заданном порядке, таблица тем, блок про неизменившееся, пометки
 * доказательности, перечень источников. Проверка механическая и ничего не
 * знает о содержании — она отвечает на вопрос «отчёт дописан?», а не «выводы
 * верны?». Второе решает человек, и подменять его здесь нечем.
 *
 * Смысл в том, чтобы недоделанный отчёт был виден до того, как его отправят
 * дальше: оборванный на середине разбор выглядит как законченный.
 */

export type Finding = {
  level: "error" | "warning" | "ok";
  title: string;
  detail?: string;
};

const SECTIONS = [
  "Что изменилось",
  "Как отреагировали пользователи",
  "Какое влияние это оказало",
  "Почему это могло произойти",
  "Что стоит сделать",
  "Как проверить результат",
];

const MARKS = /\*\*(Факт|Корреляция|Гипотеза)/;

/** Границы разделов: заголовок и весь текст до следующего заголовка того же уровня. */
function splitSections(text: string): { heading: string; body: string }[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line.trim());
    if (heading) {
      if (current) out.push({ heading: current.heading, body: current.body.join("\n") });
      current = { heading: heading[1].trim(), body: [] };
      continue;
    }
    current?.body.push(line);
  }
  if (current) out.push({ heading: current.heading, body: current.body.join("\n") });
  return out;
}

const hasTable = (body: string): boolean => /^\s*\|.+\|\s*$/m.test(body);
const hasNumbers = (body: string): boolean => /\d/.test(body.replace(/^##.*$/gm, ""));

export function checkReport(text: string): Finding[] {
  const findings: Finding[] = [];
  const trimmed = text.trim();

  if (!trimmed) return [{ level: "error", title: "Файл пуст" }];

  const sections = splitSections(trimmed);
  const headings = sections.map((section) => section.heading);

  /* Номер в заголовке необязателен: «## 2. Как отреагировали» и «## Как
     отреагировали» — один и тот же раздел. Сверяем по содержанию названия. */
  const positions = SECTIONS.map((name) =>
    headings.findIndex((heading) => heading.toLowerCase().includes(name.toLowerCase())),
  );

  const missing = SECTIONS.filter((_, index) => positions[index] < 0);
  if (missing.length) {
    findings.push({
      level: "error",
      title: `Не хватает разделов: ${missing.length} из ${SECTIONS.length}`,
      detail: missing.join("; "),
    });
  } else {
    const ordered = positions.every((position, index) => index === 0 || position > positions[index - 1]);
    findings.push(
      ordered
        ? { level: "ok", title: "Все шесть разделов на месте и в нужном порядке" }
        : {
            level: "error",
            title: "Разделы идут не по порядку",
            detail: "Совет раньше фактов читается как вывод без основания.",
          },
    );
  }

  const summary = sections.find((section) => /^итог/i.test(section.heading));
  if (!summary) {
    findings.push({
      level: "warning",
      title: "Нет блока «Итог»",
      detail: "Вывод, основания и ограничения приходится собирать по всему отчёту.",
    });
  } else {
    const labels = ["Вывод", "Основания", "Ограничения", "Гипотезы", "Следующий шаг"];
    const absent = labels.filter((label) => !summary.body.toLowerCase().includes(`**${label.toLowerCase()}`));
    findings.push(
      absent.length
        ? { level: "warning", title: `В «Итоге» не хватает: ${absent.join(", ")}` }
        : { level: "ok", title: "«Итог» с выводом, основаниями и ограничениями на месте" },
    );
  }

  const intro = trimmed.split("\n").find((line) => line.trim());
  findings.push(
    intro && /дата границ|границ[ыа]|до\s*\/\s*после/i.test(intro)
      ? { level: "ok", title: "Предмет разбора и дата границы названы" }
      : {
          level: "warning",
          title: "Перед первым разделом нет строки с предметом и датой границы",
          detail: "Без явной даты сравнение «до и после» ничем не закреплено.",
        },
  );

  const reaction = sections[positions[1]];
  if (reaction) {
    findings.push(
      hasTable(reaction.body)
        ? { level: "ok", title: "В разделе о реакции есть таблица тем" }
        : { level: "warning", title: "В разделе о реакции нет таблицы тем", detail: "Темы без счёта — это мнение." },
    );
  }

  const impact = sections[positions[2]];
  if (impact) {
    const unchanged = /не изменил|без изменений/i.test(impact.body);
    findings.push(
      unchanged
        ? { level: "ok", title: "Показатели без изменений перечислены" }
        : {
            level: "warning",
            title: "Нет блока «Проверено и не изменилось»",
            detail: "Читатель не отличит непроверенный показатель от проверенного и стабильного.",
          },
    );
    findings.push(
      hasNumbers(impact.body)
        ? { level: "ok", title: "В разделе о влиянии есть числа" }
        : { level: "error", title: "В разделе о влиянии нет ни одного числа" },
    );
  }

  const why = sections[positions[3]];
  if (why) {
    const points = why.body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^([-*]|\d+\.)\s+/.test(line));
    const unmarked = points.filter((line) => !MARKS.test(line));
    findings.push(
      !points.length
        ? { level: "warning", title: "В разделе объяснений нет ни одного пункта" }
        : unmarked.length
          ? {
              level: "error",
              title: `Без пометки доказательности: ${unmarked.length} из ${points.length}`,
              detail: "Каждое объяснение обязано нести «Факт», «Корреляция» или «Гипотеза».",
            }
          : { level: "ok", title: `Все объяснения помечены (${points.length})` },
    );
  }

  findings.push(
    /##\s*(\d+\.\s*)?Источник|\*\*Источник/i.test(trimmed)
      ? { level: "ok", title: "Перечень источников есть" }
      : { level: "warning", title: "Нет перечня источников", detail: "Вывод, который нечем проверить, проверить нельзя." },
  );

  const empty = sections.filter((section) => !section.body.trim());
  if (empty.length) {
    findings.push({
      level: "error",
      title: `Пустые разделы: ${empty.length}`,
      detail: empty.map((section) => section.heading).join("; "),
    });
  }

  return findings;
}

/** Склонение: «1 замечание», «2 замечания», «5 замечаний». */
function remarks(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return "замечаний";
  switch (count % 10) {
    case 1:
      return "замечание";
    case 2:
    case 3:
    case 4:
      return "замечания";
    default:
      return "замечаний";
  }
}

export function checkVerdict(findings: Finding[]): { level: Finding["level"]; text: string } {
  const errors = findings.filter((item) => item.level === "error").length;
  const warnings = findings.filter((item) => item.level === "warning").length;
  if (errors) return { level: "error", text: `Отчёт не дописан: ${errors} ${errors % 10 === 1 && errors % 100 !== 11 ? "нарушение" : "нарушений"} контракта` };
  if (warnings) return { level: "warning", text: `Отчёт целостен, есть ${warnings} ${remarks(warnings)}` };
  return { level: "ok", text: "Отчёт соответствует контракту" };
}
