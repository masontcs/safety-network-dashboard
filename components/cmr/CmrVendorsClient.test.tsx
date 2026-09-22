// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import CmrVendorsClient from './CmrVendorsClient'
import type { CmrApLine } from '@/lib/cmr/ap'
import type { CmrVendorsView } from '@/lib/cmr/vendors'

/**
 * The Vendors screen (AP Phase 3a): one row per canonical vendor with its total across
 * accounts → per-account subtotals → invoices. Account filter and search re-cut the one
 * response in the browser. READ ONLY for every role: no merge / rename / alias / AI control.
 */

const ACC = { TCS: 'acc-tcs', STS: 'acc-sts', HLD: 'acc-hld', INC: 'acc-inc' }

let n = 0
const ln = (over: Partial<CmrApLine>): CmrApLine => ({
  id: `l${++n}`, importId: 'imp', accountId: ACC.STS, vendorName: 'V', invoiceNum: `N${n}`, docType: 'Bill',
  billDate: '2026-08-01', dueDate: '2026-08-31', agingDays: 22, agingBucket: '1 - 30', openBalanceCents: 100_00,
  payable: true, vendorId: null, ...over,
})

let view: CmrVendorsView
let calls: string[] = []

const makeView = (): CmrVendorsView => ({
  accounts: [
    { id: ACC.TCS, name: 'TCS', active: true, sortOrder: 0 },
    { id: ACC.STS, name: 'STS', active: true, sortOrder: 1 },
    { id: ACC.HLD, name: 'Holdings', active: true, sortOrder: 2 },
    { id: ACC.INC, name: 'INC', active: true, sortOrder: 3 }, // no import → not in the filter
  ],
  imports: [
    { accountId: ACC.TCS, importedAt: '2026-09-22T18:00:00Z', sourceFilename: 'TCS AP.xlsx' },
    { accountId: ACC.STS, importedAt: '2026-09-22T18:00:00Z', sourceFilename: 'STS AP.xlsx' },
    { accountId: ACC.HLD, importedAt: '2026-09-22T18:00:00Z', sourceFilename: 'HLD AP.xlsx' },
  ],
  vendors: [
    { id: 'v-zap', canonicalName: 'ZAP MANUFACTURING INC.' },
    { id: 'v-acme', canonicalName: 'ACME LLC' },
  ],
  lines: [
    ln({ accountId: ACC.STS, vendorName: 'ZAP MANUFACTURING INC.', vendorId: 'v-zap', invoiceNum: '9421', openBalanceCents: 1_710_00, agingDays: 600 }),
    ln({ accountId: ACC.STS, vendorName: 'ZAP MANUFACTURING INC.', vendorId: 'v-zap', invoiceNum: '9440', openBalanceCents: 1_290_00 }),
    ln({ accountId: ACC.TCS, vendorName: 'ZAP MANUFACTURING INC', vendorId: 'v-zap', invoiceNum: '9999', openBalanceCents: 500_00 }),
    ln({ accountId: ACC.TCS, vendorName: 'ZAP MANUFACTURING INC', vendorId: 'v-zap', invoiceNum: 'CM1', docType: 'Credit', openBalanceCents: -100_00 }),
    ln({ accountId: ACC.HLD, vendorName: 'ACME LLC', vendorId: 'v-acme', invoiceNum: 'L1', openBalanceCents: 250_00 }),
  ],
})

const json = (data: unknown) => Promise.resolve({ status: 200, json: () => Promise.resolve(data) })

beforeEach(() => {
  view = makeView()
  calls = []
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === '/api/cmr/vendors') return json({ success: true, data: view })
    return json({ success: false, error: `unexpected ${url}` })
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const mount = () => render(<CmrVendorsClient />)
const list = () => screen.getByRole('list', { name: 'Vendors owed' })
const rowButtons = () => within(list()).getAllByRole('button', { expanded: false }).concat(within(list()).queryAllByRole('button', { expanded: true }))
const names = () => [...list().querySelectorAll(':scope > li > button .nm')].map((e) => e.textContent)

describe('CmrVendorsClient', () => {
  it('shows the total owed across accounts and one row per canonical vendor, largest first', async () => {
    mount()
    expect(await screen.findByText('Owed to vendors · All accounts')).toBeTruthy()
    expect(screen.getByText('Owed').querySelector('b')?.textContent).toBe('$3,650.00')
    expect(names()).toEqual(['ZAP MANUFACTURING INC.', 'ACME LLC'])
    const zap = list().querySelector(':scope > li > button')!
    expect(zap.textContent).toContain('$3,400.00')
    expect(zap.textContent).toContain('TCS, STS')
    expect(zap.textContent).toContain('2 accounts')
    expect(screen.getByText(/1 vendor owed by more than one account/)).toBeTruthy()
  })

  it('opens a vendor onto its per-account subtotals, and an account onto its invoices', async () => {
    mount()
    await screen.findByText('Owed to vendors · All accounts')
    fireEvent.click(within(list()).getByRole('button', { name: /ZAP MANUFACTURING INC\./ }))
    const accs = screen.getByRole('list', { name: 'ZAP MANUFACTURING INC. by account' })
    const tcs = within(accs).getByRole('button', { name: /^TCS/ })
    expect(tcs.textContent).toContain('$400.00')
    expect(tcs.textContent).toContain('1 bill · 1 credit')
    expect(tcs.textContent).toContain('in QuickBooks as “ZAP MANUFACTURING INC”')
    const sts = within(accs).getByRole('button', { name: /^STS/ })
    expect(sts.textContent).toContain('$3,000.00')
    expect(sts.textContent).not.toContain('in QuickBooks as')
    fireEvent.click(sts)
    const table = screen.getByRole('table', { name: 'Open invoices for ZAP MANUFACTURING INC. in STS' })
    expect(within(table).getAllByRole('row').slice(1).map((r) => r.querySelector('.num')?.textContent)).toEqual(['9421', '9440'])
  })

  it('a vendor in a single account opens straight onto its invoices', async () => {
    mount()
    await screen.findByText('Owed to vendors · All accounts')
    fireEvent.click(within(list()).getByRole('button', { name: /ACME LLC/ }))
    expect(screen.getByRole('table', { name: 'Open invoices for ACME LLC in Holdings' })).toBeTruthy()
  })

  it('the account filter narrows every figure to that account (and lists only accounts with A/P)', async () => {
    mount()
    await screen.findByText('Owed to vendors · All accounts')
    const filter = screen.getByRole('combobox', { name: 'Filter by account' }) as HTMLSelectElement
    expect([...filter.options].map((o) => o.textContent)).toEqual(['All accounts', 'TCS', 'STS', 'Holdings'])
    fireEvent.change(filter, { target: { value: ACC.TCS } })
    expect(await screen.findByText('Owed to vendors · TCS')).toBeTruthy()
    expect(names()).toEqual(['ZAP MANUFACTURING INC.'])
    expect(screen.getByText('Owed').querySelector('b')?.textContent).toBe('$400.00')
  })

  it('search matches a QuickBooks spelling or an invoice number', async () => {
    mount()
    await screen.findByText('Owed to vendors · All accounts')
    const search = screen.getByPlaceholderText('Find a vendor or invoice #')
    fireEvent.change(search, { target: { value: 'L1' } })
    expect(names()).toEqual(['ACME LLC'])
    fireEvent.change(search, { target: { value: 'nobody' } })
    expect(screen.getByText('No vendor or invoice matches that search.')).toBeTruthy()
  })

  it('is read only: no merge / rename / alias / AI control, and nothing but the one GET', async () => {
    mount()
    await screen.findByText('Owed to vendors · All accounts')
    fireEvent.click(within(list()).getByRole('button', { name: /ZAP MANUFACTURING INC\./ }))
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    for (const word of [/merge/i, /rename/i, /alias/i, /split/i, /suggest/i, /import/i, /delete/i]) {
      expect(buttons.some((t) => word.test(t)), String(word)).toBe(false)
    }
    expect(calls).toEqual(['GET /api/cmr/vendors'])
    expect(rowButtons().length).toBeGreaterThan(0)
  })

  it('with nothing imported it points at Accounts Payable', async () => {
    view = { ...makeView(), imports: [], lines: [], vendors: [] }
    mount()
    expect(await screen.findByText(/No A\/P has been imported yet/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Accounts Payable' }).getAttribute('href')).toBe('/cmr/ap')
  })
})
