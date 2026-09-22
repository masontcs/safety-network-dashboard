import { describe, it, expect } from 'vitest'
import {
  accountFromFileName,
  apReconciliationLines,
  apTotals,
  apVendorGroups,
  describeReconciliation,
  formatAging,
  formatApDate,
  type CmrApAccountRef,
  type CmrApLine,
} from './ap'

/** The pure AP view logic the page and the API share. */

const ACCOUNTS: CmrApAccountRef[] = [
  { id: 'tcs', name: 'TCS', active: true, sortOrder: 0 },
  { id: 'sts', name: 'STS', active: true, sortOrder: 1 },
]

let n = 0
const ln = (over: Partial<CmrApLine>): CmrApLine => ({
  id: `l${++n}`, importId: 'i', accountId: 'sts', vendorName: 'V', invoiceNum: null, docType: 'Bill',
  billDate: '2026-09-01', dueDate: null, agingDays: null, agingBucket: 'Current', openBalanceCents: 100, payable: true, vendorId: null, ...over,
})

describe('apVendorGroups', () => {
  it('nets credits against bills, and a vendor can be in credit', () => {
    const g = apVendorGroups([
      ln({ vendorName: 'A', openBalanceCents: 500 }),
      ln({ vendorName: 'A', docType: 'Credit', openBalanceCents: -700 }),
      ln({ vendorName: 'B', openBalanceCents: 50, agingDays: 12 }),
      ln({ vendorName: 'B', openBalanceCents: 50, agingDays: 90 }),
    ], ACCOUNTS, null)
    expect(g.map((v) => [v.vendorName, v.owedCents, v.billCount, v.creditCount, v.oldestAgingDays])).toEqual([
      ['B', 100, 2, 0, 90],
      ['A', -200, 1, 1, null],
    ])
  })

  it('the same vendor name under two accounts is two payables', () => {
    const g = apVendorGroups([ln({ vendorName: 'UPS', accountId: 'tcs' }), ln({ vendorName: 'UPS', accountId: 'sts' })], ACCOUNTS, null)
    expect(g.map((v) => v.accountName)).toEqual(['TCS', 'STS'])
  })

  it('skips non-payable lines and orders invoices oldest first, undated last', () => {
    const g = apVendorGroups([
      ln({ vendorName: 'A', invoiceNum: 'late', billDate: '2026-09-10' }),
      ln({ vendorName: 'A', invoiceNum: 'none', billDate: null }),
      ln({ vendorName: 'A', invoiceNum: 'early', billDate: '2026-01-10' }),
      ln({ vendorName: 'A', docType: 'General Journal', payable: false }),
    ], ACCOUNTS, 'sts')
    expect(g[0].lines.map((l) => l.invoiceNum)).toEqual(['early', 'late', 'none'])
  })
})

describe('apTotals / apReconciliationLines', () => {
  it('splits bills, credits and the rest, and scopes to an account', () => {
    const lines = [
      ln({ openBalanceCents: 1000 }),
      ln({ docType: 'Credit', openBalanceCents: -300 }),
      ln({ docType: 'Bill Pmt -Check', payable: false, openBalanceCents: -35 }),
      ln({ accountId: 'tcs', openBalanceCents: 1 }),
    ]
    const imports = [
      { id: 'i', accountId: 'sts', sourceFilename: null, reportTotalCents: 665, payableTotalCents: 700, importedTotalCents: 665, lineCount: 3, payableLineCount: 2, vendorCount: 1, importedAt: '', importedByName: null, reconciled: true },
      { id: 'j', accountId: 'tcs', sourceFilename: null, reportTotalCents: 2, payableTotalCents: 1, importedTotalCents: 1, lineCount: 1, payableLineCount: 1, vendorCount: 1, importedAt: '', importedByName: null, reconciled: false },
    ]
    expect(apTotals({ lines, imports }, 'sts')).toMatchObject({
      payableCents: 700, billsCents: 1000, creditsCents: -300, otherCents: -35, importedCents: 665, reportCents: 665,
      billCount: 1, creditCount: 1, otherCount: 1, vendorCount: 1, reconciled: true, importCount: 1,
    })
    expect(apTotals({ lines, imports }, null).reconciled).toBe(false)
    expect(apReconciliationLines(lines, 'sts').map((l) => l.docType)).toEqual(['Bill Pmt -Check'])
    expect(apReconciliationLines(lines, 'tcs')).toEqual([])
  })
})

describe('formatting', () => {
  it('describes reconciliation', () => {
    expect(describeReconciliation({ importedTotalCents: 5, reportTotalCents: 5, reconciled: true })).toBe('Reconciled to the report TOTAL')
    expect(describeReconciliation({ importedTotalCents: 100, reportTotalCents: 150, reconciled: false })).toBe('Off by −$0.50 against the report TOTAL')
  })
  it('dates and aging read like the QuickBooks report', () => {
    expect(formatApDate('2026-08-31')).toBe('8/31/26')
    expect(formatApDate(null)).toBe('—')
    expect(formatAging(1)).toBe('1 day')
    expect(formatAging(166)).toBe('166 days')
    expect(formatAging(null)).toBe('—')
  })
  it('reads the account from a QuickBooks export file name', () => {
    expect(accountFromFileName('STS AP 92226.xlsx', ACCOUNTS)?.id).toBe('sts')
    expect(accountFromFileName('tcs_ap_0922.xlsx', ACCOUNTS)?.id).toBe('tcs')
    expect(accountFromFileName('AP aging.xlsx', ACCOUNTS)).toBeNull()
    expect(accountFromFileName('', ACCOUNTS)).toBeNull()
  })
})
