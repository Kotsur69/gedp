"use client";

import { useEffect, useRef, useState } from "react";

// One-row-at-a-time inline editing for the cycle panel lists (HR-05): which row is open, and the
// focus hand-back. The opened form focuses its first field itself; when it closes (saved or
// cancelled), focus returns to the button that opened it, so a keyboard or screen-reader user is
// not dropped at the top of a long page.

/** Row being edited: an item id, "new", or nothing. */
export type Editing = number | "new" | null;

export interface InlineEditor {
  editing: Editing;
  open: (target: number | "new") => void;
  close: () => void;
  editButtonId: (itemId: number) => string;
  addButtonId: string;
}

/** `scope` keeps the button ids unique when several lists share a page. */
export function useInlineEditor(scope: string): InlineEditor {
  const [editing, setEditing] = useState<Editing>(null);
  const returnFocusIdRef = useRef<string | null>(null);
  const editButtonId = (itemId: number) => `${scope}-edit-${itemId}`;
  const addButtonId = `${scope}-add`;

  // Focus is a DOM side effect: run it after the closed form is gone and the button is back.
  useEffect(() => {
    if (editing !== null || returnFocusIdRef.current === null) return;
    document.getElementById(returnFocusIdRef.current)?.focus();
    returnFocusIdRef.current = null;
  }, [editing]);

  const open = (target: number | "new") => {
    returnFocusIdRef.current = target === "new" ? addButtonId : editButtonId(target);
    setEditing(target);
  };

  return { editing, open, close: () => setEditing(null), editButtonId, addButtonId };
}
