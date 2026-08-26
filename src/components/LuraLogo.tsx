type LuraLogoProps = {
  className?: string;
};

/**
 * Осьминог — знак Lura.
 *
 * Мягкая форма: круглая голова и пять толстых щупалец с круглыми концами,
 * без углов и без вырезанных глаз. Щупальца нарисованы обводкой, а не
 * контуром — обводка с `round` даёт ровную «колбаску» одинаковой мягкости на
 * любом размере, и голова с ней сливается без стыка.
 *
 * Толщина 9.4 подобрана по рендеру: тоньше — знак становится сухим и
 * паучьим, толще — просветы между щупальцами затекают уже на 24px.
 * Цвет — currentColor, одна плоская заливка без градиентов.
 */
export function LuraLogo({ className }: LuraLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Lura"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="none" stroke="currentColor" strokeWidth="9.4" strokeLinecap="round">
        <path d="M25 34C17 37 8 41 7.6 46.4c-.3 4 4.8 5 6.4 1.2" />
        <path d="M39 34C47 37 56 41 56.4 46.4c.3 4-4.8 5-6.4 1.2" />
        <path d="M28 37.5C24 44.5 21.4 50 21.4 55.4" />
        <path d="M36 37.5C40 44.5 42.6 50 42.6 55.4" />
        <path d="M32 39V58.4" />
      </g>
      <ellipse cx="32" cy="21.6" rx="17" ry="16.3" fill="currentColor" />
    </svg>
  );
}
