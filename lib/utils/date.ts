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
