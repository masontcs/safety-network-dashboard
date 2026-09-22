import { describe, it, expect } from 'vitest'
import type { CmrApAccountRef, CmrApLine } from '@/lib/cmr/ap'
import {
  matchesVendorQuery,
  normalizeVendorName,
  pickerGroupOf,
  pickerVendorGroups,
  vendorKeyOf,
  vendorRollup,
  vendorRollupTotals,
  type CmrVendorRef,
} from '@/lib/cmr/vendors'

/**
 * AP Phase 3a — canonical vendors: the normalization (the ONLY automatic link), the
 * cross-account rollup and the picker's per-account grouping.
 */

// ── normalization ─────────────────────────────────────────────────────────────

/**
 * [input, what public.cmr_vendor_normalize returned for it on PostgreSQL 16 with this exact
 * migration]. The app and the database MUST agree, or the same spelling would group differently
 * in the browser than in the resolver. Regenerate from the SQL if the rule ever changes (it can
 * only change in a NEW migration).
 */
const SQL_PARITY: [string, string][] = [
  ['acme inc', 'ACME INC'],
  ['ACME INC', 'ACME INC'],
  ['  Acme   Inc  ', 'ACME INC'],
  ['ACME INC.', 'ACME INC'],
  ['ACME INC..', 'ACME INC.'],
  ['ACME LLC', 'ACME LLC'],
  ['ACME, INC.', 'ACME, INC'],
  ['ACME .', 'ACME '],
  ['.', '.'],
  ['..', '.'],
  ['a', 'A'],
  ['', ''],
  ['   ', ''],
  ['OMEGA  ACCOUNTING SOLUTIONS', 'OMEGA ACCOUNTING SOLUTIONS'],
  ['Omega\tAccounting\nSolutions', 'OMEGA ACCOUNTING SOLUTIONS'],
  ['NBSP\u00a0NAME', 'NBSP NAME'],
  ['caf\u00e9', 'CAF\u00e9'],
  ['\u00c9COLE', '\u00c9COLE'],
  ['stra\u00dfe', 'STRA\u00dfE'],
  ['ACME\u2003INC', 'ACME\u2003INC'],
  ['x.y.', 'X.Y'],
  ['  .  ', '.'],
  ["NICK'S TRUCKING, INC.", "NICK'S TRUCKING, INC"],
  ['American Express 91000 &  92016', 'AMERICAN EXPRESS 91000 & 92016'],
  ['\r\n lead', 'LEAD'],
]

describe('normalizeVendorName — conservative: case, whitespace, one trailing dot, nothing else', () => {
  it('matches the SQL cmr_vendor_normalize on every fixture', () => {
    for (const [input, sql] of SQL_PARITY) expect(normalizeVendorName(input), JSON.stringify(input)).toBe(sql)
  })

  it('case, whitespace runs and ONE trailing "." fold together', () => {
    const same = ['ZAP MANUFACTURING INC.', 'zap manufacturing inc', 'Zap  Manufacturing   Inc.', ' ZAP MANUFACTURING INC ', 'ZAP\tMANUFACTURING\u00a0INC.']
    expect(new Set(same.map(normalizeVendorName))).toEqual(new Set(['ZAP MANUFACTURING INC']))
  })

  it('INC vs LLC, INC vs CORP, punctuation and typos stay SEPARATE vendors', () => {
    const distinct = ['ACME INC', 'ACME LLC', 'ACME CORP', 'ACME', 'ACME, INC', 'ACME INC,', 'ACMEE INC', 'A.C.M.E. INC', 'ACME-INC']
    expect(new Set(distinct.map(normalizeVendorName)).size).toBe(distinct.length)
  })

  it('only one trailing dot is removed, and only when something is left', () => {
    expect(normalizeVendorName('CO..')).toBe('CO.')
    expect(normalizeVendorName('.')).toBe('.')
    expect(normalizeVendorName('P.C.')).toBe('P.C')
  })

  it('only ASCII letters are uppercased (the SQL uses translate(), which ignores the locale)', () => {
    expect(normalizeVendorName('müller')).toBe('MüLLER')
    expect(normalizeVendorName('MÜLLER')).not.toBe(normalizeVendorName('müller'))
  })
})

// ── the rollup ────────────────────────────────────────────────────────────────

const ACCOUNTS: CmrApAccountRef[] = [
  { id: 'tcs', name: 'TCS', active: true, sortOrder: 0 },
  { id: 'sts', name: 'STS', active: true, sortOrder: 1 },
  { id: 'hld', name: 'Holdings', active: true, sortOrder: 2 },
]
const VENDORS: CmrVendorRef[] = [
  { id: 'v-zap', canonicalName: 'ZAP MANUFACTURING INC.' },
  { id: 'v-acme-inc', canonicalName: 'ACME INC' },
  { id: 'v-acme-llc', canonicalName: 'ACME LLC' },
  { id: 'v-omega', canonicalName: 'OMEGA  ACCOUNTING SOLUTIONS' },
]

let n = 0
const ln = (over: Partial<CmrApLine>): CmrApLine => ({
  id: `l${++n}`, importId: `imp-${over.accountId ?? 'sts'}`, accountId: 'sts', vendorName: 'V', invoiceNum: `I${n}`, docType: 'Bill',
  billDate: '2026-09-01', dueDate: null, agingDays: 10, agingBucket: '1 - 30', openBalanceCents: 100, payable: true, vendorId: null, ...over,
})

const LINES: CmrApLine[] = [
  // ZAP in STS (two bills) and TCS (a bill and a credit) — ONE vendor, spelled with and without the dot
  ln({ accountId: 'sts', vendorName: 'ZAP MANUFACTURING INC.', vendorId: 'v-zap', openBalanceCents: 171_000, agingDays: 600 }),
  ln({ accountId: 'sts', vendorName: 'ZAP MANUFACTURING INC.', vendorId: 'v-zap', openBalanceCents: 129_000, agingDays: 580 }),
  ln({ accountId: 'tcs', vendorName: 'ZAP MANUFACTURING INC', vendorId: 'v-zap', openBalanceCents: 50_000 }),
  ln({ accountId: 'tcs', vendorName: 'ZAP MANUFACTURING INC', vendorId: 'v-zap', docType: 'Credit', openBalanceCents: -20_000 }),
  // ACME INC vs ACME LLC — two vendors
  ln({ accountId: 'sts', vendorName: 'ACME INC', vendorId: 'v-acme-inc', openBalanceCents: 10_000 }),
  ln({ accountId: 'hld', vendorName: 'ACME LLC', vendorId: 'v-acme-llc', openBalanceCents: 20_000 }),
  // a vendor in credit
  ln({ accountId: 'hld', vendorName: 'OMEGA  ACCOUNTING SOLUTIONS', vendorId: 'v-omega', docType: 'Credit', openBalanceCents: -5_000, agingDays: null }),
  // NOT payable — never counted
  ln({ accountId: 'sts', vendorName: 'AP ADJUSTMENT ACCOUNT', vendorId: 'v-adj', docType: 'General Journal', payable: false, openBalanceCents: 27_937_775 }),
  ln({ accountId: 'tcs', vendorName: 'ZAP MANUFACTURING INC', vendorId: 'v-zap', docType: 'Bill Pmt -Check', payable: false, openBalanceCents: -999 }),
  // unlinked lines group by normalized raw name, never dropped
  ln({ accountId: 'sts', vendorName: 'NEW VENDOR', vendorId: null, openBalanceCents: 1_234 }),
  ln({ accountId: 'tcs', vendorName: 'new  vendor.', vendorId: null, openBalanceCents: 766 }),
]
const VIEW = { accounts: ACCOUNTS, vendors: VENDORS, lines: LINES }

describe('vendorRollup — one row per canonical vendor, Σ payable across accounts', () => {
  const rows = vendorRollup(VIEW, null)
  const row = (key: string) => rows.find((r) => r.key === key)!

  it('the same vendor under two accounts is ONE row with two account subtotals', () => {
    const zap = row('v:v-zap')
    expect(zap.name).toBe('ZAP MANUFACTURING INC.')
    expect(zap.owedCents).toBe(171_000 + 129_000 + 50_000 - 20_000)
    expect(zap.accounts.map((s) => [s.accountName, s.owedCents, s.billCount, s.creditCount])).toEqual([
      ['TCS', 30_000, 1, 1], // accounts in their own order (TCS sortOrder 0)
      ['STS', 300_000, 2, 0],
    ])
    expect(zap.rawNames).toEqual(['ZAP MANUFACTURING INC', 'ZAP MANUFACTURING INC.'])
    expect(zap.accounts[0].rawNames).toEqual(['ZAP MANUFACTURING INC'])
    expect(zap.oldestAgingDays).toBe(600)
  })

  it('totals: every row = Σ its account shares = Σ its payable lines; the whole = Σ every payable line', () => {
    for (const r of rows) {
      expect(r.accounts.reduce((s, a) => s + a.owedCents, 0)).toBe(r.owedCents)
      for (const a of r.accounts) expect(a.lines.reduce((s, l) => s + l.openBalanceCents, 0)).toBe(a.owedCents)
    }
    const payable = LINES.filter((l) => l.payable).reduce((s, l) => s + l.openBalanceCents, 0)
    expect(vendorRollupTotals(rows)).toEqual({
      owedCents: payable, vendorCount: 5, multiAccountCount: 2, accountCount: 3, billCount: 7, creditCount: 2,
    })
  })

  it('ACME INC and ACME LLC stay separate; non-payable lines never appear', () => {
    expect(row('v:v-acme-inc').owedCents).toBe(10_000)
    expect(row('v:v-acme-llc').owedCents).toBe(20_000)
    expect(rows.some((r) => r.key === 'v:v-adj')).toBe(false)
    expect(rows.flatMap((r) => r.accounts.flatMap((a) => a.lines)).every((l) => l.payable)).toBe(true)
  })

  it('unlinked lines group by their normalized raw name (so totals still add up)', () => {
    expect(vendorKeyOf({ vendorId: null, vendorName: 'new  vendor.' })).toBe('raw:NEW VENDOR')
    const nv = row('raw:NEW VENDOR')
    expect(nv).toMatchObject({ vendorId: null, owedCents: 2_000 })
    expect(nv.accounts).toHaveLength(2)
  })

  it('a vendor in credit keeps its negative total; sorting is largest first, or A–Z', () => {
    expect(row('v:v-omega').owedCents).toBe(-5_000)
    expect(rows.map((r) => r.owedCents)).toEqual([...rows.map((r) => r.owedCents)].sort((a, b) => b - a))
    expect(vendorRollup(VIEW, null, 'name').map((r) => r.name)).toEqual([
      'ACME INC', 'ACME LLC', 'NEW VENDOR', 'OMEGA  ACCOUNTING SOLUTIONS', 'ZAP MANUFACTURING INC.',
    ])
  })

  it('the account filter narrows every figure to that account', () => {
    const tcs = vendorRollup(VIEW, 'tcs')
    expect(tcs.map((r) => [r.key, r.owedCents, r.accounts.length])).toEqual([
      ['v:v-zap', 30_000, 1],
      ['raw:NEW VENDOR', 766, 1],
    ])
    expect(vendorRollupTotals(tcs)).toMatchObject({ owedCents: 30_766, vendorCount: 2, multiAccountCount: 0, accountCount: 1 })
  })

  it('search matches the canonical name, any QuickBooks spelling, or an invoice number', () => {
    const zap = row('v:v-zap')
    expect(matchesVendorQuery(zap, 'zap manu')).toBe(true)
    expect(matchesVendorQuery(zap, 'INC.')).toBe(true)
    expect(matchesVendorQuery(zap, zap.accounts[1].lines[0].invoiceNum!)).toBe(true)
    expect(matchesVendorQuery(zap, 'acme')).toBe(false)
    expect(matchesVendorQuery(zap, '   ')).toBe(true)
  })
})

// ── the picker: one account, grouped by canonical vendor ─────────────────────

describe('pickerVendorGroups — the request picker within ONE account', () => {
  const sts = ACCOUNTS[1]
  const lines = [
    ln({ accountId: 'sts', vendorName: 'ZAP MANUFACTURING INC.', vendorId: 'v-zap', openBalanceCents: 171_000 }),
    ln({ accountId: 'sts', vendorName: 'ZAP  MANUFACTURING INC', vendorId: 'v-zap', openBalanceCents: 5_000 }),
    ln({ accountId: 'sts', vendorName: 'ACME INC', vendorId: 'v-acme-inc', openBalanceCents: 10_000 }),
    ln({ accountId: 'tcs', vendorName: 'ZAP MANUFACTURING INC.', vendorId: 'v-zap', openBalanceCents: 99_999 }),
    ln({ accountId: 'sts', vendorName: 'GJ', vendorId: 'v-gj', payable: false, docType: 'General Journal', openBalanceCents: 1 }),
  ]
  const groups = pickerVendorGroups(lines, sts, VENDORS)

  it('lists canonical vendors A–Z with only this account’s payable lines', () => {
    expect(groups.map((g) => [g.canonicalName, g.owedCents, g.accountId])).toEqual([
      ['ACME INC', 10_000, 'sts'],
      ['ZAP MANUFACTURING INC.', 176_000, 'sts'],
    ])
  })

  it('keeps every raw spelling, so a request can still be matched on the exact QuickBooks name', () => {
    const zap = groups[1]
    expect(zap.rawNames).toEqual(['ZAP  MANUFACTURING INC', 'ZAP MANUFACTURING INC.'])
    expect(zap.vendorName).toBe('ZAP  MANUFACTURING INC')
    expect(pickerGroupOf(groups, 'ZAP MANUFACTURING INC.')?.key).toBe('v:v-zap')
    expect(pickerGroupOf(groups, 'nobody')).toBeNull()
  })

  it('falls back to the raw name when a line has no vendor_id', () => {
    const g = pickerVendorGroups([ln({ accountId: 'sts', vendorName: 'LEGACY CO', vendorId: null })], sts, [])
    expect(g).toMatchObject([{ key: 'raw:LEGACY CO', vendorId: null, canonicalName: 'LEGACY CO', vendorName: 'LEGACY CO' }])
  })
})
