import { describe, it, expect } from 'vitest'
import {
  CMR_PLACED_NOTES_MAX,
  composeFromAp,
  composeRefusalMessage,
  parseApLineIds,
  parseApVendorName,
  placedNotesFor,
  requestVendorLabel,
  selectionBreakdown,
} from '@/lib/cmr/requests'
import { toRequestInvoices, type CmrRequestInvoiceRow } from '@/lib/cmr/requests-server'
import type { CmrApLine } from '@/lib/cmr/ap'

/** AP Phase 2 — the pure compose rules shared by the API, the fake DB and the picker. */

const ACC = 'acc-sts'
const line = (id: string, over: Partial<CmrApLine> = {}): CmrApLine => ({
  id,
  importId: 'imp',
  accountId: ACC,
  vendorName: 'TRAFFIX DEVICES',
  invoiceNum: id,
  docType: 'Bill',
  billDate: '2025-11-24',
  dueDate: null,
  agingDays: 1,
  agingBucket: '> 90',
  openBalanceCents: 100,
  payable: true,
  ...over,
})
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('composeFromAp', () => {
  const current = [
    line(U(1), { openBalanceCents: 293_080 }),
    line(U(2), { openBalanceCents: 1_530_050 }),
    line(U(3), { docType: 'Credit', openBalanceCents: -600_814 }),
    line(U(4), { vendorName: 'ZAP MANUFACTURING INC.', openBalanceCents: 171_000 }),
    line(U(5), { docType: 'General Journal', payable: false, openBalanceCents: 5 }),
    line(U(6), { accountId: 'acc-tcs', openBalanceCents: 7 }),
  ]
  const sel = (ids: string[], vendorName = 'TRAFFIX DEVICES') => ({ accountId: ACC, vendorName, apLineIds: ids })

  it('sums bills minus credits', () => {
    const r = composeFromAp(current, sel([U(1), U(2), U(3)]))
    expect(r).toMatchObject({ ok: true, totalCents: 1_222_316 })
  })

  it('refuses the WHOLE selection if any id is another vendor’s, another account’s, non-payable or unknown', () => {
    for (const bad of [U(4), U(5), U(6), U(99)]) {
      const r = composeFromAp(current, sel([U(1), bad]))
      expect(r).toEqual({ ok: false, code: 'STALE_LINES', staleIds: [bad] })
    }
  })

  it('refuses nothing ticked, and a total at or below zero', () => {
    expect(composeFromAp(current, sel([]))).toMatchObject({ ok: false, code: 'NO_LINES' })
    expect(composeFromAp(current, sel([U(3)]))).toMatchObject({ ok: false, code: 'NOT_POSITIVE' })
    const even = [line(U(7), { openBalanceCents: 42_000 }), line(U(8), { docType: 'Credit', openBalanceCents: -42_000 })]
    expect(composeFromAp(even, sel([U(7), U(8)]))).toMatchObject({ ok: false, code: 'NOT_POSITIVE' })
  })

  it('refuses a total above the request limit', () => {
    const big = [line(U(1), { openBalanceCents: 99_999_999_999 }), line(U(2), { openBalanceCents: 1 })]
    expect(composeFromAp(big, sel([U(1), U(2)]))).toMatchObject({ ok: false, code: 'TOO_LARGE' })
  })

  it('counts a duplicated id once, case-insensitively', () => {
    expect(composeFromAp(current, sel([U(1), U(1), U(1).toUpperCase()]))).toMatchObject({ ok: true, totalCents: 293_080 })
  })

  it('matches the vendor name exactly (QuickBooks double spaces are part of the name)', () => {
    const omega = [line(U(1), { vendorName: 'OMEGA  ACCOUNTING SOLUTIONS' })]
    expect(composeFromAp(omega, sel([U(1)], 'OMEGA  ACCOUNTING SOLUTIONS')).ok).toBe(true)
    expect(composeFromAp(omega, sel([U(1)], 'OMEGA ACCOUNTING SOLUTIONS')).ok).toBe(false)
  })
})

describe('selectionBreakdown', () => {
  it('splits bills and credits for the running total', () => {
    expect(
      selectionBreakdown([
        { docType: 'Bill', openBalanceCents: 293_080 },
        { docType: 'Bill', openBalanceCents: 1_530_050 },
        { docType: 'Credit', openBalanceCents: -600_814 },
      ]),
    ).toEqual({ billsCents: 1_823_130, creditsCents: -600_814, totalCents: 1_222_316, billCount: 2, creditCount: 1 })
    expect(selectionBreakdown([])).toEqual({ billsCents: 0, creditsCents: 0, totalCents: 0, billCount: 0, creditCount: 0 })
  })
})

describe('parsing', () => {
  it('parseApLineIds: 1…500 uuids, deduped, lowercase', () => {
    expect(parseApLineIds([U(1), U(1).toUpperCase(), U(2)])).toEqual({ ok: true, value: [U(1), U(2)] })
    for (const bad of [undefined, null, 'x', [], ['nope'], [1], Array.from({ length: 501 }, (_, i) => U(i + 1))]) {
      expect(parseApLineIds(bad).ok).toBe(false)
    }
  })

  it('parseApVendorName keeps the name byte for byte', () => {
    expect(parseApVendorName('OMEGA  ACCOUNTING SOLUTIONS')).toEqual({ ok: true, value: 'OMEGA  ACCOUNTING SOLUTIONS' })
    for (const bad of ['', '   ', 5, 'x'.repeat(201)]) expect(parseApVendorName(bad).ok).toBe(false)
  })

  it('requestVendorLabel squashes whitespace and fits the 80-character vendor column', () => {
    expect(requestVendorLabel('OMEGA  ACCOUNTING SOLUTIONS')).toBe('OMEGA ACCOUNTING SOLUTIONS')
    const long = requestVendorLabel('A'.repeat(120))
    expect(long).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
  })

  it('the stale message counts', () => {
    expect(composeRefusalMessage('STALE_LINES', { accountName: 'STS', staleCount: 2 })).toMatch(/^2 of the invoices you ticked are no longer in STS’s current A\/P/)
  })
})

describe('placedNotesFor', () => {
  const invs = [
    { docType: 'Bill', invoiceNum: '4092103', openBalanceCents: 293_080 },
    { docType: 'Credit', invoiceNum: 'CM', openBalanceCents: -600_814 },
    { docType: 'Bill', invoiceNum: '4092104', openBalanceCents: 1_530_050 },
  ]

  it('a hand-entered request keeps its notes as they are', () => {
    expect(placedNotesFor('Call first', [])).toBe('Call first')
    expect(placedNotesFor(null, [])).toBeNull()
  })

  it('lists every invoice with the signed total, after the request’s own note', () => {
    expect(placedNotesFor(null, invs.slice(0, 1))).toBe('Invoice: Bill 4092103 $2,930.80 = $2,930.80')
    expect(placedNotesFor('Urgent', invs)).toBe(
      'Urgent · Invoices (3): Bill 4092103 $2,930.80; Credit CM −$6,008.14; Bill 4092104 $15,300.50 = $12,223.16',
    )
  })

  it('never splits an emoji when it has to cut (a lone surrogate would fail the write)', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ docType: 'Bill', invoiceNum: `INV-${1000 + i}`, openBalanceCents: 12_345 }))
    for (let pad = 0; pad < 4; pad++) {
      const out = placedNotesFor('x'.repeat(pad) + '💸'.repeat(250), many)!
      expect(out.length).toBeLessThanOrEqual(CMR_PLACED_NOTES_MAX)
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false)
    }
    const label = requestVendorLabel('A'.repeat(78) + '💸💸')
    expect(label.length).toBeLessThanOrEqual(80)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label)).toBe(false)
  })

  it('never exceeds the 500-character notes limit — it says "+N more" and keeps the total', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ docType: 'Bill', invoiceNum: `INV-${1000 + i}`, openBalanceCents: 12_345 }))
    const out = placedNotesFor('Pay these', many)!
    expect(out.length).toBeLessThanOrEqual(CMR_PLACED_NOTES_MAX)
    expect(out).toMatch(/; \+\d+ more = \$7,407\.00$/)
    expect(out.startsWith('Pay these · Invoices (60): Bill INV-1000 $123.45')).toBe(true)
    // a request note that fills the space is cut, the summary survives
    const longNote = placedNotesFor('n'.repeat(500), many)!
    expect(longNote.length).toBeLessThanOrEqual(CMR_PLACED_NOTES_MAX)
    expect(longNote).toMatch(/… · Invoices \(60\): \+60 more = \$7,407\.00$/)
  })
})

describe('toRequestInvoices — where a snapshot stands in the CURRENT A/P', () => {
  const snap = (id: string, over: Partial<CmrRequestInvoiceRow> = {}): CmrRequestInvoiceRow => ({
    id,
    request_id: 'r1',
    ap_line_id: null,
    vendor_name: 'TRAFFIX DEVICES',
    invoice_num: '4092104',
    doc_type: 'Bill',
    bill_date: '2025-11-24',
    due_date: null,
    open_balance_cents: '1530050',
    ...over,
  })

  it('matches by source line id first, then by vendor + type + number + date across re-imports', () => {
    const today = [line('new-104', { invoiceNum: '4092104', openBalanceCents: 1_530_050 })]
    const [i] = toRequestInvoices([snap('s1')], today)
    expect(i).toMatchObject({ inCurrentAp: true, currentApLineId: 'new-104', currentBalanceCents: null, openBalanceCents: 1_530_050 })
    const [j] = toRequestInvoices([snap('s1', { ap_line_id: 'new-104', invoice_num: 'renamed' })], today)
    expect(j.currentApLineId).toBe('new-104')
  })

  it('flags an invoice that left the A/P, and one whose balance changed there', () => {
    const [gone] = toRequestInvoices([snap('s1')], [])
    expect(gone).toMatchObject({ inCurrentAp: false, currentApLineId: null })
    const [part] = toRequestInvoices([snap('s1')], [line('x', { invoiceNum: '4092104', openBalanceCents: 1_000_000 })])
    expect(part).toMatchObject({ inCurrentAp: true, currentBalanceCents: 1_000_000 })
  })

  it('orders bills (oldest first) before credits', () => {
    const out = toRequestInvoices(
      [
        snap('c', { doc_type: 'Credit', invoice_num: 'CM', bill_date: '2024-01-01', open_balance_cents: -5 }),
        snap('b2', { invoice_num: '2', bill_date: '2025-02-01' }),
        snap('b1', { invoice_num: '1', bill_date: '2025-01-01' }),
      ],
      [],
    )
    expect(out.map((i) => i.id)).toEqual(['b1', 'b2', 'c'])
  })
})
