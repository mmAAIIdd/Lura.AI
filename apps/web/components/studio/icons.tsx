/**
 * Набор знаков интерфейса.
 *
 * Контуры взяты из Lucide (лицензия ISC) и вставлены прямо в разметку: пакет
 * ради полутора десятков картинок тянуть незачем, а рисовать их самому —
 * значит получить набор, где каждый знак сделан по своим правилам и это видно.
 * Сетка 24×24, толщина 1.75, скруглённые концы — общие для всех.
 *
 * Размер задаётся снаружи через CSS: у знака в кнопке и у знака в списке он
 * разный, а править viewBox ради этого не нужно.
 */

type Props = { className?: string };

function Glyph({ children, className }: Props & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function NewIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </Glyph>
  );
}

export function LayersIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m6.08 9.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59" />
      <path d="m6.08 14.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59" />
    </Glyph>
  );
}

export function ExitIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Glyph>
  );
}

export function SearchIcon(props: Props) {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Glyph>
  );
}

export function CloseIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Glyph>
  );
}

export function PencilIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </Glyph>
  );
}

export function TrashIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Glyph>
  );
}

export function ClipIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Glyph>
  );
}

export function CommandIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </Glyph>
  );
}

export function SendIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </Glyph>
  );
}

export function StopIcon({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2.5" />
    </svg>
  );
}

export function ChatIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Glyph>
  );
}

export function HistoryIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </Glyph>
  );
}

export function ChevronIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  );
}

/** Тот же шеврон остриём вверх: список моделей раскрывается над полем ввода. */
export function ChevronUpIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="m6 15 6-6 6 6" />
    </Glyph>
  );
}

export function CheckIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  );
}

export function PlusIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Glyph>
  );
}

export function FileIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </Glyph>
  );
}

export function FilePlusIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M9 15h6" />
      <path d="M12 18v-6" />
    </Glyph>
  );
}

export function FolderPlusIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M12 10v6" />
      <path d="M9 13h6" />
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Glyph>
  );
}

export function UploadIcon(props: Props) {
  return (
    <Glyph {...props}>
      <path d="M12 3v12" />
      <path d="m17 8-5-5-5 5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </Glyph>
  );
}

/** Знак боковой панели: рамка окна с отчёркнутой правой колонкой. */
export function PanelIcon(props: Props) {
  return (
    <Glyph {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </Glyph>
  );
}
