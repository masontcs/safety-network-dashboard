/**
 * Labor time helpers.
 *
 * Techs enter TIMES, not hour sums — `0700-1100 Transit` — so duration is always
 * derived. Times are plain time-of-day strings with no timezone (the billing
 * system deliberately avoids zone math), and a segment may cross midnight:
 * when end <= start it wrapped into the next day.
 *
 * Rounding is to the nearest quarter hour, applied to the TIMES (not just the
 * duration), so segments stay contiguous and every duration is a clean quarter.
 */

const DAY_MINUTES = 1440
const QUARTER = 15

/** 'HH:MM' or 'HH:MM:SS' -> minutes since midnight. NaN if unparseable. */
export function timeToMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t.trim())
  if (!m) return NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return NaN
  return h * 60 + min
}

/** minutes since midnight -> 'HH:MM' (wraps at 24h). */
export function minutesToTime(mins: number): string {
  const m = ((mins % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Round to the nearest quarter hour. 23:53 -> 00:00 (next day) by wrapping. */
export function roundToQuarter(mins: number): number {
  return (Math.round(mins / QUARTER) * QUARTER) % DAY_MINUTES
}

/**
 * Minutes worked between two times, wrapping midnight.
 * end < start  -> crossed midnight, add a day.
 * end == start -> ambiguous (0 or 24h), so callers must reject it; returns 0.
 */
export function segmentMinutes(startMins: number, endMins: number): number {
  const d = endMins - startMins
  if (d > 0) return d
  if (d === 0) return 0
  return d + DAY_MINUTES
}

/** Minutes -> decimal hours, 2dp (quarter hours are exact: 0.25/0.5/0.75). */
export function minutesToHours(mins: number): number {
  return Math.round((mins / 60) * 100) / 100
}
