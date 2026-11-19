import type { DocumentStatus } from "@/generated/prisma/enums";

// Document status colours (WF-01, IMG02 home tile). The status text always carries the meaning;
// the tone only reinforces it. "NONE" = the person has no document for the year yet.
export const DOCUMENT_STATUS_TONE: Readonly<Record<DocumentStatus | "NONE", string>> = {
  NONE: "border-line-strong text-ink-soft",
  SZKIC: "border-line-strong text-ink",
  DO_WALIDACJI: "border-accent/50 text-accent",
  ZWROCONY: "border-brand-orange/60 bg-notice-surface text-notice",
  ZATWIERDZONY: "border-transparent bg-accent text-on-solid",
};
