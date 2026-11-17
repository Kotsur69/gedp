"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/shell/icons";
import {
  addDays,
  addMonths,
  clampDay,
  daysInMonth,
  endOfWeek,
  monthWeeks,
  parseIsoDate,
  sameDay,
  startOfWeek,
  toIsoDate,
  weekdayOrder,
  type CalendarDay,
} from "@/domain/calendar-date";
import type { Locale } from "@/i18n/config";
import { FIRST_DAY_OF_WEEK, formatDate, INTL_LOCALE, TIME_ZONE } from "@/i18n/format";
import { GOAL_CONTROL_CLASSES, helpId, labelId } from "./goal-field";
import { ANCHORED_POPUP_STYLE, useAnchoredPosition } from "./use-anchored-position";

// G2-13 date field: a button showing the date opens a month calendar (IMG12) - previous / next
// month, month and year lists, today marked, the week starting on Monday [ZAŁ; eGEDP: Sunday].
// Days outside [min, max] (the cycle year) cannot be picked. Fully usable from the keyboard:
// arrows move by day / week, Home / End to the week's ends, PageUp / PageDown by month (with Shift
// by year), Enter picks, Escape closes and returns to the button.

/** On a popup that handles Escape itself: the goal window must not close on that same key. */
export const ESCAPE_OWNER_ATTRIBUTE = "data-escape-owner";

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
/** 2024-01-01 is a Monday: ISO weekday n is 2024-01-0n, used only to name weekdays. */
const MONDAY_2024 = Date.UTC(2024, 0, 1);
const MS_PER_DAY = 86_400_000;

type DatePickerProps = {
  id: string;
  /** ISO date or "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** Focus has left the field (button and calendar). */
  onBlur?: () => void;
  min: string;
  max: string;
  hasError?: boolean;
  disabled?: boolean;
};

type DayMove = (day: CalendarDay) => CalendarDay;

function keyMove(key: string, withShift: boolean): DayMove | null {
  switch (key) {
    case "ArrowLeft":
      return (day) => addDays(day, -1);
    case "ArrowRight":
      return (day) => addDays(day, 1);
    case "ArrowUp":
      return (day) => addDays(day, -DAYS_PER_WEEK);
    case "ArrowDown":
      return (day) => addDays(day, DAYS_PER_WEEK);
    case "Home":
      return (day) => startOfWeek(day, FIRST_DAY_OF_WEEK);
    case "End":
      return (day) => endOfWeek(day, FIRST_DAY_OF_WEEK);
    case "PageUp":
      return (day) => addMonths(day, withShift ? -MONTHS_PER_YEAR : -1);
    case "PageDown":
      return (day) => addMonths(day, withShift ? MONTHS_PER_YEAR : 1);
    default:
      return null;
  }
}

function todayInCompanyTime(): CalendarDay {
  // Company time, so every user sees the same "today" (NFR-06).
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const part = (type: "year" | "month" | "day") => Number(parts.find((entry) => entry.type === type)?.value);
  const today = { year: part("year"), month: part("month"), day: part("day") };
  if (!Number.isInteger(today.year) || !Number.isInteger(today.month) || !Number.isInteger(today.day)) {
    throw new Error("DatePicker: cannot read today's date");
  }
  return today;
}

const monthIndex = (day: CalendarDay): number => day.year * MONTHS_PER_YEAR + day.month;

export function DatePicker({ id, value, onChange, onBlur, min, max, hasError = false, disabled = false }: DatePickerProps) {
  const t = useTranslations("goalControls");
  const locale = useLocale() as Locale;
  const baseId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const isFocusPending = useRef(false);
  const first = parseIsoDate(min);
  const last = parseIsoDate(max);
  if (!first || !last) throw new Error("DatePicker: min and max must be ISO dates");
  const selected = parseIsoDate(value);
  const [today] = useState(todayInCompanyTime);
  const [isOpen, setIsOpen] = useState(false);
  const [focusDay, setFocusDay] = useState<CalendarDay>(() => clampDay(selected ?? today, first, last));

  useAnchoredPosition(triggerRef, popupRef, isOpen);
  const dayId = (day: CalendarDay) => `${baseId}-${toIsoDate(day)}`;

  // Moves DOM focus to the focused day after the render that shows it (roving tabindex).
  useEffect(() => {
    if (!isOpen) return;
    const shouldFocus = isFocusPending.current;
    isFocusPending.current = false;
    if (shouldFocus) document.getElementById(dayId(focusDay))?.focus();
  });

  // A press outside the field closes the calendar (focus stays where the person clicked).
  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePress = (event: globalThis.PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isOpen]);

  const open = () => {
    setFocusDay(clampDay(selected ?? today, first, last));
    isFocusPending.current = true;
    setIsOpen(true);
  };
  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };
  const moveFocus = (day: CalendarDay, shouldFocus: boolean) => {
    setFocusDay(clampDay(day, first, last));
    isFocusPending.current = shouldFocus;
  };
  const pick = (day: CalendarDay) => {
    onChange(toIsoDate(day));
    close();
  };

  const handleDayKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const move = keyMove(event.key, event.shiftKey);
    if (!move) return;
    event.preventDefault();
    moveFocus(move(focusDay), true);
  };
  const handlePopupKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  // A mouse press inside the calendar must not blur the focused day (that would close it): Safari
  // and Firefox on macOS do not focus a pressed button, so the click would land after the close.
  // Native selects keep their default so their list still opens.
  const keepFocusInside = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target as HTMLElement).closest("select")) event.preventDefault();
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsOpen(false);
    onBlur?.();
  };

  const fullDate = new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "full", timeZone: "UTC" });
  const shownValue = selected ? formatDate(new Date(`${toIsoDate(selected)}T12:00:00.000Z`), locale) : t("chooseDate");
  const valueId = `${id}-value`;

  return (
    <div ref={wrapperRef} onBlur={handleBlur}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${baseId}-calendar` : undefined}
        aria-labelledby={`${labelId(id)} ${valueId}`}
        // No aria-invalid (not allowed on a button): the error is the help line it is described by.
        aria-describedby={helpId(id)}
        onClick={() => (isOpen ? close() : open())}
        // While open, pressing the button must not blur the focused day first (see keepFocusInside).
        onMouseDown={(event) => {
          if (isOpen) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !isOpen) {
            event.preventDefault();
            open();
          }
        }}
        className={`${GOAL_CONTROL_CLASSES} flex cursor-pointer items-center justify-between gap-3 text-left ${hasError ? "border-danger!" : ""}`}
      >
        <span id={valueId} className={selected ? "tabular-nums" : "text-ink-soft"}>
          {shownValue}
        </span>
        <CalendarIcon className="size-5 shrink-0 text-accent" />
      </button>

      {isOpen && (
        <div
          ref={popupRef}
          id={`${baseId}-calendar`}
          role="dialog"
          aria-label={t("calendar")}
          {...{ [ESCAPE_OWNER_ATTRIBUTE]: "" }}
          style={ANCHORED_POPUP_STYLE}
          onKeyDown={handlePopupKey}
          onMouseDown={keepFocusInside}
          className="z-50 w-[20rem] max-w-[calc(100vw-1rem)] rounded-2xl border border-line bg-surface p-3 text-ink shadow-card"
        >
          <CalendarHeader
            focusDay={focusDay}
            first={first}
            last={last}
            locale={locale}
            onMove={(day) => moveFocus(day, false)}
          />
          <table role="grid" aria-label={fullMonthName(focusDay, locale)} className="mt-2 w-full border-collapse">
            <thead>
              <tr>
                {weekdayOrder(FIRST_DAY_OF_WEEK).map((weekday) => (
                  <WeekdayHeader key={weekday} weekday={weekday} locale={locale} />
                ))}
              </tr>
            </thead>
            <tbody>
              {monthWeeks(focusDay.year, focusDay.month, FIRST_DAY_OF_WEEK).map((week, index) => (
                <tr key={index}>
                  {week.map((cell, column) => {
                    if (!cell) return <td key={column} role="gridcell" />;
                    const isOutside = toIsoDate(cell) < min || toIsoDate(cell) > max;
                    const isToday = sameDay(cell, today);
                    const isSelected = sameDay(cell, selected);
                    const label = [
                      fullDate.format(Date.UTC(cell.year, cell.month - 1, cell.day)),
                      isToday ? t("today") : null,
                      isOutside ? t("outsideRange") : null,
                    ]
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <td key={column} role="gridcell" aria-selected={isSelected} className="p-0.5 text-center">
                        <DayButton
                          id={dayId(cell)}
                          day={cell.day}
                          label={label}
                          isFocusTarget={sameDay(cell, focusDay)}
                          isToday={isToday}
                          isSelected={isSelected}
                          isOutside={isOutside}
                          onPick={() => pick(cell)}
                          onKeyDown={handleDayKey}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-end justify-between gap-3 border-t border-line pt-2">
            <p className="text-xs leading-snug text-ink-soft">{t("calendarHelp")}</p>
            {selected && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  close();
                }}
                className="min-h-11 shrink-0 cursor-pointer rounded-lg px-2 text-sm font-semibold text-accent hover:underline focus-visible:outline-3 focus-visible:outline-accent"
              >
                {t("clearDate")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fullMonthName(day: CalendarDay, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", year: "numeric", timeZone: "UTC" }).format(
    Date.UTC(day.year, day.month - 1, 1),
  );
}

type HeaderProps = {
  focusDay: CalendarDay;
  first: CalendarDay;
  last: CalendarDay;
  locale: Locale;
  onMove: (day: CalendarDay) => void;
};

/** Previous / next month and the month and year lists (IMG12 "SEPTEMBER 2026 ▾"). */
function CalendarHeader({ focusDay, first, last, locale, onMove }: HeaderProps) {
  const t = useTranslations("goalControls");
  const monthName = new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", timeZone: "UTC" });
  const years = Array.from({ length: last.year - first.year + 1 }, (_, index) => first.year + index);
  const moveTo = (year: number, month: number) =>
    onMove({ year, month, day: Math.min(focusDay.day, daysInMonth(year, month)) });
  const selectClasses =
    "min-h-11 cursor-pointer rounded-lg bg-transparent px-1.5 font-semibold capitalize text-ink hover:bg-canvas focus-visible:outline-3 focus-visible:outline-accent";

  return (
    <div className="flex items-center gap-1">
      <NavButton
        label={t("previousMonth")}
        isDisabled={monthIndex(focusDay) <= monthIndex(first)}
        onClick={() => onMove(addMonths(focusDay, -1))}
      >
        <ChevronLeftIcon className="size-5" />
      </NavButton>
      <div className="flex flex-1 items-center justify-center">
        <select
          aria-label={t("month")}
          value={focusDay.month}
          onChange={(event) => moveTo(focusDay.year, Number(event.target.value))}
          className={selectClasses}
        >
          {Array.from({ length: MONTHS_PER_YEAR }, (_, index) => index + 1).map((month) => (
            <option key={month} value={month}>
              {monthName.format(Date.UTC(2024, month - 1, 1))}
            </option>
          ))}
        </select>
        {years.length > 1 ? (
          <select
            aria-label={t("year")}
            value={focusDay.year}
            onChange={(event) => moveTo(Number(event.target.value), focusDay.month)}
            className={`${selectClasses} tabular-nums`}
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        ) : (
          <span className="px-1.5 font-semibold tabular-nums">{focusDay.year}</span>
        )}
      </div>
      <NavButton
        label={t("nextMonth")}
        isDisabled={monthIndex(focusDay) >= monthIndex(last)}
        onClick={() => onMove(addMonths(focusDay, 1))}
      >
        <ChevronRightIcon className="size-5" />
      </NavButton>
    </div>
  );
}

type NavButtonProps = { label: string; isDisabled: boolean; onClick: () => void; children: ReactNode };

function NavButton({ label, isDisabled, onClick, children }: NavButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={isDisabled}
      onClick={onClick}
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-soft transition-colors duration-200 hover:bg-accent/10 hover:text-accent focus-visible:outline-3 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

function WeekdayHeader({ weekday, locale }: { weekday: number; locale: Locale }) {
  const date = MONDAY_2024 + (weekday - 1) * MS_PER_DAY;
  const format = (style: "short" | "long") =>
    new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: style, timeZone: "UTC" }).format(date);
  return (
    <th scope="col" abbr={format("long")} className="pb-1 text-xs font-semibold text-ink-soft capitalize">
      {format("short")}
    </th>
  );
}

type DayButtonProps = {
  id: string;
  day: number;
  label: string;
  isFocusTarget: boolean;
  isToday: boolean;
  isSelected: boolean;
  isOutside: boolean;
  onPick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

function DayButton({ id, day, label, isFocusTarget, isToday, isSelected, isOutside, onPick, onKeyDown }: DayButtonProps) {
  const tone = isSelected
    ? "bg-(image:--am-gradient) font-semibold text-on-brand"
    : isOutside
      ? "cursor-not-allowed text-ink-soft/45"
      : "text-ink hover:bg-accent/10 hover:text-accent";
  return (
    <button
      id={id}
      type="button"
      tabIndex={isFocusTarget ? 0 : -1}
      aria-label={label}
      aria-current={isToday ? "date" : undefined}
      aria-disabled={isOutside || undefined}
      onClick={isOutside ? undefined : onPick}
      onKeyDown={onKeyDown}
      className={`mx-auto flex size-10 cursor-pointer items-center justify-center rounded-full text-sm tabular-nums transition-colors duration-150 focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-accent motion-reduce:transition-none ${tone} ${isToday && !isSelected ? "ring-2 ring-accent/70 ring-inset" : ""}`}
    >
      {day}
    </button>
  );
}
