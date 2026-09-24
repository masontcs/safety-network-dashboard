import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { summarizeWhAging, filterWhRows, whLocations, type WhAgingRow } from './summary'
import { parseWhArFile } from './ar-import'
import { parseWhApFile } from './ap-import'

function row(p: Partial<WhAgingRow> & { id: string; counterpartyName: string; openBalanceCents: number }): WhAgingRow {
  return {
    txnDate: null, txnType: 'Invoice', num: null, counterpartyCode: null, location: null,
    dueDate: null, pastDueDays: null, agingBucket: 'Current', open: true, isIntercompany: false,
    ...p,
  }
}

describe('summarizeWhAging', () => {
  const rows: WhAgingRow[] = [
    row({ id: '1', counterpartyName: 'Safety Network Holdings', openBalanceCents: 100_00, agingBucket: '>90', isIntercompany: true, location: 'Western Highways' }),
    row({ id: '2', counterpartyName: 'Safety Network Holdings', openBalanceCents: 50_00, agingBucket: 'Current', isIntercompany: true, location: 'Western Highways' }),
    row({ id: '3', counterpartyName: 'Outside Co', openBalanceCents: 200_00, agingBucket: '31-60', location: 'Western Highways Service Center' }),
    row({ id: '4', counterpartyName: 'Outside Co', openBalanceCents: -20_00, agingBucket: 'Current', txnType: 'Credit Memo', location: 'Western Highways Service Center' }),
    row({ id: '5', counterpartyName: 'Odd Item', openBalanceCents: 5_00, agingBucket: 'Current', open: false, txnType: 'Check' }),
  ]

  it('totals the buckets and the grand total', () => {
    const s = summarizeWhAging(rows)
    expect(s.bucketTotals).toEqual({ 'Current': 3500, '1-30': 0, '31-60': 20000, '61-90': 0, '>90': 10000 })
    expect(s.totalCents).toBe(33500)
    expect(Object.values(s.bucketTotals).reduce((a, b) => a + b, 0)).toBe(s.totalCents)
  })

  it('splits outside from intercompany', () => {
    const s = summarizeWhAging(rows)
    expect(s.intercompanyCents).toBe(15000)
    expect(s.outsideCents).toBe(18500)
    expect(s.intercompanyCents + s.outsideCents).toBe(s.totalCents)
  })

  it('groups by counterparty, biggest first, with per-bucket splits', () => {
    const s = summarizeWhAging(rows)
    expect(s.counterparties.map((c) => c.name)).toEqual(['Outside Co', 'Safety Network Holdings', 'Odd Item'])

    const outside = s.counterparties[0]
    expect(outside.totalCents).toBe(18000)
    expect(outside.lineCount).toBe(2)
    expect(outside.buckets['31-60']).toBe(20000)
    expect(outside.buckets['Current']).toBe(-2000)
    expect(outside.isIntercompany).toBe(false)
  })

  it('ranks by absolute amount so a net-credit counterparty is not buried', () => {
    const s = summarizeWhAging([
      row({ id: 'a', counterpartyName: 'Small', openBalanceCents: 10_00 }),
      row({ id: 'b', counterpartyName: 'Big Credit', openBalanceCents: -900_00 }),
    ])
    expect(s.counterparties[0].name).toBe('Big Credit')
  })

  it('filters by location, party and open-only', () => {
    expect(summarizeWhAging(rows, { location: 'Western Highways' }).rowCount).toBe(2)
    expect(summarizeWhAging(rows, { party: 'outside' }).totalCents).toBe(18500)
    expect(summarizeWhAging(rows, { party: 'internal' }).totalCents).toBe(15000)

    const openOnly = summarizeWhAging(rows, { openOnly: true })
    expect(openOnly.rowCount).toBe(4)
    expect(openOnly.totalCents).toBe(33000)
  })

  it('searches the counterparty name case-insensitively', () => {
    expect(filterWhRows(rows, { search: 'safety' })).toHaveLength(2)
    expect(filterWhRows(rows, { search: 'OUTSIDE' })).toHaveLength(2)
    expect(filterWhRows(rows, { search: 'nope' })).toHaveLength(0)
  })

  it('lists the locations present, blanks dropped', () => {
    expect(whLocations(rows)).toEqual(['Western Highways', 'Western Highways Service Center'])
  })

  it('handles an empty snapshot without dividing by anything', () => {
    const s = summarizeWhAging([])
    expect(s.totalCents).toBe(0)
    expect(s.rowCount).toBe(0)
    expect(s.counterparties).toEqual([])
    expect(s.bucketTotals).toEqual({ 'Current': 0, '1-30': 0, '31-60': 0, '61-90': 0, '>90': 0 })
  })
})

// ── Against the real snapshots ────────────────────────────────────────────────

const AR_FIXTURE = join(process.cwd(), 'Western Highways Traffic Truck Products_A_R Aging Detail Report.csv')
const AP_FIXTURE = join(process.cwd(), 'Western Highways Traffic Truck Products_A_P Aging Detail Report.xlsx')
const hasFixtures = existsSync(AR_FIXTURE) && existsSync(AP_FIXTURE)
const describeFixture = hasFixtures ? describe : describe.skip

describeFixture('summarizeWhAging — the real WH snapshots', () => {
  it('reproduces the A/R report total and keeps the split honest', () => {
    const parsed = parseWhArFile(readFileSync(AR_FIXTURE))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const rows: WhAgingRow[] = parsed.data.lines.map((l, i) => ({
      id: String(i), txnDate: l.txnDate, txnType: l.txnType, num: l.num,
      counterpartyName: l.customerName, counterpartyCode: l.customerCode, location: l.location,
      dueDate: l.dueDate, pastDueDays: null, agingBucket: l.agingBucket,
      openBalanceCents: l.openBalanceCents, open: l.receivable, isIntercompany: l.isIntercompany,
    }))

    const s = summarizeWhAging(rows)
    expect(s.totalCents).toBe(67876826)
    expect(s.rowCount).toBe(213)
    expect(s.outsideCents + s.intercompanyCents).toBe(67876826)
    expect(Object.values(s.bucketTotals).reduce((a, b) => a + b, 0)).toBe(67876826)

    // Worth pinning, because it cuts against the assumption: WH's A/R is overwhelmingly
    // intercompany BY LINE COUNT (182 of 213 lines) but NOT by money — outside customers are
    // the larger share of the dollars. This is exactly why the views show the split rather
    // than a single "total owed to WH" figure.
    expect(s.intercompanyCents).toBe(27808440)
    expect(s.outsideCents).toBe(40068386)
    expect(rows.filter((r) => r.isIntercompany)).toHaveLength(182)

    expect(whLocations(rows)).toEqual(['Western Highways', 'Western Highways Service Center'])
  })

  it('reproduces the A/P report and payable totals', () => {
    const parsed = parseWhApFile(readFileSync(AP_FIXTURE))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const rows: WhAgingRow[] = parsed.data.lines.map((l, i) => ({
      id: String(i), txnDate: l.txnDate, txnType: l.txnType, num: l.num,
      counterpartyName: l.vendorName, counterpartyCode: l.vendorCode, location: l.location,
      dueDate: l.dueDate, pastDueDays: l.pastDueDays, agingBucket: l.agingBucket,
      openBalanceCents: l.openBalanceCents, open: l.payable, isIntercompany: l.isIntercompany,
    }))

    expect(summarizeWhAging(rows).totalCents).toBe(124385507)
    expect(summarizeWhAging(rows, { openOnly: true }).totalCents).toBe(122495299)
    expect(summarizeWhAging(rows).rowCount).toBe(684)
  })
})
