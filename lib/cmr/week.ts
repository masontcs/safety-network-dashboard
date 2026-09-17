import { pacificToday } from '@/lib/utils/date'

/**
 * SN Cash Ledger (CMR) weeks. A CMR week runs SUNDAY → SATURDAY and is identified by its
 * Sunday (`week_start`). All arithmetic is on Pacific calendar-day strings ('YYYY-MM-DD'): the
 * only clock read is pacificToday(), so "this week" rolls over at midnight Pacific, never at
 * midnight UTC. Safe to import from client components.
 */

const parts = (d: string): [number, number, number] => {
  const [y, m, day] = d.split('-').map(Number)
  return [y, m, day]
}

const iso = (dt: Date): string => dt.toISOString().slice(0, 10)

/** Calendar arithmetic on 'YYYY-MM-DD' (no timezone involved). */
export function addDays(d: string, days: number): string {
  const [y, m, day] = parts(d)
  return iso(new Date(Date.UTC(y, m - 1, day + days)))
}

/** 0 = Sunday … 6 = Saturday, for a calendar day. */
export function dayOfWeek(d: string): number {
  const [y, m, day] = parts(d)
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay()
}

/** The Sunday on or before `d` — a Sunday maps to itself, Saturday to the Sunday six days back. */
export function weekStartSunday(d: string): string {
  return addDays(d, -dayOfWeek(d))
}

/** The Saturday that ends the week starting `weekStart` (any day of the week works). */
export function weekEndSaturday(d: string): string {
  return addDays(weekStartSunday(d), 6)
}

/** The Sunday of the current week in Pacific time. */
export function thisWeekStart(): string {
  return weekStartSunday(pacificToday())
}

/** Step whole weeks from any day; returns a Sunday. */
export function shiftWeek(d: string, weeks: number): string {
  return addDays(weekStartSunday(d), weeks * 7)
}

export const isSunday = (d: string): boolean => dayOfWeek(d) === 0

/** Whether `d` falls inside the Sunday-start week `weekStart`. */
export function inWeek(d: string, weekStart: string): boolean {
  return weekStartSunday(d) === weekStartSunday(weekStart)
}

const fmt = (d: string, o: Intl.DateTimeFormatOptions): string => {
  const [y, m, day] = parts(d)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', ...o })
}

/** "Sun, Sep 13 – Sat, Sep 19, 2026" (years shown on both ends only when they differ). */
export function formatWeekRange(weekStart: string): string {
  const start = weekStartSunday(weekStart)
  const end = addDays(start, 6)
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  const a = fmt(start, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  const b = fmt(end, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  return `${a} – ${b}`
}

/** Short range for tight spots: "Sep 13 – 19" / "Sep 27 – Oct 3". */
export function formatWeekRangeShort(weekStart: string): string {
  const start = weekStartSunday(weekStart)
  const end = addDays(start, 6)
  const a = fmt(start, { month: 'short', day: 'numeric' })
  const b = start.slice(5, 7) === end.slice(5, 7) ? fmt(end, { day: 'numeric' }) : fmt(end, { month: 'short', day: 'numeric' })
  return `${a} – ${b}`
}

/** "Thu, Sep 17" (with the year when it isn't `refYear`). */
export function formatDueDate(d: string, refYear?: string): string {
  const showYear = refYear !== undefined && d.slice(0, 4) !== refYear
  return fmt(d, { weekday: 'short', month: 'short', day: 'numeric', ...(showYear ? { year: 'numeric' } : {}) })
}
