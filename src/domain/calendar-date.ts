// Calendar arithmetic on ISO calendar dates ("YYYY-MM-DD") for the goal date picker (G2-13) and
// the copy of last year's goals (G2-06). Client-safe and time-zone free: a goal date is a day, not
// an instant, so all maths runs on UTC midnight and never touches the local clock.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;
/** ISO weekday of Date.getUTCDay() = 0 (Sunday). */
const ISO_SUNDAY = 7;

export interface CalendarDay {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

const pad = (value: number, length: number): string => String(value).padStart(length, "0");

export function toIsoDate({ year, month, day }: CalendarDay): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Null for malformed or impossible dates (2027-02-30). */
export function parseIsoDate(value: string): CalendarDay | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const isReal = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isReal ? { year, month, day } : null;
}

const toUtc = ({ year, month, day }: CalendarDay): Date => new Date(Date.UTC(year, month - 1, day));
const fromUtc = (date: Date): CalendarDay => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: CalendarDay, days: number): CalendarDay {
  return fromUtc(new Date(toUtc(date).getTime() + days * MS_PER_DAY));
}

/** Same day in another month; a day the target month lacks becomes its last day (31 Jan + 1 = 28/29 Feb). */
export function addMonths(date: CalendarDay, months: number): CalendarDay {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Same day and month in `year`; 29 Feb becomes 28 Feb in a common year. */
export function moveToYear(date: CalendarDay, year: number): CalendarDay {
  return { year, month: date.month, day: Math.min(date.day, daysInMonth(year, date.month)) };
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: CalendarDay): number {
  return toUtc(date).getUTCDay() || ISO_SUNDAY;
}

/** Days back to the first day of the week that `date` is in. */
function offsetInWeek(date: CalendarDay, firstDayOfWeek: number): number {
  return (isoWeekday(date) - firstDayOfWeek + DAYS_PER_WEEK) % DAYS_PER_WEEK;
}

export function startOfWeek(date: CalendarDay, firstDayOfWeek: number): CalendarDay {
  return addDays(date, -offsetInWeek(date, firstDayOfWeek));
}

export function endOfWeek(date: CalendarDay, firstDayOfWeek: number): CalendarDay {
  return addDays(startOfWeek(date, firstDayOfWeek), DAYS_PER_WEEK - 1);
}

/**
 * The month as weeks of 7 cells starting on `firstDayOfWeek`; cells outside the month are null,
 * so the grid shows only the month's own days (as eGEDP does).
 */
export function monthWeeks(year: number, month: number, firstDayOfWeek: number): (CalendarDay | null)[][] {
  const lead = offsetInWeek({ year, month, day: 1 }, firstDayOfWeek);
  const cells: (CalendarDay | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth(year, month); day += 1) cells.push({ year, month, day });
  while (cells.length % DAYS_PER_WEEK !== 0) cells.push(null);
  return Array.from({ length: cells.length / DAYS_PER_WEEK }, (_, week) =>
    cells.slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK),
  );
}

/** ISO weekdays in display order, e.g. [1..7] when the week starts on Monday. */
export function weekdayOrder(firstDayOfWeek: number): number[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => ((firstDayOfWeek - 1 + index) % DAYS_PER_WEEK) + 1);
}

export function sameDay(a: CalendarDay | null, b: CalendarDay | null): boolean {
  return a !== null && b !== null && a.year === b.year && a.month === b.month && a.day === b.day;
}

/** The nearest day inside [first, last] (both inclusive). */
export function clampDay(date: CalendarDay, first: CalendarDay, last: CalendarDay): CalendarDay {
  if (toIsoDate(date) < toIsoDate(first)) return first;
  if (toIsoDate(date) > toIsoDate(last)) return last;
  return date;
}
