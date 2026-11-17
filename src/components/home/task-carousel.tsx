"use client";

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/shell/icons";

// HOME-14 "Moje zadania": a horizontal, scroll-snapping strip of task cards (WAI-ARIA carousel:
// region + slides as groups).
// Keyboard: Tab reaches the arrow buttons and every card's "Otwórz" link (focus scrolls the card
// into view); Left/Right arrow keys move focus to the previous/next card. Touch: native swipe.
// The arrows only show when the cards overflow, and at either end they stay focusable but
// aria-disabled, so focus is never lost while scrolling.

export interface TaskCardData {
  id: string;
  title: string;
  description: string;
  /** Already formatted "Data ostatniej aktualizacji: …", or null when there is no record yet. */
  updatedLabel: string | null;
  href: string;
  /** "Zadanie 1 z 3", formatted on the server. */
  slideLabel: string;
}

type Props = {
  /** id of the visible section heading, which also names the carousel. */
  labelledBy: string;
  tasks: readonly TaskCardData[];
  labels: { previous: string; next: string; open: string };
};

/** Pixels of slack when deciding whether the strip is at its start or end (sub-pixel rounding). */
const EDGE_TOLERANCE_PX = 2;

type ScrollState = { previous: boolean; next: boolean };

export function TaskCarousel({ labelledBy, tasks, labels }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const [canScroll, setCanScroll] = useState<ScrollState>({ previous: false, next: false });
  const taskCount = tasks.length;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const maxScroll = list.scrollWidth - list.clientWidth;
        const previous = list.scrollLeft > EDGE_TOLERANCE_PX;
        const next = list.scrollLeft < maxScroll - EDGE_TOLERANCE_PX;
        // Keep the same object when nothing changed, so scrolling does not re-render every frame.
        setCanScroll((state) => (state.previous === previous && state.next === next ? state : { previous, next }));
      });
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      list.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [taskCount]);

  function scrollByCard(direction: -1 | 1) {
    const list = listRef.current;
    if (!list) return;
    const card = list.firstElementChild as HTMLElement | null;
    const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
    const step = card ? card.offsetWidth + gap : list.clientWidth;
    list.scrollBy({ left: direction * step });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-task-link]"));
    const current = links.findIndex((link) => link === document.activeElement);
    if (current === -1) return;
    const target = links[current + (event.key === "ArrowRight" ? 1 : -1)];
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  }

  // Tab and arrow-key focus both land here. The browser's own focus scroll aims between snap
  // points and snap-mandatory pulls it back, so a half-hidden card is aligned to its snap start.
  function handleFocus(event: FocusEvent<HTMLUListElement>) {
    const list = event.currentTarget;
    const card = (event.target as HTMLElement).closest("li");
    if (!card) return;
    const listBox = list.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const isFullyVisible = cardBox.left >= listBox.left - EDGE_TOLERANCE_PX && cardBox.right <= listBox.right + EDGE_TOLERANCE_PX;
    if (!isFullyVisible) card.scrollIntoView({ block: "nearest", inline: "start" });
  }

  const showControls = canScroll.previous || canScroll.next;

  return (
    <div role="region" aria-roledescription="carousel" aria-labelledby={labelledBy} className="relative">
      {showControls && (
        <div className="absolute -top-14 right-0 flex gap-2">
          <ArrowButton label={labels.previous} isDisabled={!canScroll.previous} onClick={() => scrollByCard(-1)}>
            <ChevronLeftIcon />
          </ArrowButton>
          <ArrowButton label={labels.next} isDisabled={!canScroll.next} onClick={() => scrollByCard(1)}>
            <ChevronRightIcon />
          </ArrowButton>
        </div>
      )}
      <ul
        ref={listRef}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        className="-mx-2 flex snap-x snap-mandatory scroll-px-2 gap-4 overflow-x-auto scroll-smooth px-2 pt-1 pb-3 [scrollbar-width:thin] motion-reduce:scroll-auto"
      >
        {tasks.map((task) => (
          <li key={task.id} className="w-[min(20rem,85%)] shrink-0 snap-start">
            <TaskCard task={task} openLabel={labels.open} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaskCard({ task, openLabel }: { task: TaskCardData; openLabel: string }) {
  return (
    <article
      role="group"
      aria-roledescription="slide"
      aria-label={task.slideLabel}
      className="group/card relative flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-panel transition-[box-shadow,border-color] duration-200 focus-within:border-accent/60 hover:border-accent/40 hover:shadow-card motion-reduce:transition-none"
    >
      <span aria-hidden="true" className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-(image:--am-gradient)" />
      <h3 className="text-lg font-semibold text-ink">{task.title}</h3>
      <p className="mt-2 leading-relaxed text-ink-soft">{task.description}</p>
      {task.updatedLabel && <p className="mt-3 text-sm text-ink-soft tabular-nums">{task.updatedLabel}</p>}
      <Link
        href={task.href}
        data-task-link
        // Unique name per card; starts with the visible text (WCAG 2.5.3).
        aria-label={`${openLabel}: ${task.title}`}
        className="mt-auto inline-flex min-h-11 items-center gap-1 self-start pt-4 font-semibold text-accent underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {openLabel}
        <ChevronRightIcon className="size-4 transition-transform duration-200 group-hover/card:translate-x-0.5 motion-reduce:transition-none" />
      </Link>
    </article>
  );
}

type ArrowButtonProps = {
  label: string;
  isDisabled: boolean;
  onClick: () => void;
  children: ReactNode;
};

function ArrowButton({ label, isDisabled, onClick, children }: ArrowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
      className="flex size-11 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink shadow-panel transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-line-strong aria-disabled:hover:text-ink motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}
