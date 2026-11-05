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
export const MenuIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
);
export const CloseIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);
export const ChevronDownIcon = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.2}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const PlayIcon = ({ size = 12, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor">
    <path d="M6 3 20 12 6 21z" />
  </svg>
);
export const ArrowLeftIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);
export const ArrowDownIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </svg>
);
export const CheckCircleIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
export const SparklesIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
  </svg>
);
export const UserCheckIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="m16 11 2 2 4-4" />
  </svg>
);
export const FileTextIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </svg>
);
export const SearchIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
export const RestartIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);
export const ZapIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </svg>
);
export const TruckIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
    <path d="M15 18H9" />
    <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
    <circle cx="17" cy="18" r="2" />
    <circle cx="7" cy="18" r="2" />
  </svg>
);
export const CameraIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);
export const PhoneIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M12 18h.01" />
  </svg>
);
export const MonitorIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  </svg>
);
export const MailIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);
export const InboxIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);
export const BanknoteIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M6 12h.01" />
    <path d="M18 12h.01" />
  </svg>
);
export const SwapIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <path d="M8 3 4 7l4 4" />
    <path d="M4 7h16" />
    <path d="m16 21 4-4-4-4" />
    <path d="M20 17H4" />
  </svg>
);
export const BuildingIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.8}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M12 6h.01" />
    <path d="M12 10h.01" />
    <path d="M12 14h.01" />
    <path d="M16 10h.01" />
    <path d="M16 14h.01" />
    <path d="M8 10h.01" />
    <path d="M8 14h.01" />
  </svg>
);
