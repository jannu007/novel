/**
 * 線画のアイコン。外部のアイコンライブラリを足さずに済むよう、
 * 必要なものだけをSVGで持っている。
 */
type Props = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const PenIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </svg>
);

export const BookIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14v16h4.5a1.5 1.5 0 0 0 1.5-1.5z" />
  </svg>
);

export const CheckIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M4 7h11M4 12h8M4 17h6" />
    <path d="M15.5 16.5l2 2 4-4.5" />
  </svg>
);

export const ShipIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M12 3v11" />
    <path d="M8 7l4-4 4 4" />
    <path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" />
  </svg>
);

export const BackIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const ListIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

export const ExpandIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M9 4H4v5M15 20h5v-5M20 9V4h-5M4 15v5h5" />
  </svg>
);

export const ShrinkIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5" />
  </svg>
);

export const PlusIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ThemeIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
  </svg>
);

export const TrashIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
);

export const CloseIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const ImageIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="10" r="1.5" />
    <path d="M5 17l4.5-4.5L13 16l2.5-2.5L19 17" />
  </svg>
);

/** 縦書き：右から左へ流れる列を表す */
export const TategakiIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M18 4v16M13 4v11M8 4v16M4 4v8" />
  </svg>
);

/** 横書き：上から下へ流れる行を表す */
export const YokogakiIcon = (p: Props) => (
  <svg {...base} {...p} aria-hidden>
    <path d="M4 6h16M4 11h11M4 16h16M4 20h8" />
  </svg>
);
