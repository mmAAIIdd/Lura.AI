/**
 * Знак панели: рамка окна с закрашенной боковой полосой.
 *
 * Полоса стоит с той стороны, к какой панели относится кнопка, и гаснет,
 * когда панель свёрнута. Так состояние читается по самой картинке, а не
 * только по подписи и цвету — переключатель остаётся понятным и в свёрнутом
 * виде, и без цвета.
 */
export function PanelIcon({ side, on = true }: { side: "left" | "right"; on?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect
        x={side === "left" ? 3.1 : 9.7}
        y="4.6"
        width="3.2"
        height="6.8"
        rx="1.1"
        fill="currentColor"
        opacity={on ? 1 : 0.28}
      />
    </svg>
  );
}
