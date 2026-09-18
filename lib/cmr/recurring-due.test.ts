import { describe, it, expect } from 'vitest'
import {
  clampDayOfMonth,
  computeDue,
  daysInMonth,
  inWindow,
  occurrenceForWeek,
  weekOverlapsWindow,
  type CmrDueVendorInput,
  type CmrHandledRow,
} from '@/lib/cmr/recurring-due'
import { describeSchedule, quarterMonths, type CmrRecurringSchedule, type CmrRecurringSection } from '@/lib/cmr/recurring'
import { addDays, dayOfWeek, weekEndSaturday } from '@/lib/cmr/week'

/**
 * The Phase 7 suggestion engine. It decides what money is expected this week, so the arithmetic
 * is tested hard: every frequency, the month-length clamp, quarter stepping, year boundaries,
 * the weeks that straddle a month, and both daylight-saving changes (which must move nothing,
 * because every date here is a calendar string, never an instant).
 */

const sched = (o: Partial<CmrRecurringSchedule>): CmrRecurringSchedule => ({
  weekday: null,
  dayOfMonth: null,
  anchorMonth: null,
  ...o,
})

const occ = (section: CmrRecurringSection, s: CmrRecurringSchedule, weekStart: string) =>
  occurrenceForWeek(section, s, weekStart)

// ── weekly ──────────────────────────────────────────────────────────────────

describe('occurrence — weekly', () => {
  // Sun 2026-09-13 … Sat 2026-09-19
  const WEEK = '2026-09-13'

  it('lands on that weekday of the week being viewed, for all seven days', () => {
    const expected = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']
    for (let wd = 0; wd <= 6; wd++) {
      const o = occ('weekly', sched({ weekday: wd }), WEEK)
      expect(o?.date, `weekday ${wd}`).toBe(expected[wd])
      expect(dayOfWeek(o!.date)).toBe(wd)
    }
  })

  it('owns exactly the viewed week as its window', () => {
    const o = occ('weekly', sched({ weekday: 4 }), WEEK)
    expect(o?.window).toEqual({ start: '2026-09-13', end: '2026-09-19' })
  })

  it('resolves any day of the week to that same week', () => {
    const fromSunday = occ('weekly', sched({ weekday: 2 }), '2026-09-13')
    for (const d of ['2026-09-14', '2026-09-16', '2026-09-19']) {
      expect(occ('weekly', sched({ weekday: 2 }), d)).toEqual(fromSunday)
    }
  })
})

// ── monthly, and the month-length clamp ─────────────────────────────────────

describe('occurrence — monthly', () => {
  it('is that day of the month the week sits in', () => {
    const o = occ('monthly', sched({ dayOfMonth: 15 }), '2026-09-13')
    expect(o?.date).toBe('2026-09-15')
    expect(o?.window).toEqual({ start: '2026-09-01', end: '2026-09-30' })
  })

  it('clamps the 31st to the last day of a short month', () => {
    // February 2027 (28 days) and February 2028 (leap, 29)
    expect(occ('monthly', sched({ dayOfMonth: 31 }), '2027-02-07')?.date).toBe('2027-02-28')
    expect(occ('monthly', sched({ dayOfMonth: 31 }), '2028-02-06')?.date).toBe('2028-02-29')
    // 30-day months
    expect(occ('monthly', sched({ dayOfMonth: 31 }), '2026-04-05')?.date).toBe('2026-04-30')
    expect(occ('monthly', sched({ dayOfMonth: 31 }), '2026-11-08')?.date).toBe('2026-11-30')
    // and the clamp never moves a day that fits
    expect(occ('monthly', sched({ dayOfMonth: 28 }), '2027-02-07')?.date).toBe('2027-02-28')
  })

  it('clampDayOfMonth / daysInMonth agree with the calendar', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2100, 2)).toBe(28) // a century year that is not a leap year
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(clampDayOfMonth(2026, 2, 31)).toBe('2026-02-28')
    expect(clampDayOfMonth(2026, 12, 1)).toBe('2026-12-01')
  })

  it('a week straddling two months shows the occurrence that has arrived in it', () => {
    // Sun 2026-08-30 … Sat 2026-09-05 spans August and September.
    // The 31st: August's (Aug 31) has arrived inside the week; September's (Sep 30) has not.
    const late = occ('monthly', sched({ dayOfMonth: 31 }), '2026-08-30')
    expect(late?.date).toBe('2026-08-31')
    expect(late?.window).toEqual({ start: '2026-08-01', end: '2026-08-31' })

    // The 3rd: both have arrived by Sat Sep 5, so the later (current) period wins.
    const early = occ('monthly', sched({ dayOfMonth: 3 }), '2026-08-30')
    expect(early?.date).toBe('2026-09-03')
    expect(early?.window).toEqual({ start: '2026-09-01', end: '2026-09-30' })
  })

  it('shows the upcoming occurrence when neither has arrived', () => {
    // Sun 2026-05-31 … Sat 2026-06-06, day 20: May 20 is past this week's start month rule,
    // June 20 is still to come — the earliest candidate that is still ahead is shown.
    const o = occ('monthly', sched({ dayOfMonth: 20 }), '2026-05-31')
    expect(o?.date).toBe('2026-05-20')
  })
})

// ── quarterly ───────────────────────────────────────────────────────────────

describe('occurrence — quarterly', () => {
  it('recurs in the anchor month and every third month after it', () => {
    expect(quarterMonths(2)).toEqual([2, 5, 8, 11])
    expect(quarterMonths(12)).toEqual([12, 3, 6, 9])
    expect(quarterMonths(1)).toEqual([1, 4, 7, 10])
  })

  it('steps back to the latest cycle month on or before the week', () => {
    const s = sched({ dayOfMonth: 10, anchorMonth: 2 }) // Feb, May, Aug, Nov
    expect(occ('quarterly', s, '2026-02-08')?.date).toBe('2026-02-10') // in the cycle month
    expect(occ('quarterly', s, '2026-03-08')?.date).toBe('2026-02-10') // one month past
    expect(occ('quarterly', s, '2026-04-05')?.date).toBe('2026-02-10') // two months past
    expect(occ('quarterly', s, '2026-05-10')?.date).toBe('2026-05-10') // next cycle month
    expect(occ('quarterly', s, '2026-08-09')?.date).toBe('2026-08-10')
    expect(occ('quarterly', s, '2026-11-08')?.date).toBe('2026-11-10')
  })

  it('steps back across the turn of the year', () => {
    const s = sched({ dayOfMonth: 10, anchorMonth: 2 }) // … Nov 2026, then Feb 2027
    const o = occ('quarterly', s, '2027-01-10') // Sun 2027-01-10 … Sat 2027-01-16
    expect(o?.date).toBe('2026-11-10')
    expect(o?.window).toEqual({ start: '2026-11-01', end: '2027-01-31' })
  })

  it('owns the three months of its quarter as the window', () => {
    const o = occ('quarterly', sched({ dayOfMonth: 1, anchorMonth: 1 }), '2026-02-08')
    expect(o?.date).toBe('2026-01-01')
    expect(o?.window).toEqual({ start: '2026-01-01', end: '2026-03-31' })
  })

  it('clamps the day inside the cycle month too', () => {
    // Anchor February, the 31st → Feb 28 in 2027, and Feb 29 in leap 2028.
    expect(occ('quarterly', sched({ dayOfMonth: 31, anchorMonth: 2 }), '2027-02-07')?.date).toBe('2027-02-28')
    expect(occ('quarterly', sched({ dayOfMonth: 31, anchorMonth: 2 }), '2028-02-06')?.date).toBe('2028-02-29')
  })
})

// ── annually ────────────────────────────────────────────────────────────────

describe('occurrence — annually', () => {
  it('is that day of the anchor month, in the year being viewed', () => {
    const o = occ('annually', sched({ dayOfMonth: 15, anchorMonth: 3 }), '2026-09-13')
    expect(o?.date).toBe('2026-03-15')
    expect(o?.window).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('clamps February 31 to the real last day, leap year included', () => {
    expect(occ('annually', sched({ dayOfMonth: 31, anchorMonth: 2 }), '2027-06-06')?.date).toBe('2027-02-28')
    expect(occ('annually', sched({ dayOfMonth: 31, anchorMonth: 2 }), '2028-06-04')?.date).toBe('2028-02-29')
  })

  it('a week straddling New Year shows the occurrence that has arrived', () => {
    // Sun 2026-12-27 … Sat 2027-01-02. A December vendor's 2026 payment sits inside the week.
    const dec = occ('annually', sched({ dayOfMonth: 30, anchorMonth: 12 }), '2026-12-27')
    expect(dec?.date).toBe('2026-12-30')
    expect(dec?.window).toEqual({ start: '2026-01-01', end: '2026-12-31' })

    // A January vendor: 2026's is long past, 2027's is still to come — the arrived one wins.
    const jan = occ('annually', sched({ dayOfMonth: 20, anchorMonth: 1 }), '2026-12-27')
    expect(jan?.date).toBe('2026-01-20')
    expect(jan?.window.end).toBe('2026-12-31')
  })
})

// ── nothing to compute from ─────────────────────────────────────────────────

describe('occurrence — no schedule to compute from', () => {
  it('urgent payment plans never have one', () => {
    expect(occ('urgent', sched({}), '2026-09-13')).toBeNull()
    // even if stray fields somehow arrived
    expect(occ('urgent', sched({ weekday: 3 }), '2026-09-13')).toBeNull()
  })

  it('an incomplete schedule is skipped rather than guessed', () => {
    expect(occ('weekly', sched({}), '2026-09-13')).toBeNull()
    expect(occ('monthly', sched({}), '2026-09-13')).toBeNull()
    expect(occ('quarterly', sched({ dayOfMonth: 10 }), '2026-09-13')).toBeNull()
    expect(occ('annually', sched({ anchorMonth: 4 }), '2026-09-13')).toBeNull()
    // fields that belong to another frequency don't make it complete either
    expect(occ('weekly', sched({ dayOfMonth: 4 }), '2026-09-13')).toBeNull()
  })
})

// ── daylight saving moves nothing ───────────────────────────────────────────

describe('daylight saving', () => {
  // 2026: Pacific springs forward Sun Mar 8, falls back Sun Nov 1.
  it('the spring-forward week still has seven days, one per weekday', () => {
    const week = '2026-03-08'
    expect(weekEndSaturday(week)).toBe('2026-03-14')
    const dates = [0, 1, 2, 3, 4, 5, 6].map((wd) => occ('weekly', sched({ weekday: wd }), week)!.date)
    expect(dates).toEqual(['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14'])
    expect(new Set(dates).size).toBe(7)
  })

  it('the fall-back week is unaffected too', () => {
    const week = '2026-11-01'
    const dates = [0, 1, 2, 3, 4, 5, 6].map((wd) => occ('weekly', sched({ weekday: wd }), week)!.date)
    expect(dates).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'])
  })

  it('a monthly occurrence on a transition day is that day, not the one before', () => {
    expect(occ('monthly', sched({ dayOfMonth: 8 }), '2026-03-08')?.date).toBe('2026-03-08')
    expect(occ('monthly', sched({ dayOfMonth: 1 }), '2026-11-01')?.date).toBe('2026-11-01')
  })

  it('every day of a whole year round-trips through the week helpers', () => {
    let d = '2026-01-01'
    while (d <= '2026-12-31') {
      const o = occ('weekly', sched({ weekday: dayOfWeek(d) }), d)
      expect(o?.date, d).toBe(d)
      d = addDays(d, 1)
    }
  })
})

// ── windows ─────────────────────────────────────────────────────────────────

describe('windows', () => {
  const w = { start: '2026-09-01', end: '2026-09-30' }

  it('inWindow is inclusive at both ends', () => {
    expect(inWindow('2026-09-01', w)).toBe(true)
    expect(inWindow('2026-09-30', w)).toBe(true)
    expect(inWindow('2026-08-31', w)).toBe(false)
    expect(inWindow('2026-10-01', w)).toBe(false)
  })

  it('a week counts when it overlaps the window at all', () => {
    expect(weekOverlapsWindow('2026-08-30', w)).toBe(true) // Aug 30 – Sep 5
    expect(weekOverlapsWindow('2026-09-27', w)).toBe(true) // Sep 27 – Oct 3
    expect(weekOverlapsWindow('2026-08-23', w)).toBe(false) // Aug 23 – 29
    expect(weekOverlapsWindow('2026-10-04', w)).toBe(false) // Oct 4 – 10
  })

  it('any day of a week resolves to that week', () => {
    expect(weekOverlapsWindow('2026-09-05', w)).toBe(true) // the Saturday of Aug 30 – Sep 5
  })
})

// ── computeDue ──────────────────────────────────────────────────────────────

const V = {
  WEEKLY: 'v-weekly',
  MONTHLY: 'v-monthly',
  QUARTERLY: 'v-quarterly',
  ANNUAL: 'v-annual',
  URGENT: 'v-urgent',
  HELD: 'v-held',
  INACTIVE: 'v-inactive',
  NOSCHED: 'v-nosched',
}

const vendors: CmrDueVendorInput[] = [
  { id: V.WEEKLY, section: 'weekly', schedule: sched({ weekday: 4 }), active: true, onHold: false },
  { id: V.MONTHLY, section: 'monthly', schedule: sched({ dayOfMonth: 15 }), active: true, onHold: false },
  { id: V.QUARTERLY, section: 'quarterly', schedule: sched({ dayOfMonth: 10, anchorMonth: 9 }), active: true, onHold: false },
  { id: V.ANNUAL, section: 'annually', schedule: sched({ dayOfMonth: 1, anchorMonth: 9 }), active: true, onHold: false },
  { id: V.URGENT, section: 'urgent', schedule: sched({}), active: true, onHold: false },
  { id: V.HELD, section: 'weekly', schedule: sched({ weekday: 1 }), active: true, onHold: true },
  { id: V.INACTIVE, section: 'weekly', schedule: sched({ weekday: 1 }), active: false, onHold: false },
  { id: V.NOSCHED, section: 'monthly', schedule: sched({}), active: true, onHold: false },
]

const WEEK = '2026-09-13' // Sun 2026-09-13 … Sat 2026-09-19
const state = (rows: ReturnType<typeof computeDue>, id: string) => rows.find((r) => r.vendorId === id)

describe('computeDue', () => {
  it('surfaces every frequency whose occurrence has arrived', () => {
    const out = computeDue(vendors, WEEK, [])
    expect(state(out, V.WEEKLY)).toMatchObject({ state: 'due', occurrence: { date: '2026-09-17' } })
    expect(state(out, V.MONTHLY)).toMatchObject({ state: 'due', occurrence: { date: '2026-09-15' } })
    expect(state(out, V.QUARTERLY)).toMatchObject({ state: 'due', occurrence: { date: '2026-09-10' } })
    expect(state(out, V.ANNUAL)).toMatchObject({ state: 'due', occurrence: { date: '2026-09-01' } })
  })

  it('leaves out urgent, on-hold, inactive and unscheduled vendors', () => {
    const out = computeDue(vendors, WEEK, [])
    for (const id of [V.URGENT, V.HELD, V.INACTIVE, V.NOSCHED]) {
      expect(state(out, id), id).toMatchObject({ state: 'unscheduled', occurrence: null })
    }
    expect(out.filter((r) => r.state === 'due').map((r) => r.vendorId).sort()).toEqual(
      [V.ANNUAL, V.MONTHLY, V.QUARTERLY, V.WEEKLY].sort(),
    )
  })

  it('says not-yet for an occurrence that has not arrived in the viewed week', () => {
    // A monthly vendor on the 28th, viewed in the week of the 13th.
    const out = computeDue(
      [{ id: 'x', section: 'monthly', schedule: sched({ dayOfMonth: 28 }), active: true, onHold: false }],
      WEEK,
      [],
    )
    expect(out[0]).toMatchObject({ state: 'not-yet', occurrence: { date: '2026-09-28' } })
  })

  it('keeps a missed monthly occurrence due in every later week of the same month', () => {
    const v = [{ id: 'x', section: 'monthly' as const, schedule: sched({ dayOfMonth: 3 }), active: true, onHold: false }]
    for (const week of ['2026-09-06', '2026-09-13', '2026-09-20']) {
      expect(computeDue(v, week, [])[0], week).toMatchObject({ state: 'due', occurrence: { date: '2026-09-03' } })
    }
    // Sun 2026-09-27 … Sat 2026-10-03 has moved on: October's occurrence has arrived inside the
    // week, so the week is about October's payment, not September's.
    expect(computeDue(v, '2026-09-27', [])[0]).toMatchObject({ state: 'due', occurrence: { date: '2026-10-03' } })
  })

  it('a pending item inside the window handles the occurrence', () => {
    const handled: CmrHandledRow[] = [{ vendorId: V.MONTHLY, date: '2026-09-02', kind: 'pending' }]
    const out = computeDue(vendors, WEEK, handled)
    expect(state(out, V.MONTHLY)).toMatchObject({ state: 'handled', handledBy: 'pending' })
  })

  it('a pending item outside the window does not', () => {
    // August, for a September occurrence.
    const out = computeDue(vendors, WEEK, [{ vendorId: V.MONTHLY, date: '2026-08-15', kind: 'pending' }])
    expect(state(out, V.MONTHLY)).toMatchObject({ state: 'due', handledBy: null })
  })

  it('a priority whose week overlaps the window handles it', () => {
    const out = computeDue(vendors, WEEK, [{ vendorId: V.WEEKLY, date: WEEK, kind: 'priority' }])
    expect(state(out, V.WEEKLY)).toMatchObject({ state: 'handled', handledBy: 'priority' })
  })

  it('a priority in another week does not handle a weekly occurrence', () => {
    const out = computeDue(vendors, WEEK, [{ vendorId: V.WEEKLY, date: '2026-09-06', kind: 'priority' }])
    expect(state(out, V.WEEKLY)).toMatchObject({ state: 'due' })
  })

  it('a priority anywhere in the month handles a monthly occurrence', () => {
    for (const week of ['2026-08-30', '2026-09-06', '2026-09-27']) {
      const out = computeDue(vendors, WEEK, [{ vendorId: V.MONTHLY, date: week, kind: 'priority' }])
      expect(state(out, V.MONTHLY), week).toMatchObject({ state: 'handled', handledBy: 'priority' })
    }
    // …but not one whose week misses September entirely.
    const out = computeDue(vendors, WEEK, [{ vendorId: V.MONTHLY, date: '2026-08-23', kind: 'priority' }])
    expect(state(out, V.MONTHLY)).toMatchObject({ state: 'due' })
  })

  it('handling one vendor never handles another', () => {
    const out = computeDue(vendors, WEEK, [{ vendorId: V.MONTHLY, date: '2026-09-15', kind: 'pending' }])
    expect(state(out, V.WEEKLY)).toMatchObject({ state: 'due' })
    expect(state(out, V.QUARTERLY)).toMatchObject({ state: 'due' })
  })

  it('keeps the input order', () => {
    expect(computeDue(vendors, WEEK, []).map((r) => r.vendorId)).toEqual(vendors.map((v) => v.id))
  })
})

// ── the schedule in words ───────────────────────────────────────────────────

describe('describeSchedule', () => {
  it('reads as a person would say it', () => {
    expect(describeSchedule('weekly', sched({ weekday: 4 }))).toBe('Every Thursday')
    expect(describeSchedule('weekly', sched({ weekday: 0 }))).toBe('Every Sunday')
    expect(describeSchedule('monthly', sched({ dayOfMonth: 1 }))).toBe('The 1st of each month')
    expect(describeSchedule('monthly', sched({ dayOfMonth: 22 }))).toBe('The 22nd of each month')
    expect(describeSchedule('monthly', sched({ dayOfMonth: 13 }))).toBe('The 13th of each month')
    expect(describeSchedule('quarterly', sched({ dayOfMonth: 10, anchorMonth: 2 }))).toBe('The 10th of Feb, May, Aug, Nov')
    expect(describeSchedule('annually', sched({ dayOfMonth: 31, anchorMonth: 12 }))).toBe('The 31st of December each year')
  })

  it('says plainly when there is nothing to go on', () => {
    expect(describeSchedule('urgent', sched({}))).toBe('No fixed schedule')
    expect(describeSchedule('weekly', sched({}))).toBe('No schedule set')
    expect(describeSchedule('quarterly', sched({ dayOfMonth: 4 }))).toBe('No schedule set')
  })
})
