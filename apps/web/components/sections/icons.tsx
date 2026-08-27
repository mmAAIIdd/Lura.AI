import type { SVGProps } from "react";

/**
 * Иконки разделов.
 *
 * Нарисованы здесь, а не взяты из библиотеки: их пять, и ради пяти контуров
 * тащить в приложение ещё одну зависимость незачем. Все на одной сетке 24×24
 * с обводкой в две единицы, поэтому в строке они выглядят одинаково.
 */

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Релиз: точка на линии времени. */
export function ReleaseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M2 12h6.5M15.5 12H22" />
    </Icon>
  );
}

/** Обратная связь: реплика. */
export function FeedbackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
      <path d="M8 8h8M8 12h5" />
    </Icon>
  );
}

/** Метрики: линия по осям. */
export function MetricsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 4v16h16" />
      <path d="M7 15l3.5-4 3 2.5L20 7" />
    </Icon>
  );
}

/** Источник: документ с лупой. */
export function SourceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
      <path d="M14 3l5 5v3" />
      <circle cx="16.5" cy="16.5" r="3" />
      <path d="M18.8 18.8L21 21" />
    </Icon>
  );
}

export function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}
