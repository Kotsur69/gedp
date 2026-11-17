import type { ReactNode } from "react";

// G2-15 / IMG14: one icon per target type, same 24px line style as the shell icons. Codes come from
// the target_type table; a type HR adds later (Q-06) gets the generic target icon.

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

const PATHS: Readonly<Record<string, ReactNode>> = {
  LICZBA: <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />,
  TEKST: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,
  PROCENT: (
    <>
      <path d="M19 5 5 19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </>
  ),
  TONY: (
    <>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </>
  ),
  EURO: <path d="M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2" />,
  USD: <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
};

const GENERIC = (
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </>
);

export function TargetTypeIcon({ code, className = "size-5" }: { code: string; className?: string }) {
  return (
    <svg {...BASE} className={className}>
      {PATHS[code] ?? GENERIC}
    </svg>
  );
}
