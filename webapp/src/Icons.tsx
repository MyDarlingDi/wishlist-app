/**
 * Small stroke icon set for interactive controls (edit, delete, add, check, share, group).
 * Kept separate from the illustrative emoji used in empty states — Apple's own HIG draws
 * that line too: system glyphs for controls, expressive imagery for empty/onboarding moments.
 */
import type { SVGProps } from "react";

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});

export const PlusIcon = ({ size = 26 }: { size?: number }) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const PencilIcon = ({ size = 15 }: { size?: number }) => (
  <svg {...base(size)}>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const TrashIcon = ({ size = 15 }: { size?: number }) => (
  <svg {...base(size)}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
);

export const CheckIcon = ({ size = 16 }: { size?: number }) => (
  <svg {...base(size)} strokeWidth={2.5}>
    <path d="M4 12.5 9.5 18 20 6" />
  </svg>
);

export const PeopleIcon = ({ size = 12 }: { size?: number }) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="M8 12a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 8 12Zm0 2c-3 0-6 1.5-6 4v1h12v-1c0-2.5-3-4-6-4ZM16.5 12a2.7 2.7 0 1 0 0-5.4M17 14.2c2.2.3 4 1.6 4 3.6v1h-3" />
  </svg>
);

export const CameraIcon = ({ size = 28 }: { size?: number }) => (
  <svg {...base(size)} strokeWidth={1.8}>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-2h7l1 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z" />
    <circle cx="12" cy="13" r="3.4" />
  </svg>
);

export const LinkIcon = ({ size = 15 }: { size?: number }) => (
  <svg {...base(size)}>
    <path d="M9.5 14.5 14.5 9.5M8 12l-2.5 2.5a3 3 0 0 0 4.24 4.24L12.5 16M16 12l2.5-2.5a3 3 0 0 0-4.24-4.24L11.5 8" />
  </svg>
);
