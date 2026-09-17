import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  addDays,
  dayOfWeek,
  formatDueDate,
  formatWeekRange,
  formatWeekRangeShort,
  inWeek,
  isSunday,
  shiftWeek,
  thisWeekStart,
  weekEndSaturday,
  weekStartSunday,
} from './week'

/**
 * CMR weeks run Sunday → Saturday, keyed by the Sunday. Pure calendar-day arithmetic; "this week"
 * follows the Pacific day (pacificToday), not UTC.
 */

afterEach(() => { vi.useRealTimers() })

describe('weekStartSunday', () => {
  it('a Sunday maps to itself', () => {
    expect(weekStartSunday('2026-09-13')).toBe('2026-09-13')
    expect(weekStartSunday('2026-01-04')).toBe('2026-01-04')
  })

  it('a Saturday maps to the Sunday six days earlier', () => {
    expect(weekStartSunday('2026-09-19')).toBe('2026-09-13')
  })

  it('mid-week days map to the prior Sunday', () => {
    for (const d of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']) {
      expect(weekStartSunday(d)).toBe('2026-09-13')
    }
  })

  it('crosses month, year and leap-day boundaries', () => {
    expect(weekStartSunday('2026-10-01')).toBe('2026-09-27') // Thu → Sun in September
    expect(weekStartSunday('2027-01-01')).toBe('2026-12-27') // Fri → Sun in the prior year
    expect(weekStartSunday('2028-03-01')).toBe('2028-02-27') // Wed after a leap day
    expect(weekStartSunday('2028-02-29')).toBe('2028-02-27')
  })

  it('every day of a week agrees, and the next Sunday starts a new week', () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays('2026-11-01', i)) // DST ends Nov 1
    expect(days.map(weekStartSunday)).toEqual(Array(7).fill('2026-11-01'))
    expect(weekStartSunday('2026-11-08')).toBe('2026-11-08')
    expect(weekStartSunday('2026-03-14')).toBe('2026-03-08') // DST starts Sun Mar 8
  })

  it('always returns a Sunday', () => {
    for (let i = 0; i < 400; i++) expect(dayOfWeek(weekStartSunday(addDays('2026-01-01', i)))).toBe(0)
  })
})

describe('week helpers', () => {
  it('weekEndSaturday / shiftWeek / inWeek / isSunday', () => {
    expect(weekEndSaturday('2026-09-13')).toBe('2026-09-19')
    expect(weekEndSaturday('2026-09-16')).toBe('2026-09-19')
    expect(shiftWeek('2026-09-16', 1)).toBe('2026-09-20')
    expect(shiftWeek('2026-09-13', -1)).toBe('2026-09-06')
    expect(shiftWeek('2026-12-30', 1)).toBe('2027-01-03')
    expect(inWeek('2026-09-19', '2026-09-13')).toBe(true)
    expect(inWeek('2026-09-20', '2026-09-13')).toBe(false)
    expect(inWeek('2026-09-12', '2026-09-13')).toBe(false)
    expect(isSunday('2026-09-13')).toBe(true)
    expect(isSunday('2026-09-19')).toBe(false)
  })

  it('formats ranges and due dates without a timezone shift', () => {
    expect(formatWeekRange('2026-09-13')).toBe('Sun, Sep 13 – Sat, Sep 19, 2026')
    expect(formatWeekRange('2026-12-27')).toBe('Sun, Dec 27, 2026 – Sat, Jan 2, 2027')
    expect(formatWeekRangeShort('2026-09-13')).toBe('Sep 13 – 19')
    expect(formatWeekRangeShort('2026-09-27')).toBe('Sep 27 – Oct 3')
    expect(formatDueDate('2026-09-17', '2026')).toBe('Thu, Sep 17')
    expect(formatDueDate('2027-01-02', '2026')).toBe('Sat, Jan 2, 2027')
  })

  it('thisWeekStart follows the PACIFIC day, not UTC', () => {
    vi.useFakeTimers()
    // Sat Sep 19 2026, 8:30 PM Pacific = Sun Sep 20 03:30 UTC. Pacific is still in the Sep 13 week.
    vi.setSystemTime(new Date('2026-09-20T03:30:00Z'))
    expect(thisWeekStart()).toBe('2026-09-13')
    // Sun Sep 20 2026, 12:05 AM Pacific → the new week.
    vi.setSystemTime(new Date('2026-09-20T07:05:00Z'))
    expect(thisWeekStart()).toBe('2026-09-20')
  })
})
