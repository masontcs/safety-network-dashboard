import {
  CMR_WEEKDAY_SHORT,
  describeSchedule,
  isScheduleComplete,
  type CmrRecurringFrequency,
  type CmrRecurringSchedule,
  type CmrRecurringSection,
} from '@/lib/cmr/recurring'
import { addDays, dayOfWeek, weekEndSaturday, weekStartSunday } from '@/lib/cmr/week'

/**
 * SN Cash Ledger (CMR) — the recurring "due" engine.
 *
 * Pure calendar arithmetic on Pacific day strings ('YYYY-MM-DD'), with no clock read and no
 * Date-with-a-time anywhere: every helper goes through Date.UTC on the three integers of the
 * string, so a daylight-saving change cannot move a date by a day. The caller supplies the
 * reference day (pacificToday()); nothing here reads the system clock, which is what makes it
 * testable and what makes "due" mean the same thing on the server and in the browser.
 *
 * ── what "due" means ────────────────────────────────────────────────────────
 * For the week being viewed (Sunday → Saturday), each scheduled vendor has ONE occurrence that
 * belongs to the period the week ends in:
 *
 *   weekly     the day in that week whose weekday is schedule_weekday
 *   monthly    schedule_day_of_month in that month, clamped to the month's length (the 31st is
 *              the 28th in February, the 29th in a leap February)
 *   quarterly  the same clamped day, in the latest month on or before it that is
 *              schedule_anchor_month + a whole number of quarters
 *   annually   the same clamped day, in schedule_anchor_month of that year
 *
 * A week can straddle two months, so both periods are considered and the occurrence shown is
 * the latest one that has arrived by the end of the week (otherwise the earliest still to
 * come) — an occurrence landing inside the viewed week is never skipped.
 *
 * The vendor is DUE when that occurrence has arrived — its date is on or before the last day of
 * the week being viewed — and nothing has been recorded against it yet. So a monthly vendor due
 * on the 3rd keeps showing as due in every later week of that month until it is handled, which
 * is the whole point: nothing quietly falls off the list.
 *
 * ── what "handled" means ────────────────────────────────────────────────────
 * Each occurrence owns a WINDOW — the period it belongs to: its own week, calendar month,
 * quarter (three months from the occurrence month) or calendar year. The occurrence is handled
 * when a row inside that window points back at the vendor: a pending item with
 * source = 'recurring' and source_ref_id = the vendor whose effective_date falls in the window,
 * or a weekly priority with source_recurring_id = the vendor whose Sunday → Saturday week
 * overlaps it. The same window is re-checked inside the placement functions while the vendor
 * row is locked, so two Controllers can't both accept the same suggestion.
 *
 * Urgent Payment Plans have no schedule and are never suggested; nor is a vendor that is
 * inactive, on hold, or whose schedule is incomplete (the engine never guesses a date).
 */

export type { CmrRecurringFrequency }

/** The half-open-free inclusive day range an occurrence belongs to. */
export interface CmrDueWindow {
  start: string
  end: string
}

/** One vendor's occurrence for the week being viewed. */
export interface CmrOccurrence {
  /** The Pacific day the payment is scheduled for. */
  date: string
  /** The period that occurrence belongs to — what counts as handling it. */
  window: CmrDueWindow
}

export interface CmrDueVendorInput {
  id: string
  section: CmrRecurringSection
  schedule: CmrRecurringSchedule
  active: boolean
  onHold: boolean
}

/** A row that may have handled an occurrence. */
export interface CmrHandledRow {
  vendorId: string
  /** A pending item's effective_date, or a priority's week_start. */
  date: string
  kind: 'pending' | 'priority'
}

export type CmrDueState = 'due' | 'handled' | 'not-yet' | 'unscheduled'

export interface CmrDueResult {
  vendorId: string
  state: CmrDueState
  /** Null only when the vendor has no occurrence at all (urgent, inactive, held, no schedule). */
  occurrence: CmrOccurrence | null
  /** Set when state is 'handled': how it was handled. */
  handledBy: 'pending' | 'priority' | null
}

// ── calendar helpers (no clock, no timezone) ────────────────────────────────

const parts = (d: string): [number, number, number] => {
  const [y, m, day] = d.split('-').map(Number)
  return [y, m, day]
}

const iso = (y: number, m: number, d: number): string =>
  new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)

/** Days in month `m` (1-12) of year `y`, leap years included. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** `dayOfMonth` in that month, clamped to the month's length: the 31st is Feb 28 / 29. */
export function clampDayOfMonth(y: number, m: number, dayOfMonth: number): string {
  return iso(y, m, Math.min(dayOfMonth, daysInMonth(y, m)))
}

/** Step whole months from (y, m), wrapping the year. */
function shiftMonth(y: number, m: number, months: number): [number, number] {
  const zero = y * 12 + (m - 1) + months
  return [Math.floor(zero / 12), (((zero % 12) + 12) % 12) + 1]
}

const firstOfMonth = (y: number, m: number): string => iso(y, m, 1)
const lastOfMonth = (y: number, m: number): string => iso(y, m, daysInMonth(y, m))

// ── the occurrence for one vendor, in the week being viewed ─────────────────

/**
 * The occurrence of `section`'s period that contains the calendar month (y, m), with the window
 * that occurrence owns. Weekly is handled by the caller — its period is the week itself.
 */
function monthlyFamilyOccurrence(
  section: Exclude<CmrRecurringFrequency, 'weekly'>,
  schedule: CmrRecurringSchedule,
  y: number,
  m: number,
): CmrOccurrence {
  const dom = schedule.dayOfMonth as number

  if (section === 'monthly') {
    return { date: clampDayOfMonth(y, m, dom), window: { start: firstOfMonth(y, m), end: lastOfMonth(y, m) } }
  }

  if (section === 'quarterly') {
    // The latest occurrence month on or before m: step back from it by however far it sits into
    // its own quarter. (anchor + 3k) ≡ m (mod 3) picks the cycle month inside m's quarter.
    const anchor = schedule.anchorMonth as number
    const back = (((m - anchor) % 3) + 3) % 3
    const [oy, om] = shiftMonth(y, m, -back)
    const [wy, wm] = shiftMonth(oy, om, 2)
    return { date: clampDayOfMonth(oy, om, dom), window: { start: firstOfMonth(oy, om), end: lastOfMonth(wy, wm) } }
  }

  // annually — one occurrence per calendar year, in the anchor month.
  const anchor = schedule.anchorMonth as number
  return { date: clampDayOfMonth(y, anchor, dom), window: { start: iso(y, 1, 1), end: iso(y, 12, 31) } }
}

/**
 * The occurrence the week being viewed is about, with the window that occurrence owns. Null
 * when there is no schedule to compute from (urgent, or a vendor that has none yet).
 *
 * A week can straddle two months — and so two periods — so both are considered: the occurrence
 * shown is the LATEST one that has arrived by the end of the week, and otherwise the earliest
 * one still to come. That way an occurrence landing inside the viewed week is never skipped
 * because the week happens to end in the next month.
 */
export function occurrenceForWeek(
  section: CmrRecurringSection,
  schedule: CmrRecurringSchedule,
  weekStart: string,
): CmrOccurrence | null {
  if (section === 'urgent' || !isScheduleComplete(section, schedule)) return null
  const start = weekStartSunday(weekStart)
  const end = weekEndSaturday(start)

  if (section === 'weekly') {
    return { date: addDays(start, schedule.weekday as number), window: { start, end } }
  }

  const [sy, sm] = parts(start)
  const [ey, em] = parts(end)
  const rest = section as Exclude<CmrRecurringFrequency, 'weekly'>
  const candidates = [monthlyFamilyOccurrence(rest, schedule, sy, sm)]
  if (sy !== ey || sm !== em) {
    const later = monthlyFamilyOccurrence(rest, schedule, ey, em)
    if (later.date !== candidates[0].date) candidates.push(later)
  }
  candidates.sort((a, b) => a.date.localeCompare(b.date))

  const arrived = candidates.filter((c) => c.date <= end)
  return arrived.length ? arrived[arrived.length - 1] : candidates[0]
}

/** Whether a day falls inside a window (inclusive at both ends). */
export const inWindow = (day: string, w: CmrDueWindow): boolean => day >= w.start && day <= w.end

/**
 * Whether a Sunday-start week OVERLAPS a window — how a weekly priority handles an occurrence.
 * For a weekly vendor the week and the window are the same seven days.
 */
export function weekOverlapsWindow(weekStart: string, w: CmrDueWindow): boolean {
  const start = weekStartSunday(weekStart)
  return start <= w.end && addDays(start, 6) >= w.start
}

/**
 * Every vendor's state for one week, in the order they were given. `handled` carries the rows
 * that point back at a vendor — pending items by effective_date, priorities by week_start.
 */
export function computeDue(
  vendors: CmrDueVendorInput[],
  weekStart: string,
  handled: CmrHandledRow[],
): CmrDueResult[] {
  const start = weekStartSunday(weekStart)
  const end = weekEndSaturday(start)
  const byVendor = new Map<string, CmrHandledRow[]>()
  for (const h of handled) {
    const list = byVendor.get(h.vendorId)
    if (list) list.push(h)
    else byVendor.set(h.vendorId, [h])
  }

  return vendors.map((v): CmrDueResult => {
    if (!v.active || v.onHold) return { vendorId: v.id, state: 'unscheduled', occurrence: null, handledBy: null }
    const occurrence = occurrenceForWeek(v.section, v.schedule, start)
    if (!occurrence) return { vendorId: v.id, state: 'unscheduled', occurrence: null, handledBy: null }

    const hit = (byVendor.get(v.id) ?? []).find((h) =>
      h.kind === 'pending' ? inWindow(h.date, occurrence.window) : weekOverlapsWindow(h.date, occurrence.window),
    )
    if (hit) return { vendorId: v.id, state: 'handled', occurrence, handledBy: hit.kind }

    return {
      vendorId: v.id,
      state: occurrence.date <= end ? 'due' : 'not-yet',
      occurrence,
      handledBy: null,
    }
  })
}

// ── display ─────────────────────────────────────────────────────────────────

/** "Thu, Sep 17" — the scheduled day, with the year only when it isn't `refYear`. */
export function formatOccurrence(date: string, refYear?: string): string {
  const [y, m, d] = parts(date)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(refYear !== undefined && date.slice(0, 4) !== refYear ? { year: 'numeric' } : {}),
  })
}

/** The weekday of a day string, as "Thu" — used where only the day name matters. */
export const weekdayShort = (date: string): string => CMR_WEEKDAY_SHORT[dayOfWeek(date)]

export { describeSchedule }
