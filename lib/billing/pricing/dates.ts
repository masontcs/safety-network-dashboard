/**
 * Date math for rental billing.
 *
 * Everything is a 'YYYY-MM-DD' string converted to a UTC epoch-day integer.
 * We never construct a local-time Date, because `new Date('2024-05-13')` is
 * midnight UTC — which is May 12th at 5pm in Bakersfield. That one-day shift
 * is exactly how a rental gets billed for the wrong number of days.
 */
import type { ISODate } from './types';

const DAY_MS = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toEpochDay(d: ISODate): number {
  if (!ISO_RE.test(d)) throw new Error(`Invalid ISODate: ${d} (expected YYYY-MM-DD)`);
  const [y, m, day] = d.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, day);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISODate: ${d}`);
  return Math.floor(ms / DAY_MS);
}

export function fromEpochDay(n: number): ISODate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export const cmpDate = (a: ISODate, b: ISODate): number => toEpochDay(a) - toEpochDay(b);
export const maxDate = (a: ISODate, b: ISODate): ISODate => (cmpDate(a, b) >= 0 ? a : b);
export const minDate = (a: ISODate, b: ISODate): ISODate => (cmpDate(a, b) <= 0 ? a : b);

/** Inclusive of BOTH endpoints: 2024-05-13 .. 2024-05-13 === 1 day. */
export function daysInclusive(start: ISODate, end: ISODate): number {
  return toEpochDay(end) - toEpochDay(start) + 1;
}

export const addDays = (d: ISODate, n: number): ISODate => fromEpochDay(toEpochDay(d) + n);

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/**
 * Add calendar months, clamping the day-of-month.
 * Jan 31 + 1 month === Feb 28 (or Feb 29 in a leap year) — not Mar 3.
 */
export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number);
  const idx = m - 1 + n;
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${pad(ty, 4)}-${pad(tm + 1, 2)}-${pad(Math.min(day, daysInTarget), 2)}`;
}

/**
 * Whole CALENDAR months from `start` through `endInclusive`, plus whether a
 * partial month remains. A month period runs from the anchor day to the day
 * before the same day next month: Jan 15 -> Feb 14 is one month.
 *
 * Jan 1 .. Jan 31 === exactly 1 month (31 days), not 2. That's the point.
 */
export function calendarMonths(start: ISODate, endInclusive: ISODate): { full: number; partial: boolean } {
  if (cmpDate(endInclusive, start) < 0) return { full: 0, partial: false };
  const endPlus1 = addDays(endInclusive, 1);
  let full = 0;
  while (full < 1200 && cmpDate(addMonths(start, full + 1), endPlus1) <= 0) full++;
  const partial = cmpDate(addMonths(start, full), endInclusive) <= 0;
  return { full, partial };
}
