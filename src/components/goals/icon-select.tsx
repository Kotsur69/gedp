"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon } from "@/components/shell/icons";
import { ESCAPE_OWNER_ATTRIBUTE } from "./date-picker";
import { GOAL_CONTROL_CLASSES, helpId, labelId } from "./goal-field";
import { ANCHORED_POPUP_STYLE, useAnchoredPosition } from "./use-anchored-position";

// Select-only combobox (WAI-ARIA APG pattern) for lists whose options carry an icon - G2-15 target
// type (IMG14: icon per type, check mark on the chosen one). A native <select> cannot show icons.
// Focus stays on the button; the active option is announced with aria-activedescendant.
// Keys: Down / Up / Enter / Space open; inside the list Up / Down / Home / End move, Enter or Space
// pick, Escape closes, Tab closes and moves on, a letter jumps to the next option starting with it.

export type IconSelectOption = { value: string; label: string; icon: ReactNode };

type IconSelectProps = {
  id: string;
  value: string;
  options: readonly IconSelectOption[];
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder: string;
  hasError?: boolean;
  disabled?: boolean;
};

const PAGE_JUMP = 5;

export function IconSelect({ id, value, options, onChange, onBlur, placeholder, hasError = false, disabled = false }: IconSelectProps) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const optionId = (index: number) => `${listId}-option-${index}`;
  // Set by keyboard moves only: hovering an option must not scroll the list under the pointer.
  const isScrollPending = useRef(false);

  useAnchoredPosition(triggerRef, listRef, isOpen, true);

  // Keeps the active option visible while moving through a list that scrolls.
  useEffect(() => {
    if (!isOpen || !isScrollPending.current) return;
    isScrollPending.current = false;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  });

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isOpen]);

  const open = (index = Math.max(selectedIndex, 0)) => {
    setActiveIndex(index);
    setIsOpen(true);
  };
  const pick = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setIsOpen(false);
    triggerRef.current?.focus();
  };
  const moveBy = (step: number) => setActiveIndex((index) => Math.min(options.length - 1, Math.max(0, index + step)));

  /** Type-ahead: the next option after the active one whose label starts with the typed letter. */
  const jumpToLetter = (letter: string): number | null => {
    const lower = letter.toLocaleLowerCase();
    for (let step = 1; step <= options.length; step += 1) {
      const index = (activeIndex + step) % options.length;
      if (options[index].label.toLocaleLowerCase().startsWith(lower)) return index;
    }
    return null;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    isScrollPending.current = true;
    const isLetter = event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (isLetter) {
      const index = jumpToLetter(event.key);
      if (index !== null) (isOpen ? setActiveIndex : open)(index);
      return;
    }
    if (!isOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        open();
      }
      return;
    }
    const moves: Record<string, () => void> = {
      ArrowDown: () => moveBy(1),
      ArrowUp: () => moveBy(-1),
      PageDown: () => moveBy(PAGE_JUMP),
      PageUp: () => moveBy(-PAGE_JUMP),
      Home: () => setActiveIndex(0),
      End: () => setActiveIndex(options.length - 1),
      Enter: () => pick(activeIndex),
      " ": () => pick(activeIndex),
      Escape: () => setIsOpen(false),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      // Escape belongs to this list, not to the goal window around it.
      if (event.key === "Escape") event.stopPropagation();
      move();
    } else if (event.key === "Tab") {
      setIsOpen(false);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    if (event.relatedTarget && listRef.current?.contains(event.relatedTarget as Node)) return;
    setIsOpen(false);
    onBlur?.();
  };

  const valueId = `${id}-value`;
  return (
    <div {...(isOpen ? { [ESCAPE_OWNER_ATTRIBUTE]: "" } : {})}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen ? optionId(activeIndex) : undefined}
        aria-labelledby={`${labelId(id)} ${valueId}`}
        aria-describedby={helpId(id)}
        aria-invalid={hasError || undefined}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={`${GOAL_CONTROL_CLASSES} flex cursor-pointer items-center gap-3 text-left`}
      >
        {selected && (
          <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center text-accent">
            {selected.icon}
          </span>
        )}
        <span id={valueId} className={`flex-1 truncate ${selected ? "" : "text-ink-soft"}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDownIcon
          className={`size-5 shrink-0 text-ink-soft transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={labelId(id)}
        hidden={!isOpen}
        // Focus stays on the combobox: pressing the list or its scrollbar must not take it.
        onMouseDown={(event) => event.preventDefault()}
        style={ANCHORED_POPUP_STYLE}
        className="z-50 max-h-64 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-card"
      >
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          const isActive = index === activeIndex;
          return (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={isSelected}
              onClick={() => pick(index)}
              onPointerMove={() => setActiveIndex(index)}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-ink ${isActive ? "bg-accent/10" : ""} ${isSelected ? "font-semibold text-accent" : ""}`}
            >
              <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center text-ink-soft">
                {option.icon}
              </span>
              <span className="flex-1">{option.label}</span>
              {isSelected && <CheckIcon className="size-5 shrink-0 text-accent" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
