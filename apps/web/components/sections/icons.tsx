import type { SVGProps } from "react";

/**
 * Иконки разделов.
 *
 * Нарисованы здесь, а не взяты из библиотеки: ради одного контура тащить в
 * приложение ещё одну зависимость незачем. Сетка 24×24 и обводка в две
 * единицы — общие для всех, кто сюда добавится.
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

export function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}
