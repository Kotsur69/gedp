"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { markStartAnnouncementSeenAction } from "@/app/[locale]/(app)/announcement-actions";
import { CloseIcon } from "@/components/shell/icons";

interface StartAnnouncementProps {
  /** content_block version shown; recorded as seen when the dialog closes. */
  version: number;
  /** The announcement body, already rendered by the sanitising markdown renderer on the server. */
  children: ReactNode;
  labels: { title: string; close: string; acknowledge: string };
}

/**
 * HOME-01: modal shown after login while a published announcement version is unseen. Any way of
 * closing it (button, close icon, Esc) records the version as seen once. If recording fails the
 * dialog simply returns on the next visit, which is the safe side.
 */
export function StartAnnouncement({ version, children, labels }: StartAnnouncementProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasRecorded = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    // Guard: StrictMode runs effects twice and showModal() throws on an already open dialog.
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // Start at the top of the (possibly long) text, not on a button below it, so screen readers
    // read the announcement first and keyboard users can scroll it right away.
    bodyRef.current?.focus();
  }, []);

  const handleClose = () => {
    if (hasRecorded.current) return;
    hasRecorded.current = true;
    markStartAnnouncementSeenAction({ version })
      .then((result) => {
        if (!result.ok) console.error(`[start-announcement] version ${version} not recorded as seen: ${result.code}`);
      })
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : typeof error;
        console.error(`[start-announcement] version ${version} not recorded as seen: ${name}`);
      });
  };

  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      className="m-auto max-h-[85dvh] w-[min(100%-2rem,42rem)] flex-col overflow-hidden rounded-3xl border border-line bg-surface p-0 text-ink shadow-card transition-[opacity,translate] duration-200 ease-out backdrop:bg-scrim backdrop:backdrop-blur-sm open:flex starting:open:translate-y-2 starting:open:opacity-0 motion-reduce:transition-none"
    >
      <span aria-hidden="true" className="h-1 shrink-0 bg-(image:--am-gradient)" />
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line py-3 pr-3 pl-6 sm:pl-8">
        <h2 id={titleId} className="text-xl font-semibold text-ink">
          {labels.title}
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label={labels.close}
          title={labels.close}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors duration-200 hover:bg-accent/10 hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          <CloseIcon />
        </button>
      </header>
      {/* Long HR text scrolls inside the body; header and button stay in view. tabIndex lets
          keyboard users scroll it; the region name tells screen readers what the focus is on. */}
      <div ref={bodyRef} tabIndex={0} role="region" aria-labelledby={titleId} className="min-h-0 flex-1 overflow-y-auto px-6 py-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:px-8">
        {children}
      </div>
      <footer className="flex shrink-0 justify-end border-t border-line px-6 py-4 sm:px-8">
        <button
          type="button"
          onClick={close}
          className="min-h-11 cursor-pointer rounded-xl bg-(image:--am-gradient) px-6 font-semibold tracking-[0.04em] text-on-brand transition-opacity duration-200 hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          {labels.acknowledge}
        </button>
      </footer>
    </dialog>
  );
}
