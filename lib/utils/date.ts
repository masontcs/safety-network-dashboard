import { format, subDays, startOfMonth, startOfYear, subWeeks } from 'date-fns'

function parseLocal(dateStr: string): Date {
  // Parse as local date to avoid UTC offset shifting the day
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function getMostRecentSaturday(from: Date = new Date()): Date {
  const d = new Date(from)
  const day = d.getDay() // 0=Sun … 6=Sat
  d.setDate(d.getDate() - ((day + 1) % 7))
  return d
}

export function getDateRange(
  view: 'weekly' | 'mtd' | 'ytd',
  periodDate: string,
): { startDate: string; endDate: string } {
  const end = parseLocal(periodDate)
  let start: Date

  if (view === 'weekly') {
    start = subDays(end, 6)
  } else if (view === 'mtd') {
    start = startOfMonth(end)
  } else {
    start = startOfYear(end)
  }

  return {
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: periodDate,
  }
}

export function getTrendStart(periodDate: string): string {
  const end = parseLocal(periodDate)
  return format(subWeeks(end, 12), 'yyyy-MM-dd')
}

export function formatPeriodDate(dateStr: string): string {
  return format(parseLocal(dateStr), 'MMM d')
}

export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))
}

/**
 * Current date in Pacific time as an ISO yyyy-mm-dd string.
 *
 * The business runs in Pacific time. `new Date().toISOString().slice(0,10)` gives the UTC
 * date, so any evening after ~4–5pm PT it has already rolled to *tomorrow* — which made
 * "today" buttons and default date seeds in dispatch/time-management jump a day ahead for
 * the whole late shift. Formatting in America/Los_Angeles keeps "today" meaning today where
 * the crews actually are. en-CA renders as YYYY-MM-DD; the timeZone option does the shift.
 */
export function pacificToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
