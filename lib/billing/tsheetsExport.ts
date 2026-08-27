/**
 * TSheets export — pure builders (no I/O), so they can be unit-tested against the real sample
 * (tsheets_daily_STS_2026-08-03.csv). The output must match that file EXACTLY: 10 columns,
 * every value double-quoted, one row per entry, overnight entries split at the midnight
 * boundary into two dated rows.
 */

export interface ExportEntry {
  username: string
  date: string            // effective date, YYYY-MM-DD
  startTime: string       // HH:MM or HH:MM:SS
  endTime: string
  jobcode: string         // QB customer name (or the yard jobcode)
  activityKeyword: string // note prefix: labor / transit / yard / admin
  serviceItem: string     // QB export string: LABOR-FIELD TIME, etc.
  billable: boolean
  jobNumber: string | null
  shiftSchedule: string | null
  pw: boolean
  techNote: string | null
}

export const EXPORT_HEADER = ['username', 'in_time', 'out_time', 'tz', 'jobcode', 'notes', 'custom field name', 'custom field value', 'custom field name', 'custom field value'] as const
const TZ = '-8'

const parseHM = (t: string): [number, number] => { const [h, m] = t.split(':'); return [parseInt(h, 10), parseInt(m, 10)] }
const toMin = (t: string): number => { const [h, m] = parseHM(t); return h * 60 + m }

/** "2026-08-03" -> "08/03/2026" */
export function fmtDate(d: string): string { const [y, m, day] = d.split('-'); return `${m}/${day}/${y}` }
/** minutes -> "06:00 am" (12-hour, zero-padded hour, as in the sample). */
export function fmt12(min: number): string {
  const h = Math.floor(min / 60), m = min % 60
  const ap = h < 12 ? 'am' : 'pm'
  let hr = h % 12; if (hr === 0) hr = 12
  return `${String(hr).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ap}`
}
const dt = (date: string, min: number) => `${fmtDate(date)} ${fmt12(min)}`
const addDay = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }

/** The notes column: `<activity> | <job#> [| <schedule>] [| PW] [| <tech note>] [| OVERNIGHT SHIFT (part x of y)]`. */
export function composeNote(e: ExportEntry, overnight?: { part: number; of: number }): string {
  const parts: string[] = [e.activityKeyword]
  if (e.jobNumber) parts.push(e.jobNumber)
  if (e.shiftSchedule) parts.push(e.shiftSchedule)
  if (e.pw) parts.push('PW')
  if (e.techNote && e.techNote.trim()) parts.push(e.techNote.trim())
  if (overnight) parts.push(`OVERNIGHT SHIFT (part ${overnight.part} of ${overnight.of})`)
  return parts.join(' | ')
}

/** One export entry -> one or two CSV rows (two when it crosses midnight). */
export function rowsForEntry(e: ExportEntry): string[][] {
  const startMin = toMin(e.startTime), endMin = toMin(e.endTime)
  const crosses = endMin <= startMin
  const custom = (note: string, inT: string, outT: string): string[] =>
    [e.username, inT, outT, TZ, e.jobcode, note, 'Billable', e.billable ? 'Yes' : 'No', 'Service Item', e.serviceItem]

  if (!crosses) {
    return [custom(composeNote(e), dt(e.date, startMin), dt(e.date, endMin))]
  }
  // Overnight: part 1 ends 11:59 pm on the start date; part 2 starts 12:00 am the next date.
  const nextDate = addDay(e.date)
  return [
    custom(composeNote(e, { part: 1, of: 2 }), dt(e.date, startMin), dt(e.date, 23 * 60 + 59)),
    custom(composeNote(e, { part: 2, of: 2 }), dt(nextDate, 0), dt(nextDate, endMin)),
  ]
}

/** Escape a single CSV field: wrap in quotes, double any internal quotes (newlines are kept). */
const csvField = (v: string) => `"${v.replace(/"/g, '""')}"`
const csvRow = (cells: string[]) => cells.map(csvField).join(',')

/** Build the full CSV (header + rows) from export entries, in input order. */
export function buildCsv(entries: ExportEntry[]): string {
  const lines = [csvRow([...EXPORT_HEADER])]
  for (const e of entries) for (const r of rowsForEntry(e)) lines.push(csvRow(r))
  return lines.join('\n') + '\n'
}

/** Filename: tsheets_daily_<branch>_<workdate>_exported-<YYYYMMDD-HHMM>.csv */
export function exportFilename(branchCode: string, workDate: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
  const safe = (branchCode || 'branch').replace(/[^A-Za-z0-9]+/g, '')
  return `tsheets_daily_${safe}_${workDate}_exported-${stamp}.csv`
}
