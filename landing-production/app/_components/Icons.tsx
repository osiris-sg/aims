import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, p: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const ChatIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.6A8.4 8.4 0 0 1 12.5 3a8.4 8.4 0 0 1 8.5 8.5z" />
  </svg>
);
export const ArrowIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);
export const CheckIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const FileIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);
export const SendIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="m22 2-7 20-4-9-9-4z" />
  </svg>
);
export const BoxIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="m21 8-9-5-9 5v8l9 5 9-5z" />
    <path d="m3.3 8.5 8.7 4.8 8.7-4.8" />
    <path d="M12 13.3V22" />
  </svg>
);
export const PeopleIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
export const ChartIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M3 3v18h18" />
    <path d="m19 9-5 5-4-4-3 3" />
  </svg>
);
export const ReceiptIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M4 4h12l4 4v12H4z" />
    <path d="M8 4v5h7" />
    <path d="M8 15h8" />
    <path d="M8 18h5" />
  </svg>
);
export const LockIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
export const ClockIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);
export const LayersIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M12 2 2 7l10 5 10-5z" />
    <path d="m2 17 10 5 10-5" />
    <path d="m2 12 10 5 10-5" />
  </svg>
);
