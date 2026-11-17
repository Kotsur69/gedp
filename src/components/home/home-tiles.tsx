import Link from "next/link";
import type { DocumentStatus } from "@/generated/prisma/enums";
import { CompassIcon, DocumentIcon } from "@/components/shell/icons";

// HOME-13: tiles of the "Cykl GEDP" tab. "Continuous feedback" and "My potential" are LATER.

type Props = {
  labelledBy: string;
  heading: string;
  goalCentreLabel: string;
  documentLabel: string;
  /** null = the person has no document for this year yet. */
  documentStatus: DocumentStatus | null;
  documentStatusText: string;
};

// The status text always carries the meaning; the tone only reinforces it.
const STATUS_TONE: Readonly<Record<DocumentStatus | "NONE", string>> = {
  NONE: "border-line-strong text-ink-soft",
  SZKIC: "border-line-strong text-ink",
  DO_WALIDACJI: "border-accent/50 text-accent",
  ZWROCONY: "border-brand-orange/60 bg-notice-surface text-notice",
  ZATWIERDZONY: "border-transparent bg-accent text-on-brand",
};

const TILE =
  "relative flex h-full min-h-36 flex-col justify-between gap-4 overflow-hidden rounded-2xl border p-4 sm:min-h-40 sm:p-5";

export function HomeTiles({
  labelledBy,
  heading,
  goalCentreLabel,
  documentLabel,
  documentStatus,
  documentStatusText,
}: Props) {
  return (
    <section aria-labelledby={labelledBy} className="mt-8">
      <h2 id={labelledBy} className="sr-only">
        {heading}
      </h2>
      <ul className="grid grid-cols-2 gap-4 sm:max-w-xl">
        <li>
          {/* G1-01: opens the Goal Centre of the year chosen in the header. */}
          <Link
            href="/goal-centre"
            className={`${TILE} border-transparent bg-(image:--am-gradient) text-on-brand shadow-panel transition-[translate,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
          >
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-xl bg-on-brand/15 ring-1 ring-on-brand/30"
            >
              <CompassIcon className="size-6" />
            </span>
            <span className="text-lg leading-tight font-semibold">{goalCentreLabel}</span>
          </Link>
        </li>
        <li>
          {/* Status only until the document screen exists; then this tile links to it. */}
          <div className={`${TILE} border-line bg-surface text-ink shadow-panel`}>
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-xl bg-canvas text-accent ring-1 ring-line"
            >
              <DocumentIcon className="size-6" />
            </span>
            <span className="flex flex-col items-start gap-2">
              <span className="text-lg leading-tight font-semibold">{documentLabel}</span>
              <span
                className={`rounded-lg border px-2.5 py-0.5 text-sm leading-snug font-semibold ${STATUS_TONE[documentStatus ?? "NONE"]}`}
              >
                {documentStatusText}
              </span>
            </span>
          </div>
        </li>
      </ul>
    </section>
  );
}
