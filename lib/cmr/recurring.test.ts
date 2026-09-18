import { describe, it, expect } from 'vitest'
import {
  CMR_MAX_CENTS,
  compareVendors,
  formatCents,
  formatPlanDate,
  isCmrRecurringSection,
  parseCents,
  parseOptionalText,
  parsePlanDueDate,
  parseSection,
  parseVendorName,
  sectionTotalCents,
  toCmrRecurringVendor,
  type CmrRecurringVendorRow,
} from './recurring'

describe('recurring vendor helpers', () => {
  it('sections: only weekly / monthly / urgent', () => {
    for (const s of ['weekly', 'monthly', 'urgent']) expect(isCmrRecurringSection(s)).toBe(true)
    for (const s of ['Weekly', 'daily', '', null, 1]) expect(isCmrRecurringSection(s)).toBe(false)
    expect(parseSection('urgent')).toEqual({ ok: true, value: 'urgent' })
    expect(parseSection('yearly').ok).toBe(false)
  })

  it('vendor names are squashed and 1..80 chars', () => {
    expect(parseVendorName('  Fuel   card ')).toEqual({ ok: true, value: 'Fuel card' })
    expect(parseVendorName('a'.repeat(80)).ok).toBe(true)
    expect(parseVendorName('a'.repeat(81)).ok).toBe(false)
    expect(parseVendorName('   ').ok).toBe(false)
    expect(parseVendorName(undefined).ok).toBe(false)
  })

  it('cents: whole, non-negative, bounded numbers only — never re-rounded', () => {
    expect(parseCents(0, 'Amount')).toEqual({ ok: true, value: 0 })
    expect(parseCents(123456, 'Amount')).toEqual({ ok: true, value: 123456 })
    expect(parseCents(CMR_MAX_CENTS, 'Amount')).toEqual({ ok: true, value: CMR_MAX_CENTS })
    for (const bad of [-1, 1.5, 0.1, '100', NaN, Infinity, CMR_MAX_CENTS + 1, true, undefined, null]) {
      expect(parseCents(bad, 'Amount').ok, String(bad)).toBe(false)
    }
    expect(parseCents(null, 'Last amount sent', { nullable: true })).toEqual({ ok: true, value: null })
    expect(parseCents(undefined, 'Last amount sent', { nullable: true }).ok).toBe(false)
    const neg = parseCents(-5, 'Amount')
    expect(!neg.ok && neg.error).toBe("Amount can't be negative.")
  })

  it('dollars ↔ cents: display divides once and groups thousands', () => {
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(123456789)).toBe('$1,234,567.89')
    expect(formatCents(CMR_MAX_CENTS)).toBe('$999,999,999.99')
  })

  it('optional text: blank → null; notes keep line breaks', () => {
    expect(parseOptionalText(undefined, 'X', 10)).toEqual({ ok: true, value: null })
    expect(parseOptionalText('   ', 'X', 10)).toEqual({ ok: true, value: null })
    expect(parseOptionalText(' a   b ', 'X', 10)).toEqual({ ok: true, value: 'a b' })
    expect(parseOptionalText('a\r\n\r\n  b  ', 'Notes', 50, { multiline: true })).toEqual({ ok: true, value: 'a\n\n b' })
    expect(parseOptionalText('abcdefghijk', 'X', 10).ok).toBe(false)
    expect(parseOptionalText(5, 'X', 10).ok).toBe(false)
  })

  it('plan due dates must be real calendar dates', () => {
    expect(parsePlanDueDate('2026-12-31')).toEqual({ ok: true, value: '2026-12-31' })
    expect(parsePlanDueDate('2028-02-29').ok).toBe(true)
    expect(parsePlanDueDate('')).toEqual({ ok: true, value: null })
    expect(parsePlanDueDate(null)).toEqual({ ok: true, value: null })
    for (const bad of ['2026-02-29', '2026-04-31', '2026-00-10', '26-01-01', '2026-1-1', '1999-01-01', 20260101]) {
      expect(parsePlanDueDate(bad).ok, String(bad)).toBe(false)
    }
    expect(formatPlanDate('2026-10-01')).toBe('Oct 1, 2026')
  })

  it('orders weekly → monthly → urgent, then sort order, then name', () => {
    const mk = (id: string, section: 'weekly' | 'monthly' | 'urgent', sortOrder: number, vendorName: string) => ({ id, section, sortOrder, vendorName })
    const list = [mk('1', 'urgent', 0, 'A'), mk('2', 'weekly', 1, 'B'), mk('3', 'monthly', 0, 'C'), mk('4', 'weekly', 1, 'a'), mk('5', 'weekly', 0, 'Z')]
    expect(list.sort(compareVendors).map((v) => v.id)).toEqual(['5', '4', '2', '3', '1'])
  })

  it('section totals count only active, not-on-hold vendors', () => {
    expect(sectionTotalCents([
      { amountCents: 100, active: true, onHold: false },
      { amountCents: 200, active: true, onHold: true },
      { amountCents: 400, active: false, onHold: false },
      { amountCents: 800, active: true, onHold: false },
    ])).toBe(900)
  })

  it('maps a row, joining the account name/state', () => {
    const row: CmrRecurringVendorRow = {
      id: 'v', account_id: 'a', vendor_name: 'Rent', amount_cents: 100, section: 'monthly',
      schedule_weekday: null, schedule_day_of_month: 15, schedule_anchor_month: null,
      last_amount_sent_cents: 90, plan_terms: null, plan_due_date: null, notes: null, on_hold: true, active: true,
      sort_order: 2, created_by: null, created_at: 'now',
    }
    const accounts = new Map([['a', { id: 'a', name: 'TCS', active: false, sortOrder: 0 }]])
    expect(toCmrRecurringVendor(row, accounts)).toMatchObject({
      accountName: 'TCS', accountActive: false, amountCents: 100, lastAmountSentCents: 90, onHold: true,
      schedule: { weekday: null, dayOfMonth: 15, anchorMonth: null }, scheduleComplete: true,
    })
    expect(toCmrRecurringVendor(row, new Map())).toMatchObject({ accountName: 'Unknown account', accountActive: false })
  })
})
