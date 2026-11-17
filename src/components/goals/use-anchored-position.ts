"use client";

import { useLayoutEffect, type RefObject } from "react";

// Places a popup (calendar, option list) under its trigger with position: fixed, so the scrolling
// body of the goal window cannot clip it. Opens upwards when there is no room below. The position
// is written straight to the element's style: it follows the trigger on scroll and resize without
// re-rendering React.

const GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  matchAnchorWidth = false,
): void {
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!isOpen || !anchor || !popup) return;

    const place = () => {
      const box = anchor.getBoundingClientRect();
      if (matchAnchorWidth) popup.style.width = `${box.width}px`;
      const { offsetHeight: height, offsetWidth: width } = popup;
      const fitsBelow = window.innerHeight - box.bottom >= height + GAP_PX + VIEWPORT_MARGIN_PX;
      const fitsAbove = box.top >= height + GAP_PX + VIEWPORT_MARGIN_PX;
      const top = fitsBelow || !fitsAbove ? box.bottom + GAP_PX : box.top - height - GAP_PX;
      const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN_PX;
      popup.style.top = `${Math.max(VIEWPORT_MARGIN_PX, top)}px`;
      popup.style.left = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(box.left, maxLeft))}px`;
      popup.style.visibility = "visible";
    };

    place();
    // The popup's own size changes too (a 6-week month is taller than a 5-week one).
    const resizeObserver = new ResizeObserver(place);
    resizeObserver.observe(popup);
    // Capture: the goal window's body scrolls, not the page.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef, popupRef, isOpen, matchAnchorWidth]);
}

/** Initial style of an anchored popup: fixed and hidden until the first placement. */
export const ANCHORED_POPUP_STYLE = { position: "fixed", top: 0, left: 0, visibility: "hidden" } as const;
