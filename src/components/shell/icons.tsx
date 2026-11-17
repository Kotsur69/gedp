// The few line icons the shell needs: one 24px grid, 1.75 stroke, round caps (Lucide-style).
// Inline so the shell adds no icon dependency. Decorative only: callers provide the text.

type IconProps = { className?: string };

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

export function ChevronDownIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function CloseIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function ExternalLinkIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function EyeIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function CalendarIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

export function CompassIcon({ className = "size-6" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12Z" />
    </svg>
  );
}

export function CheckIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function PencilIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M21.17 6.81a2.83 2.83 0 0 0-4-4L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function ChevronLeftIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function InfoIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

export function DocumentIcon({ className = "size-6" }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M9 13h6M9 17h4" />
    </svg>
  );
}
