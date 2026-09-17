import { describe, it, expect } from 'vitest'
import {
  computePriorityTotals,
  initialsOf,
  parseDescription,
  parseDueDate,
  parsePriorityAmount,
  parsePriorityNotes,
  parseWeek,
  parseWritableStatus,
  statusPatch,
  toCmrPriority,
  type CmrPriorityRow,
  type CmrPriorityStatus,
} from './priorities'

const p = (amountCents: number, status: CmrPriorityStatus, isTopPriority = false) => ({ amountCents, status, isTopPriority })

describe('computePriorityTotals', () => {
  it('needed = Σ open; paid/resolved = Σ paid + resolved; total = Σ all — zero-amount tasks add nothing', () => {
    const t = computePriorityTotals([
      p(6_450_000, 'open', true), // CDTFA
      p(3_200_000, 'open'), // loan
      p(0, 'open', true), // a task with no dollar figure
      p(1_000_000, 'paid'),
      p(250_000, 'resolved', true),
      p(0, 'resolved'),
    ])
    expect(t).toEqual({
      neededCents: 9_650_000,
      paidResolvedCents: 1_250_000,
      totalCents: 10_900_000,
      count: 6,
      openCount: 3,
      topPriorityCount: 3,
      openTopPriorityCount: 2,
    })
  })

  it('an empty week is all zeros', () => {
    expect(computePriorityTotals([])).toEqual({
      neededCents: 0, paidResolvedCents: 0, totalCents: 0, count: 0, openCount: 0, topPriorityCount: 0, openTopPriorityCount: 0,
    })
  })

  it('a week of only zero-amount tasks totals $0 but still counts them', () => {
    const t = computePriorityTotals([p(0, 'open'), p(0, 'open', true), p(0, 'paid')])
    expect(t.neededCents + t.paidResolvedCents + t.totalCents).toBe(0)
    expect(t.openCount).toBe(2)
    expect(t.topPriorityCount).toBe(1)
  })

  it('paying or resolving moves the amount out of needed (needed + done = total without carried rows)', () => {
    const open = computePriorityTotals([p(500, 'open'), p(700, 'open')])
    const paid = computePriorityTotals([p(500, 'paid'), p(700, 'open')])
    expect(open.neededCents).toBe(1200)
    expect(paid.neededCents).toBe(700)
    expect(paid.paidResolvedCents).toBe(500)
    expect(paid.neededCents + paid.paidResolvedCents).toBe(paid.totalCents)
  })

  it('a carried row (Phase 6) is in the total only', () => {
    const t = computePriorityTotals([p(900, 'carried', true), p(100, 'open')])
    expect(t).toMatchObject({ neededCents: 100, paidResolvedCents: 0, totalCents: 1000, openCount: 1, openTopPriorityCount: 0, topPriorityCount: 1 })
  })
})

describe('statusPatch', () => {
  const NOW = '2026-09-16T16:02:00.000Z'
  const unpaid = { status: 'open' as const, paid_at: null, paid_by: null }
  it('→ paid stamps now + the actor', () => {
    expect(statusPatch(unpaid, 'paid', 'u1', NOW)).toEqual({ status: 'paid', paid_at: NOW, paid_by: 'u1' })
    expect(statusPatch({ ...unpaid, status: 'resolved' }, 'paid', 'u1', NOW)).toEqual({ status: 'paid', paid_at: NOW, paid_by: 'u1' })
  })
  it('paid → paid keeps the original stamp', () => {
    const was = { status: 'paid' as const, paid_at: '2026-09-15T10:00:00Z', paid_by: 'u0' }
    expect(statusPatch(was, 'paid', 'u1', NOW)).toEqual({ status: 'paid', paid_at: '2026-09-15T10:00:00Z', paid_by: 'u0' })
  })
  it('leaving paid clears the stamp', () => {
    const was = { status: 'paid' as const, paid_at: '2026-09-15T10:00:00Z', paid_by: 'u0' }
    expect(statusPatch(was, 'open', 'u1', NOW)).toEqual({ status: 'open', paid_at: null, paid_by: null })
    expect(statusPatch(was, 'resolved', 'u1', NOW)).toEqual({ status: 'resolved', paid_at: null, paid_by: null })
  })
})

describe('validation', () => {
  it('status: open/resolved/paid only; carried has its own code (use the carry route)', () => {
    for (const s of ['open', 'resolved', 'paid']) expect(parseWritableStatus(s)).toEqual({ ok: true, value: s })
    const c = parseWritableStatus('carried')
    expect(c.ok).toBe(false)
    expect(c.code).toBe('USE_CARRY')
    for (const s of ['pushed', 'OPEN', '', null, undefined, 1]) expect(parseWritableStatus(s).ok).toBe(false)
  })

  it('amount is optional: missing / null → 0; otherwise whole cents 0…$999,999,999.99', () => {
    expect(parsePriorityAmount(undefined)).toEqual({ ok: true, value: 0 })
    expect(parsePriorityAmount(null)).toEqual({ ok: true, value: 0 })
    expect(parsePriorityAmount(0)).toEqual({ ok: true, value: 0 })
    expect(parsePriorityAmount(6_450_000)).toEqual({ ok: true, value: 6_450_000 })
    expect(parsePriorityAmount(99_999_999_999)).toEqual({ ok: true, value: 99_999_999_999 })
    for (const bad of [-1, 12.5, '100', 100_000_000_000, Number.NaN, true]) expect(parsePriorityAmount(bad).ok).toBe(false)
  })

  it('description 1–120 (squashed); notes optional ≤500 keeping line breaks', () => {
    expect(parseDescription('  CDTFA   sales tax ')).toEqual({ ok: true, value: 'CDTFA sales tax' })
    expect(parseDescription('   ').ok).toBe(false)
    expect(parseDescription(undefined).ok).toBe(false)
    expect(parseDescription('x'.repeat(120)).ok).toBe(true)
    expect(parseDescription('x'.repeat(121)).ok).toBe(false)
    expect(parsePriorityNotes('  ')).toEqual({ ok: true, value: null })
    expect(parsePriorityNotes(undefined)).toEqual({ ok: true, value: null })
    expect(parsePriorityNotes('line 1\r\nline  2 ')).toEqual({ ok: true, value: 'line 1\nline 2' })
    expect(parsePriorityNotes('n'.repeat(501)).ok).toBe(false)
  })

  it('due date optional; must be a real date', () => {
    expect(parseDueDate(undefined)).toEqual({ ok: true, value: null })
    expect(parseDueDate('')).toEqual({ ok: true, value: null })
    expect(parseDueDate('2026-09-17')).toEqual({ ok: true, value: '2026-09-17' })
    for (const bad of ['2026-02-30', '09/17/2026', 20260917]) expect(parseDueDate(bad).ok).toBe(false)
  })

  it('week: any real date normalises to its Sunday', () => {
    expect(parseWeek('2026-09-16')).toEqual({ ok: true, value: '2026-09-13' })
    expect(parseWeek('2026-09-13')).toEqual({ ok: true, value: '2026-09-13' })
    expect(parseWeek('2026-09-19')).toEqual({ ok: true, value: '2026-09-13' })
    for (const bad of ['2026-13-01', 'next week', null, undefined]) expect(parseWeek(bad).ok).toBe(false)
  })
})

describe('mapping + formatting', () => {
  it('toCmrPriority normalises cents and attaches the payer name', () => {
    const row: CmrPriorityRow = {
      id: 'x', week_start: '2026-09-13', description: 'Loan', amount_cents: '3200000' as unknown as number,
      due_date: null, notes: null, is_top_priority: false, status: 'paid', carried_from_id: null,
      paid_at: '2026-09-16T16:02:00Z', paid_by: 'u1', sort_order: 2, created_by: null, created_at: '2026-09-14T00:00:00Z',
    }
    const p = toCmrPriority(row, new Map([['u1', 'Mason Doty']]))
    expect(p).toMatchObject({ amountCents: 3_200_000, paidByName: 'Mason Doty', weekStart: '2026-09-13', sortOrder: 2 })
    expect(toCmrPriority({ ...row, paid_by: 'gone' }).paidByName).toBeNull()
  })

  it('initialsOf', () => {
    expect(initialsOf('Mason Doty')).toBe('MD')
    expect(initialsOf('cora')).toBe('C')
    expect(initialsOf('  Ada  B.  Lovelace ')).toBe('AL')
    expect(initialsOf(null)).toBe('')
  })
})
