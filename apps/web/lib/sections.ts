/**
 * Публичные разделы сайта.
 *
 * Один список на шапку, подвал и мобильное меню: раньше разделы были
 * перечислены в трёх местах, и порядок в них успел разойтись.
 */
export const SECTIONS = [
  { href: "/capabilities", label: "Возможности" },
  { href: "/cooperation", label: "Сотрудничество" },
  { href: "/docs", label: "Документация" },
  { href: "/faq", label: "Вопросы" },
  { href: "/pricing", label: "Планы" },
] as const;

export type SectionHref = (typeof SECTIONS)[number]["href"];
