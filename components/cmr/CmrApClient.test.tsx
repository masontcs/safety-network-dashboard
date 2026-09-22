// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import CmrApClient from './CmrApClient'
import { DialogProvider } from '@/components/ui/DialogProvider'
import type { CmrApLine, CmrApView } from '@/lib/cmr/ap'

/**
 * The Accounts Payable screen: every role reads the vendors and invoices; only a Controller gets
 * Import, and Import previews the parsed file before anything is replaced. The account filter,
 * sort and search re-cut the one response in the browser. No native dialogs anywhere.
 */

const ACC = { TCS: 'acc-tcs', STS: 'acc-sts', OLD: 'acc-old' }

let view: CmrApView
let calls: { method: string; url: string; form?: Record<string, string> }[]
let previewReply: unknown
let commitReply: unknown

const ln = (over: Partial<CmrApLine> & { id: string }): CmrApLine => ({
  importId: 'imp-sts',
  accountId: ACC.STS,
  vendorName: 'AVERY DENNISON',
  invoiceNum: over.id,
  docType: 'Bill',
  billDate: '2026-08-01',
  dueDate: '2026-08-31',
  agingDays: 22,
  agingBucket: '1 - 30',
  openBalanceCents: 100_00,
  payable: true,
  ...over,
})

const makeView = (canImport: boolean): CmrApView => ({
  accounts: [
    { id: ACC.TCS, name: 'TCS', active: true, sortOrder: 0 },
    { id: ACC.STS, name: 'STS', active: true, sortOrder: 1 },
    { id: ACC.OLD, name: 'Old Payroll', active: false, sortOrder: 2 },
  ],
  imports: [
    {
      id: 'imp-sts', accountId: ACC.STS, sourceFilename: 'STS AP 92226.xlsx', reportTotalCents: 1250_00,
      payableTotalCents: 1000_00, importedTotalCents: 1250_00, lineCount: 5, payableLineCount: 4, vendorCount: 2,
      importedAt: '2026-09-22T18:52:00Z', importedByName: 'Cora Controller', reconciled: true,
    },
    {
      id: 'imp-tcs', accountId: ACC.TCS, sourceFilename: 'TCS AP.xlsx', reportTotalCents: 90_00,
      payableTotalCents: 100_00, importedTotalCents: 100_00, lineCount: 1, payableLineCount: 1, vendorCount: 1,
      importedAt: '2026-09-22T17:00:00Z', importedByName: null, reconciled: false,
    },
  ],
  lines: [
    ln({ id: 'A-1', openBalanceCents: 800_00, billDate: '2026-07-01', agingDays: 60, agingBucket: '31 - 60' }),
    ln({ id: 'A-2', openBalanceCents: 300_00 }),
    ln({ id: 'CM-1', docType: 'Credit', openBalanceCents: -200_00, dueDate: null, agingDays: null }),
    ln({ id: 'Z-9', vendorName: 'ZUMAR INDUSTRIES', openBalanceCents: 100_00 }),
    ln({ id: 'GJ-1', vendorName: 'AP ADJUSTMENT ACCOUNT', docType: 'General Journal', openBalanceCents: 250_00, payable: false, dueDate: null, agingDays: null }),
    ln({ id: 'T-1', importId: 'imp-tcs', accountId: ACC.TCS, vendorName: 'TIRE CO', openBalanceCents: 100_00 }),
  ],
  canImport,
})

const json = (data: unknown) => Promise.resolve({ status: 200, json: () => Promise.resolve(data) })

const PREVIEW = {
  success: true,
  data: {
    account: { id: ACC.STS, name: 'STS' },
    fileName: 'STS AP 92326.xlsx',
    summary: {
      lineCount: 147, payableLineCount: 141, vendorCount: 35, payableVendorCount: 33,
      docTypeCounts: { Bill: 116, Credit: 25, 'General Journal': 5, 'Bill Pmt -Check': 1 },
      reportTotalCents: 176_038_56, importedTotalCents: 176_038_56, payableTotalCents: 107_577_75,
      differenceCents: 0, reconciled: true,
      sampleVendors: [{ vendorName: 'GRIMCO INC.( VERICORE, LLC)', owedCents: 40_000_00, lineCount: 10 }],
    },
    replaces: { importId: 'imp-sts', importedAt: '2026-09-22T18:52:00Z', sourceFilename: 'STS AP 92226.xlsx', lineCount: 5, payableTotalCents: 1000_00, importedByName: 'Cora Controller' },
  },
}

beforeEach(() => {
  view = makeView(true)
  calls = []
  previewReply = PREVIEW
  commitReply = { success: true, data: { importId: 'imp-new' } }
  window.confirm = vi.fn(() => true)
  window.alert = vi.fn()
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0 }) as typeof requestAnimationFrame
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    let form: Record<string, string> | undefined
    if (init?.body instanceof FormData) {
      form = {}
      for (const [k, v] of init.body.entries()) form[k] = typeof v === 'string' ? v : `file:${(v as File).name}`
    }
    calls.push({ method, url, form })
    if (url === '/api/cmr/ap') return json({ success: true, data: view })
    if (url === '/api/cmr/ap/import/preview') return json(previewReply)
    if (url === '/api/cmr/ap/import/commit') return json(commitReply)
    return json({ success: false, error: `unexpected ${method} ${url}` })
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const mount = () => render(<DialogProvider><CmrApClient /></DialogProvider>)
const vendorList = () => screen.getByRole('list', { name: 'Vendors owed' })
const vendorNames = () => within(vendorList()).getAllByRole('button').map((b) => b.querySelector('.nm')?.textContent)
const xlsxFile = (name: string) => new File([new Uint8Array([0x50, 0x4b, 3, 4])], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

describe('CmrApClient — reading', () => {
  it('shows the payable total and each account’s import, flagging one that does not reconcile', async () => {
    mount()
    expect(await screen.findByText('Payable · All accounts')).toBeTruthy()
    // STS 1,000 (800 + 300 − 200 + 100) + TCS 100
    expect(screen.getByText('Owed').querySelector('b')?.textContent).toBe('$1,100.00')
    const imports = within(screen.getByRole('list', { name: "Each account's current import" })).getAllByRole('listitem')
    expect(imports.map((li) => li.querySelector('.nm')?.textContent)).toEqual(['TCS', 'STS'])
    expect(within(imports[0]).getByText('Not reconciled')).toBeTruthy()
    expect(within(imports[1]).getByText('Reconciled')).toBeTruthy()
    expect(within(imports[1]).getByText(/by Cora Controller/)).toBeTruthy()
    expect(screen.getByText('Not reconciled', { selector: '.cmr-lg-chip' })).toBeTruthy()
  })

  it('groups payable lines by vendor, largest first, and never lists a reconciliation-only line as a vendor', async () => {
    mount()
    await screen.findByText('AVERY DENNISON')
    // equal balances fall back to A–Z
    expect(vendorNames()).toEqual(['AVERY DENNISON', 'TIRE CO', 'ZUMAR INDUSTRIES'])
    expect(within(vendorList()).queryByText('AP ADJUSTMENT ACCOUNT')).toBeNull()
    expect(screen.getByText('Not payable — reconciliation only')).toBeTruthy()
  })

  it('opens a vendor to its invoices, credits negative', async () => {
    mount()
    const btn = (await screen.findByText('AVERY DENNISON')).closest('button')!
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const table = screen.getByRole('table', { name: 'Open invoices for AVERY DENNISON' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.querySelector('.num')?.textContent)).toEqual(['A-1', 'A-2', 'CM-1'])
    expect(within(rows[2]).getByText('Credit')).toBeTruthy()
    expect(within(rows[2]).getByText('−$200.00')).toBeTruthy()
    expect(within(rows[0]).getByText('7/1/26')).toBeTruthy()
    expect(within(rows[0]).getByText('60 days')).toBeTruthy()
  })

  it('the account filter re-cuts vendors and totals without another request', async () => {
    mount()
    await screen.findByText('AVERY DENNISON')
    const before = calls.length
    fireEvent.change(screen.getByLabelText('Filter by account'), { target: { value: ACC.TCS } })
    expect(vendorNames()).toEqual(['TIRE CO'])
    expect(screen.getByText('Payable · TCS')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: "Each account's current import" })).getAllByRole('listitem')).toHaveLength(1)
    expect(calls.length).toBe(before)
    // the inactive account without AP is not offered
    expect(within(screen.getByLabelText('Filter by account')).queryByText(/Old Payroll/)).toBeNull()
  })

  it('sorts A–Z and searches by vendor or invoice number', async () => {
    mount()
    await screen.findByText('AVERY DENNISON')
    fireEvent.click(screen.getByRole('button', { name: 'A–Z' }))
    expect(vendorNames()).toEqual(['AVERY DENNISON', 'TIRE CO', 'ZUMAR INDUSTRIES'])
    fireEvent.change(screen.getByPlaceholderText('Find a vendor or invoice #'), { target: { value: 'z-9' } })
    expect(vendorNames()).toEqual(['ZUMAR INDUSTRIES'])
  })

  for (const role of ['requester', 'viewer']) {
    it(`a ${role} reads everything but has no Import control`, async () => {
      view = makeView(false)
      mount()
      await screen.findByText('AVERY DENNISON')
      expect(screen.queryByRole('button', { name: /Import/ })).toBeNull()
      expect(screen.getByText(/Only a Controller can import/)).toBeTruthy()
    })
  }

  it('an empty AP shows a first-import prompt to a Controller', async () => {
    view = { ...makeView(true), imports: [], lines: [] }
    mount()
    expect(await screen.findByText('No A/P imported yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Import the first report/ })).toBeTruthy()
  })
})

describe('CmrApClient — importing', () => {
  it('pick → preview → confirm: nothing is committed until the preview is confirmed', async () => {
    mount()
    await screen.findByText('AVERY DENNISON')
    fireEvent.click(screen.getByRole('button', { name: /Import A\/P aging/ }))
    const dlg = screen.getByRole('dialog')
    // only active accounts are offered
    expect(within(dlg).queryByText('Old Payroll')).toBeNull()
    // picking the file suggests the account from its name
    fireEvent.change(dlg.querySelector('input[type="file"]')!, { target: { files: [xlsxFile('STS AP 92326.xlsx')] } })
    expect((within(dlg).getByLabelText('Account') as HTMLSelectElement).value).toBe(ACC.STS)
    fireEvent.click(within(dlg).getByRole('button', { name: 'Preview' }))

    expect(await within(dlg).findByText('Import STS A/P?')).toBeTruthy()
    expect(calls.filter((c) => c.url.startsWith('/api/cmr/ap/import'))).toEqual([
      { method: 'POST', url: '/api/cmr/ap/import/preview', form: { accountId: ACC.STS, file: 'file:STS AP 92326.xlsx' } },
    ])
    expect(within(dlg).getByText('$107,577.75')).toBeTruthy()
    expect(within(dlg).getByText(/add up to the report TOTAL of/)).toBeTruthy()
    expect(within(dlg).getByText(/5 General Journal, 1 Bill Pmt -Check/)).toBeTruthy()
    expect(within(dlg).getByText(/Replaces the snapshot imported/)).toBeTruthy()

    fireEvent.click(within(dlg).getByRole('button', { name: /Replace STS A\/P/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const commit = calls.find((c) => c.url === '/api/cmr/ap/import/commit')
    expect(commit?.form).toEqual({ accountId: ACC.STS, file: 'file:STS AP 92326.xlsx', expectedLineCount: '147', expectedReportTotalCents: '17603856' })
    // reloaded, filtered to the account just imported, and announced
    expect(calls.filter((c) => c.url === '/api/cmr/ap')).toHaveLength(2)
    expect(await screen.findByText(/STS A\/P imported: 33 vendors, \$107,577\.75 payable, reconciled/, { selector: '.cmr-ap-done span' })).toBeTruthy()
    expect((screen.getByLabelText('Filter by account') as HTMLSelectElement).value).toBe(ACC.STS)
    expect(window.alert).not.toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('warns when the file name names a different account than the one chosen', async () => {
    mount()
    await screen.findByText('AVERY DENNISON')
    fireEvent.click(screen.getByRole('button', { name: /Import A\/P aging/ }))
    const dlg = screen.getByRole('dialog')
    fireEvent.change(within(dlg).getByLabelText('Account'), { target: { value: ACC.TCS } })
    fireEvent.change(dlg.querySelector('input[type="file"]')!, { target: { files: [xlsxFile('STS AP 92326.xlsx')] } })
    expect(within(dlg).getByRole('note').textContent).toMatch(/file name says STS, but you chose TCS/)
  })

  it('an unreconciled preview says so and asks to "Import anyway"', async () => {
    previewReply = {
      ...PREVIEW,
      data: { ...PREVIEW.data, replaces: null, summary: { ...PREVIEW.data.summary, importedTotalCents: 176_000_00, differenceCents: -38_56, reconciled: false } },
    }
    mount()
    await screen.findByText('AVERY DENNISON')
    fireEvent.click(screen.getByRole('button', { name: /Import A\/P aging/ }))
    const dlg = screen.getByRole('dialog')
    fireEvent.change(dlg.querySelector('input[type="file"]')!, { target: { files: [xlsxFile('STS AP 92326.xlsx')] } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Preview' }))
    expect(await within(dlg).findByRole('alert')).toBeTruthy()
    expect(within(dlg).getByText(/off by −\$38\.56/)).toBeTruthy()
    expect(within(dlg).getByRole('button', { name: /Import anyway/ })).toBeTruthy()
    expect(within(dlg).getByText(/first A\/P import/)).toBeTruthy()
  })

  it('a refused preview is shown in the dialog, nothing is committed', async () => {
    previewReply = { success: false, error: 'That file is not a QuickBooks A/P Aging Detail report.', code: 'NOT_AP_AGING' }
    mount()
    await screen.findByText('AVERY DENNISON')
    fireEvent.click(screen.getByRole('button', { name: /Import A\/P aging/ }))
    const dlg = screen.getByRole('dialog')
    fireEvent.change(within(dlg).getByLabelText('Account'), { target: { value: ACC.TCS } })
    fireEvent.change(dlg.querySelector('input[type="file"]')!, { target: { files: [xlsxFile('payroll.xlsx')] } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Preview' }))
    expect((await within(dlg).findByRole('alert')).textContent).toMatch(/not a QuickBooks A\/P Aging Detail/)
    expect(calls.some((c) => c.url === '/api/cmr/ap/import/commit')).toBe(false)
  })

  it('Preview without an account or file asks for it instead of sending anything', async () => {
    mount()
    await screen.findByText('AVERY DENNISON')
    fireEvent.click(screen.getByRole('button', { name: /Import A\/P aging/ }))
    const dlg = screen.getByRole('dialog')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Preview' }))
    expect((await within(dlg).findByRole('alert')).textContent).toMatch(/Choose the account/)
    expect(calls.some((c) => c.url.startsWith('/api/cmr/ap/import'))).toBe(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
