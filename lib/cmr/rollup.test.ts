import { describe, it, expect } from 'vitest'
import {
  accountsInUse,
  dueThisWeek,
  dueTotalCents,
  inRecurringScope,
  matchesAccount,
  rollupCash,
  rollupRecurringTotals,
  type CmrRollupAccountRef,
  type CmrRollupDay,
  type CmrRollupSnapshot,
  type CmrRollupVendorState,
} from '@/lib/cmr/rollup'

/**
 * The rollup's arithmetic: the by-frequency totals, the account filter that narrows them, the
 * due list, and the opening/closing figures read off the week's saved snapshots.
 */

const ACC = { TCS: 'acc-tcs', STS: 'acc-sts', OLD: 'acc-old' }

const accounts: CmrRollupAccountRef[] = [
  { id: ACC.TCS, name: 'TCS', active: true, sortOrder: 0 },
  { id: ACC.STS, name: 'STS', active: true, sortOrder: 1 },
  { id: ACC.OLD, name: 'Old Payroll', active: false, sortOrder: 2 },
]

const v = (over: Partial<CmrRollupVendorState> & { vendorId: string }): CmrRollupVendorState => ({
  vendorName: over.vendorId,
  accountId: ACC.TCS,
  accountName: 'TCS',
  accountActive: true,
  section: 'weekly',
  scheduleText: 'Every Thursday',
  amountCents: 100_00,
  lastAmountSentCents: null,
  suggestedCents: 100_00,
  notes: null,
  active: true,
  onHold: false,
  scheduleComplete: true,
  state: 'due',
  occurrenceDate: '2026-09-17',
  handledBy: null,
  ...over,
})

const vendors: CmrRollupVendorState[] = [
  v({ vendorId: 'w-due', amountCents: 120_00, suggestedCents: 120_00 }),
  v({ vendorId: 'w-handled', amountCents: 50_00, suggestedCents: 50_00, state: 'handled', handledBy: 'pending' }),
  v({ vendorId: 'w-sts', accountId: ACC.STS, accountName: 'STS', amountCents: 30_00, suggestedCents: 30_00 }),
  v({
    vendorId: 'm-due', section: 'monthly', scheduleText: 'The 15th of each month',
    amountCents: 2500_00, lastAmountSentCents: 2499_99, suggestedCents: 2499_99, occurrenceDate: '2026-09-15',
  }),
  v({ vendorId: 'm-notyet', section: 'monthly', amountCents: 400_00, suggestedCents: 400_00, state: 'not-yet', occurrenceDate: '2026-09-28' }),
  v({ vendorId: 'q-due', section: 'quarterly', amountCents: 5000_00, suggestedCents: 5000_00, occurrenceDate: '2026-09-10', accountId: ACC.STS, accountName: 'STS' }),
  v({ vendorId: 'y-handled', section: 'annually', amountCents: 750_00, suggestedCents: 750_00, state: 'handled', handledBy: 'priority', occurrenceDate: '2026-09-01' }),
  // out of scope, whatever their state says
  v({ vendorId: 'x-hold', amountCents: 999_00, suggestedCents: 999_00, onHold: true, state: 'unscheduled', occurrenceDate: null }),
  v({ vendorId: 'x-inactive', amountCents: 888_00, suggestedCents: 888_00, active: false, state: 'unscheduled', occurrenceDate: null }),
  v({ vendorId: 'x-nosched', section: 'monthly', amountCents: 777_00, suggestedCents: 777_00, scheduleComplete: false, state: 'unscheduled', occurrenceDate: null }),
  v({ vendorId: 'x-urgent', section: 'urgent', amountCents: 666_00, suggestedCents: 666_00, scheduleComplete: true, state: 'unscheduled', occurrenceDate: null }),
  v({ vendorId: 'x-oldacct', accountId: ACC.OLD, accountName: 'Old Payroll', accountActive: false, amountCents: 11_00, suggestedCents: 11_00, active: false, state: 'unscheduled', occurrenceDate: null }),
]

const totalFor = (rows: ReturnType<typeof rollupRecurringTotals>, f: string) => rows.find((t) => t.frequency === f)!

describe('recurring scope', () => {
  it('leaves out urgent plans, held, inactive and unscheduled vendors', () => {
    expect(vendors.filter(inRecurringScope).map((x) => x.vendorId)).toEqual([
      'w-due', 'w-handled', 'w-sts', 'm-due', 'm-notyet', 'q-due', 'y-handled',
    ])
  })

  it('an account filter of null matches everything', () => {
    expect(vendors.every((x) => matchesAccount(x, null))).toBe(true)
    expect(matchesAccount(vendors[0], ACC.STS)).toBe(false)
    expect(matchesAccount(vendors[0], ACC.TCS)).toBe(true)
  })
})

describe('rollupRecurringTotals', () => {
  it('lists every frequency, even the empty ones', () => {
    const rows = rollupRecurringTotals([])
    expect(rows.map((t) => t.frequency)).toEqual(['weekly', 'monthly', 'quarterly', 'annually'])
    expect(rows.every((t) => t.vendorCount === 0 && t.totalCents === 0 && t.dueCents === 0)).toBe(true)
    expect(rows.map((t) => t.label)).toEqual(['Weekly', 'Monthly', 'Quarterly', 'Annually'])
  })

  it('sums a full cycle, and counts due vs handled with the amount that would be entered', () => {
    const rows = rollupRecurringTotals(vendors)
    const weekly = totalFor(rows, 'weekly')
    expect(weekly).toMatchObject({
      vendorCount: 3,
      totalCents: 120_00 + 50_00 + 30_00,
      dueCount: 2,
      dueCents: 120_00 + 30_00,
      handledCount: 1,
      handledCents: 50_00,
    })

    // 'not-yet' counts toward the cycle cost but is neither due nor handled.
    const monthly = totalFor(rows, 'monthly')
    expect(monthly).toMatchObject({
      vendorCount: 2,
      totalCents: 2500_00 + 400_00,
      dueCount: 1,
      // the LAST AMOUNT SENT, not the standing amount — that is what would be entered
      dueCents: 2499_99,
      handledCount: 0,
      handledCents: 0,
    })

    expect(totalFor(rows, 'quarterly')).toMatchObject({ vendorCount: 1, totalCents: 5000_00, dueCount: 1, dueCents: 5000_00 })
    expect(totalFor(rows, 'annually')).toMatchObject({ vendorCount: 1, totalCents: 750_00, dueCount: 0, handledCount: 1, handledCents: 750_00 })
  })

  it('the account filter narrows every figure', () => {
    const tcs = rollupRecurringTotals(vendors, ACC.TCS)
    expect(totalFor(tcs, 'weekly')).toMatchObject({ vendorCount: 2, totalCents: 170_00, dueCount: 1, dueCents: 120_00, handledCount: 1 })
    expect(totalFor(tcs, 'quarterly')).toMatchObject({ vendorCount: 0, totalCents: 0, dueCount: 0 })

    const sts = rollupRecurringTotals(vendors, ACC.STS)
    expect(totalFor(sts, 'weekly')).toMatchObject({ vendorCount: 1, totalCents: 30_00, dueCount: 1, dueCents: 30_00 })
    expect(totalFor(sts, 'quarterly')).toMatchObject({ vendorCount: 1, totalCents: 5000_00, dueCount: 1, dueCents: 5000_00 })
    expect(totalFor(sts, 'monthly')).toMatchObject({ vendorCount: 0 })

    // The filtered parts add back up to the whole.
    for (const f of ['weekly', 'monthly', 'quarterly', 'annually'] as const) {
      const all = totalFor(rollupRecurringTotals(vendors), f)
      const parts = accounts.map((a) => totalFor(rollupRecurringTotals(vendors, a.id), f))
      expect(parts.reduce((s, t) => s + t.totalCents, 0), f).toBe(all.totalCents)
      expect(parts.reduce((s, t) => s + t.dueCents, 0), f).toBe(all.dueCents)
      expect(parts.reduce((s, t) => s + t.vendorCount, 0), f).toBe(all.vendorCount)
    }
  })

  it('an unknown account id narrows to nothing rather than everything', () => {
    const rows = rollupRecurringTotals(vendors, 'not-an-account')
    expect(rows.every((t) => t.vendorCount === 0 && t.totalCents === 0)).toBe(true)
  })
})

describe('dueThisWeek', () => {
  it('lists only what is due, soonest first', () => {
    expect(dueThisWeek(vendors).map((x) => x.vendorId)).toEqual(['q-due', 'm-due', 'w-due', 'w-sts'])
  })

  it('breaks a tie by name', () => {
    const tied = [
      v({ vendorId: 'b', vendorName: 'Beta', occurrenceDate: '2026-09-15' }),
      v({ vendorId: 'a', vendorName: 'Alpha', occurrenceDate: '2026-09-15' }),
    ]
    expect(dueThisWeek(tied).map((x) => x.vendorName)).toEqual(['Alpha', 'Beta'])
  })

  it('respects the account filter, and totals what it lists', () => {
    expect(dueThisWeek(vendors, ACC.STS).map((x) => x.vendorId)).toEqual(['q-due', 'w-sts'])
    expect(dueTotalCents(vendors, ACC.STS)).toBe(5000_00 + 30_00)
    expect(dueTotalCents(vendors, ACC.TCS)).toBe(120_00 + 2499_99)
    expect(dueTotalCents(vendors)).toBe(dueTotalCents(vendors, ACC.TCS) + dueTotalCents(vendors, ACC.STS))
  })

  it('a held or inactive vendor never appears, even if its state said due', () => {
    const sneaky = [v({ vendorId: 'held', onHold: true, state: 'due' }), v({ vendorId: 'gone', active: false, state: 'due' })]
    // dueThisWeek trusts the engine's state, which never marks these due…
    expect(dueThisWeek(sneaky).map((x) => x.vendorId)).toEqual(['gone', 'held'])
    // …and the totals, which decide the money, exclude them regardless.
    expect(rollupRecurringTotals(sneaky).every((t) => t.vendorCount === 0)).toBe(true)
  })
})

describe('accountsInUse', () => {
  it('offers only the accounts that have an in-scope vendor, in account order', () => {
    expect(accountsInUse(vendors, accounts).map((a) => a.name)).toEqual(['TCS', 'STS'])
  })

  it('is empty when nothing is in scope', () => {
    expect(accountsInUse([v({ vendorId: 'x', onHold: true })], accounts)).toEqual([])
  })
})

describe('rollupCash', () => {
  const snap = (beginning: number, adjustments: number, pending: number, period: 'am' | 'pm'): CmrRollupSnapshot => ({
    period,
    beginningCashCents: beginning,
    adjustmentsTotalCents: adjustments,
    pendingRollupCents: pending,
    currentBalanceCents: beginning + adjustments - pending,
  })
  const days = (over: Partial<Record<string, Partial<CmrRollupDay>>> = {}): CmrRollupDay[] =>
    ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'].map((date) => ({
      date,
      am: null,
      pm: null,
      ...(over[date] ?? {}),
    }))

  it('reads the first and last SAVED snapshot, AM before PM', () => {
    const cash = rollupCash(
      days({
        '2026-09-14': { am: snap(1000_00, 0, 100_00, 'am'), pm: snap(900_00, 0, 0, 'pm') },
        '2026-09-17': { pm: snap(500_00, 25_00, 75_00, 'pm') },
      }),
    )
    expect(cash).toEqual({
      snapshotCount: 3,
      openingDate: '2026-09-14',
      openingPeriod: 'am',
      openingCents: 1000_00,
      closingDate: '2026-09-17',
      closingPeriod: 'pm',
      closingCents: 450_00,
    })
  })

  it('a single snapshot is both ends', () => {
    const cash = rollupCash(days({ '2026-09-16': { pm: snap(200_00, -50_00, 0, 'pm') } }))
    expect(cash).toMatchObject({
      snapshotCount: 1, openingDate: '2026-09-16', openingPeriod: 'pm', openingCents: 200_00, closingCents: 150_00,
    })
  })

  it('an empty week reports no snapshots rather than a zero balance', () => {
    expect(rollupCash(days())).toEqual({
      snapshotCount: 0,
      openingDate: null,
      openingPeriod: null,
      openingCents: 0,
      closingDate: null,
      closingPeriod: null,
      closingCents: 0,
    })
  })

  it('carries a negative closing balance through', () => {
    const cash = rollupCash(days({ '2026-09-19': { am: snap(100_00, 0, 450_00, 'am') } }))
    expect(cash.closingCents).toBe(-350_00)
  })
})
