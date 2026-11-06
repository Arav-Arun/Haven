// Small line icons for the landing page, drawn here so the page loads nothing from elsewhere.

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (p: P): P => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  ...p,
});

/** Haven's mark: a coat hanger. */
export const Hanger = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 7.2a2.2 2.2 0 1 1 2.2-2.2c0 1.1-.8 1.6-1.5 2.1-.5.4-.7.8-.7 1.4v.6" />
    <path d="M12 9.1 3.4 15.4c-.9.7-.4 2.1.7 2.1h15.8c1.1 0 1.6-1.4.7-2.1L12 9.1Z" />
  </svg>
);
export const Arrow = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const Folder = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2h7.4a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9.5Z" />
  </svg>
);
export const Doc = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 3.5h6.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
    <path d="M13 3.5V8h5M9 12.5h6M9 15.5h6" />
  </svg>
);
export const Lock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.2" />
  </svg>
);
export const Key = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2" />
  </svg>
);
export const Clock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const Shuffle = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h3.5c4 0 5 10 9 10H20M17 14l3 3-3 3M4 17h3.5c1.4 0 2.4-1.2 3.3-2.8M17 4l3 3-3 3M13.2 9.8C14.1 8.2 15.1 7 16.5 7H20" />
  </svg>
);
export const Layers = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
  </svg>
);
export const Hexagon = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9L12 3Z" />
    <path d="m12 8 3.5 2v4L12 16l-3.5-2v-4L12 8Z" />
  </svg>
);
export const Tag = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0l-8.3-8.3Z" />
    <circle cx="8" cy="8" r="1.4" />
  </svg>
);
export const Net = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="5" r="2" />
    <circle cx="5" cy="17" r="2" />
    <circle cx="19" cy="17" r="2" />
    <path d="M10.9 6.7 6.1 15.3M13.1 6.7l4.8 8.6M7 17h10" />
  </svg>
);
export const Eye = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
);
export const EyeOff = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4l16 16M9.9 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.5M6.4 7.6C3.9 9.3 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1M10 10a2.8 2.8 0 0 0 4 4" />
  </svg>
);
export const Monitor = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
  </svg>
);
export const Phone = (p: P) => (
  <svg {...base(p)}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.4" />
    <path d="M11 18.5h2" />
  </svg>
);
export const Puzzle = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 4.5a2 2 0 0 1 4 0V6h3.5a1 1 0 0 1 1 1v3.5H19a2 2 0 0 1 0 4h-1.5V18a1 1 0 0 1-1 1H13v-1.5a2 2 0 0 0-4 0V19H5.5a1 1 0 0 1-1-1v-3.5H6a2 2 0 0 0 0-4H4.5V7a1 1 0 0 1 1-1H9V4.5Z" />
  </svg>
);
export const Check = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </svg>
);
