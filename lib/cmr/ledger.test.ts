import { describe, it, expect } from 'vitest'
import {
  CMR_PENDING_COLS,
  compareOrdered,
  computeLedgerTotals,
  formatBalanceCents,
  formatLedgerDate,
  formatSignedCents,
  groupPendingByAccount,
  parseLedgerCents,
  parseLedgerDate,
  parseOptionalText,
  parsePeriod,
  parseRequiredText,
  shiftLedgerDate,
  type CmrLedgerAccountRef,
  type CmrPendingItem,
} from './ledger'

/**
 * Daily-ledger math and validation (shared by the API and the screen).
 *   current balance = beginning + Σ signed adjustments − Σ pending
 */

const accounts: CmrLedgerAccountRef[] = [
  { id: 'inc', name: 'INC', accountType: 'Payroll', active: true, sortOrder: 3 },
  { id: 'tcs', name: 'TCS', accountType: 'Checking', active: true, sortOrder: 0 },
  { id: 'old', name: 'Old', accountType: null, active: false, sortOrder: 9 },
]

const item = (id: string, accountId: string, amountCents: number, sortOrder = 0, over: Partial<CmrPendingItem> = {}): CmrPendingItem => ({
  id,
  accountId,
  accountName: accountId.toUpperCase(),
  accountActive: true,
  payee: `Payee ${id}`,
  amountCents,
  status: 'pending',
  source: 'manual',
  notes: null,
  originalDate: null,
  effectiveDate: null,
  paidAt: null,
  paidBy: null,
  paidByName: null,
  pushedFromId: null,
  pushedFrom: null,
  pushedTo: null,
  canUnpush: false,
  unpushBlockedReason: null,
  sortOrder,
  createdAt: '2026-09-16T10:00:00Z',
  ...over,
})

describe('computeLedgerTotals', () => {
  it('beginning + Σ signed adjustments − Σ pending (the mockup day)', () => {
    const t = computeLedgerTotals(
      48_230_000,
      [{ amountCents: 3_800_000 }, { amountCents: 5_240_000 }, { amountCents: -2_200_000 }],
      [
        { amountCents: 21_000_000, status: 'pending' },
        { amountCents: 10_200_000, status: 'pending' },
        { amountCents: 17_752_000, status: 'pending' },
      ],
    )
    expect(t).toEqual({
      beginningCashCents: 48_230_000,
      adjustmentsTotalCents: 6_840_000,
      pendingRollupCents: 48_952_000,
      currentBalanceCents: 48_230_000 + 6_840_000 - 48_952_000,
    })
    expect(t.currentBalanceCents).toBe(6_118_000) // $61,180.00
  })

  it('negative adjustments and a negative (short) balance', () => {
    const t = computeLedgerTotals(10_000, [{ amountCents: -2_500 }, { amountCents: -2_500 }], [{ amountCents: 7_501, status: 'pending' }])
    expect(t.adjustmentsTotalCents).toBe(-5_000)
    expect(t.pendingRollupCents).toBe(7_501)
    expect(t.currentBalanceCents).toBe(-2_501)
  })

  it('negative beginning cash; empty ledger is all zeros', () => {
    expect(computeLedgerTotals(-100, [], []).currentBalanceCents).toBe(-100)
    expect(computeLedgerTotals(0, [], [])).toEqual({ beginningCashCents: 0, adjustmentsTotalCents: 0, pendingRollupCents: 0, currentBalanceCents: 0 })
  })

  it('pending items always SUBTRACT; a pushed item (moved to another day) does not count', () => {
    const t = computeLedgerTotals(1_000, [], [
      { amountCents: 300, status: 'pending' },
      { amountCents: 200, status: 'paid' },
      { amountCents: 999, status: 'pushed' },
    ])
    expect(t.pendingRollupCents).toBe(500)
    expect(t.currentBalanceCents).toBe(500)
  })

  it('stays exact in integer cents (no float drift)', () => {
    const adj = Array.from({ length: 10 }, () => ({ amountCents: 10 })) // 10 × $0.10
    expect(computeLedgerTotals(0, adj, [{ amountCents: 1, status: 'pending' }]).currentBalanceCents).toBe(99)
  })
})

describe('groupPendingByAccount', () => {
  const items = [
    item('a', 'inc', 17_752_000),
    item('b', 'tcs', 10_200_000, 1),
    item('c', 'tcs', 21_000_000, 0),
    item('d', 'tcs', 5, 2, { status: 'pushed' }),
  ]

  it('groups by account in account order, items in sort order, with subtotals', () => {
    const g = groupPendingByAccount(items, accounts)
    expect(g.map((x) => x.accountName)).toEqual(['TCS', 'INC'])
    expect(g[0].items.map((i) => i.id)).toEqual(['c', 'b', 'd'])
    expect(g[0].subtotalCents).toBe(31_200_000) // pushed item excluded
    expect(g[0].accountType).toBe('Checking')
    expect(g[1].subtotalCents).toBe(17_752_000)
  })

  it('subtotals add up to the roll-up', () => {
    const g = groupPendingByAccount(items, accounts)
    const sum = g.reduce((s, x) => s + x.subtotalCents, 0)
    expect(sum).toBe(computeLedgerTotals(0, [], items).pendingRollupCents)
  })

  it('only accounts with items appear; an inactive or unknown account still groups', () => {
    const g = groupPendingByAccount([item('x', 'old', 1), item('y', 'ghost', 2)], accounts)
    expect(g.map((x) => [x.accountName, x.accountActive])).toEqual([['Old', false], ['GHOST', false]])
    expect(groupPendingByAccount([], accounts)).toEqual([])
  })
})

describe('ordering + formatting', () => {
  it('compareOrdered: sort_order, then created_at, then id', () => {
    const rows = [
      { id: 'b', sortOrder: 1, createdAt: '2026-01-01' },
      { id: 'c', sortOrder: 0, createdAt: '2026-01-02' },
      { id: 'a', sortOrder: 0, createdAt: '2026-01-02' },
      { id: 'd', sortOrder: 0, createdAt: '2026-01-01' },
    ]
    expect([...rows].sort(compareOrdered).map((r) => r.id)).toEqual(['d', 'a', 'c', 'b'])
  })

  it('formatSignedCents uses + / true minus and $0.00 for zero', () => {
    expect(formatSignedCents(3_800_000)).toBe('+$38,000.00')
    expect(formatSignedCents(-2_200_000)).toBe('−$22,000.00')
    expect(formatSignedCents(0)).toBe('$0.00')
    expect(formatSignedCents(-1)).toBe('−$0.01')
    expect(formatBalanceCents(-125_050)).toBe('−$1,250.50')
    expect(formatBalanceCents(878_000)).toBe('$8,780.00')
    expect(formatBalanceCents(0)).toBe('$0.00')
  })

  it('dates: shift across month/year/leap day, format without a timezone shift', () => {
    expect(shiftLedgerDate('2026-09-30', 1)).toBe('2026-10-01')
    expect(shiftLedgerDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftLedgerDate('2028-02-28', 1)).toBe('2028-02-29')
    expect(formatLedgerDate('2026-09-16')).toBe('Wed, Sep 16, 2026')
  })
})

describe('column names', () => {
  it('pending items use effective_date (never the reserved word current_date)', () => {
    const cols = CMR_PENDING_COLS.split(',').map((c) => c.trim())
    expect(cols).toContain('original_date')
    expect(cols).toContain('effective_date')
    expect(cols).not.toContain('current_date')
  })
})

describe('validation', () => {
  it('dates must be real YYYY-MM-DD between 2000 and 2100', () => {
    expect(parseLedgerDate('2026-09-16')).toEqual({ ok: true, value: '2026-09-16' })
    for (const bad of ['2026-02-30', '2026-9-16', '16/09/2026', '1999-12-31', '2101-01-01', '', null, 20260916, '2026-09-16T00:00']) {
      expect(parseLedgerDate(bad).ok).toBe(false)
    }
  })

  it('period is am | pm only', () => {
    expect(parsePeriod('am').ok).toBe(true)
    expect(parsePeriod('pm').ok).toBe(true)
    for (const bad of ['AM', 'noon', '', null, undefined]) expect(parsePeriod(bad).ok).toBe(false)
  })

  it('cents: whole numbers only; signed allows negatives; pending must be ≥ 0; bounded', () => {
    expect(parseLedgerCents(-500, 'A', { signed: true })).toEqual({ ok: true, value: -500 })
    expect(parseLedgerCents(-500, 'A', { signed: false }).ok).toBe(false)
    expect(parseLedgerCents(0, 'A', { signed: false })).toEqual({ ok: true, value: 0 })
    expect(parseLedgerCents(99_999_999_999, 'A', { signed: false }).ok).toBe(true)
    expect(parseLedgerCents(100_000_000_000, 'A', { signed: false }).ok).toBe(false)
    expect(parseLedgerCents(-100_000_000_000, 'A', { signed: true }).ok).toBe(false)
    for (const bad of [1.5, '100', null, undefined, NaN, Infinity]) expect(parseLedgerCents(bad, 'A', { signed: true }).ok).toBe(false)
  })

  it('text: required is squashed and bounded; optional blank → null', () => {
    expect(parseRequiredText('  Payroll   hold ', 'Description', 120)).toEqual({ ok: true, value: 'Payroll hold' })
    expect(parseRequiredText('   ', 'Description', 120).ok).toBe(false)
    expect(parseRequiredText('x'.repeat(121), 'Description', 120).ok).toBe(false)
    expect(parseOptionalText('  ', 'Note', 10)).toEqual({ ok: true, value: null })
    expect(parseOptionalText(undefined, 'Note', 10)).toEqual({ ok: true, value: null })
    expect(parseOptionalText('a\r\n  b  ', 'Note', 10, { multiline: true })).toEqual({ ok: true, value: 'a\n b' })
    expect(parseOptionalText(5, 'Note', 10).ok).toBe(false)
  })
})
