import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (p: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
});

export const IconPencil = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </svg>
);

export const IconEraser = (p: P) => (
  <svg {...base(p)}>
    <path d="M8.5 19H20" />
    <path d="M15.5 4.5 20 9a1.6 1.6 0 0 1 0 2.3l-6.2 6.2a1.6 1.6 0 0 1-2.3 0l-4.5-4.5a1.6 1.6 0 0 1 0-2.3l6.2-6.2a1.6 1.6 0 0 1 2.3 0Z" />
    <path d="M9 9.5 15 15.5" />
  </svg>
);

export const IconBucket = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 3.5 4.8 9.7a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0l6.2-6.2-7.5-7.5a1.1 1.1 0 0 0-1.5 0Z" />
    <path d="M4.5 11h15" />
    <path d="M19.5 15c1 1.4 1.5 2.3 1.5 3a1.5 1.5 0 0 1-3 0c0-.7.5-1.6 1.5-3Z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconLine = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 19 19 5" />
    <circle cx="5" cy="19" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="19" cy="5" r="1.8" fill="currentColor" stroke="none" />
  </svg>
);

export const IconRect = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="6" width="16" height="12" rx="1.6" />
  </svg>
);

export const IconEllipse = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="12" rx="8" ry="6.4" />
  </svg>
);

export const IconPicker = (p: P) => (
  <svg {...base(p)}>
    <path d="m13.5 5.5 5 5" />
    <path d="M17.2 3.8a1.8 1.8 0 0 1 2.6 0l.4.4a1.8 1.8 0 0 1 0 2.6l-1.6 1.6-3-3 1.6-1.6Z" />
    <path d="m14.5 6.5-8 8V18h3.5l8-8" />
  </svg>
);

export const IconHand = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M12 10.5V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M15 10.5V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.8-2.4l-2.4-3.2a1.6 1.6 0 0 1 2.3-2.2L9 14.5V11" />
  </svg>
);

export const IconUndo = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h9a5 5 0 0 1 0 10h-3" />
    <path d="M7.5 4.5 4 8l3.5 3.5" />
  </svg>
);

export const IconRedo = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 8h-9a5 5 0 0 0 0 10h3" />
    <path d="M16.5 4.5 20 8l-3.5 3.5" />
  </svg>
);

export const IconGrid = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" />
  </svg>
);

export const IconRuler = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="8" width="19" height="8" rx="1.6" transform="rotate(-8 12 12)" />
    <path d="M7 9v2.5M10 8.6v3.4M13 8.2v2.5M16 7.8v3.4" />
  </svg>
);

export const IconHole = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.2" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const IconBoard = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <path d="M12 3.5v17M3.5 12h17" strokeDasharray="2.4 2.2" />
  </svg>
);

export const IconMirrorX = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v18" strokeDasharray="2.6 2.2" />
    <path d="M9 7 4.5 12 9 17Z" />
    <path d="M15 7l4.5 5-4.5 5Z" />
  </svg>
);

export const IconMirrorY = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12h18" strokeDasharray="2.6 2.2" />
    <path d="M7 9 12 4.5 17 9Z" />
    <path d="M7 15l5 4.5L17 15Z" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const IconPalette = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21a9 9 0 1 1 0-18c4.5 0 8 3 8 6.5 0 2.2-1.8 3.5-4 3.5h-1.4a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 21Z" />
    <circle cx="8" cy="9.5" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="16" cy="9" r="1.15" fill="currentColor" stroke="none" />
  </svg>
);

export const IconChart = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3.5a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3.5a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </svg>
);

export const IconImage = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4.5 17 4.6-4.4a1.7 1.7 0 0 1 2.3 0l3 2.9" />
    <path d="m14.5 15.5 1.6-1.5a1.7 1.7 0 0 1 2.3 0l1.6 1.5" />
  </svg>
);

export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v10" />
    <path d="m8 10.5 4 4 4-4" />
    <path d="M5 18.5h14" />
  </svg>
);

export const IconUpload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 16V6" />
    <path d="m8 9.5 4-4 4 4" />
    <path d="M5 18.5h14" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.5 15.5 4 4" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M9 7V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8V7" />
    <path d="M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12" />
  </svg>
);

export const IconFolder = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.3l1.8 2.2h6.9a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" />
  </svg>
);

export const IconFile = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3.5h7l5 5v12H6Z" />
    <path d="M13 3.5v5h5" />
  </svg>
);

export const IconSparkle = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9Z" />
    <path d="M18.5 3.5v3M20 5h-3" />
  </svg>
);

export const IconLayers = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8Z" />
    <path d="m4 12.5 8 4.3 8-4.3" />
    <path d="m4 16.8 8 4.2 8-4.2" />
  </svg>
);

export const IconEyedropper = IconPicker;

export const IconFit = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const IconMenu = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconChevronDown = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9.5 6 6 6-6" />
  </svg>
);

export const IconWand = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20 14.5 9.5" />
    <path d="m16.2 3.5.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9Z" />
    <path d="m19.5 13.5.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z" />
  </svg>
);

export const IconRotate = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
);

export const IconFlip = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v18" strokeDasharray="2.6 2.2" />
    <path d="M9 6.5 4 12l5 5.5Z" />
    <path d="M15 6.5 20 12l-5 5.5Z" fill="currentColor" fillOpacity="0.28" />
  </svg>
);

export const IconZoomIn = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.5 15.5 4 4M8.4 10.8h4.8M10.8 8.4v4.8" />
  </svg>
);

export const IconMinus = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
);

export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.4" />
  </svg>
);

export const IconSun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
  </svg>
);

export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 13.4A8.2 8.2 0 0 1 10.6 4a8.4 8.4 0 1 0 9.4 9.4Z" />
  </svg>
);

export const IconCode = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 8 5 12l4 4M15 8l4 4-4 4" />
  </svg>
);

export const IconKeyboard = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.6" y="6" width="18.8" height="12" rx="2.4" />
    <path d="M6.4 10h.01M9.6 10h.01M12.8 10h.01M16 10h.01M6.4 13.2h.01M16 13.2h.01M9.2 13.2h5.6" />
  </svg>
);
