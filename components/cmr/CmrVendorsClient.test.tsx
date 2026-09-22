// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import CmrVendorsClient from './CmrVendorsClient'
import { DialogProvider } from '@/components/ui/DialogProvider'
import type { CmrApLine } from '@/lib/cmr/ap'
import type { CmrVendorCatalogEntry, CmrVendorSuggestionsView, CmrVendorsView } from '@/lib/cmr/vendors'

/**
 * The Vendors screen (AP Phase 3a): one row per canonical vendor with its total across
 * accounts → per-account subtotals → invoices. Account filter and search re-cut the one
 * response in the browser. For a Viewer / Requester it is READ ONLY: no merge / rename / split /
 * suggestion control, and nothing but the one GET. A Controller (AP Phase 3b, canManage) also gets
 * "Possible duplicates" (advisory) and Merge with… / Rename / Split — each only on confirmation,
 * through in-app dialogs (never native prompts).
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
let bodies: Record<string, unknown>[] = []
let postReply: (url: string) => unknown = () => ({ success: true, data: {} })

const entry = (id: string, name: string, aliases: [string, string, number, string[]][], accounts: [string, string][], owedCents: number): CmrVendorCatalogEntry => ({
  id, canonicalName: name, owedCents, lineCount: aliases.reduce((n, a) => n + a[2], 0),
  aliases: aliases.map(([aid, rawName, lineCount, accountNames]) => ({ id: aid, rawName, lineCount, accountNames })),
  accounts: accounts.map(([aid, n]) => ({ id: aid, name: n })),
})
const CATALOG: CmrVendorCatalogEntry[] = [
  entry('v-acme', 'ACME LLC', [['al-acme', 'ACME LLC', 1, ['Holdings']]], [[ACC.HLD, 'Holdings']], 250_00),
  entry('v-acmi', 'ACME INC', [['al-acmi', 'ACME INC', 1, ['STS']]], [[ACC.STS, 'STS']], 40_00),
  entry('v-zap', 'ZAP MANUFACTURING INC.', [['al-zap1', 'ZAP MANUFACTURING INC', 2, ['TCS']], ['al-zap2', 'ZAP MANUFACTURING INC.', 2, ['STS']]], [[ACC.TCS, 'TCS'], [ACC.STS, 'STS']], 3_400_00),
]
const summary = (e: CmrVendorCatalogEntry) => ({ id: e.id, canonicalName: e.canonicalName, accounts: e.accounts, owedCents: e.owedCents, spellings: e.aliases.map((a) => a.rawName) })
const SUGGESTIONS: CmrVendorSuggestionsView = {
  pairs: [{ a: summary(CATALOG[1]), b: summary(CATALOG[0]), kind: 'suffix', score: 0.97, reason: 'Same name apart from the company suffix “INC”, “LLC”.', ai: null }],
  vendorCount: 3,
  engine: { heuristic: true, ai: 'off', aiMessage: null },
}

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
  // jsdom has no scrollIntoView (the searchable Combobox calls it)
  Element.prototype.scrollIntoView ??= function () {}
  view = makeView()
  calls = []
  bodies = []
  postReply = () => ({ success: true, data: {} })
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (init?.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return json(postReply(url)) }
    if (url === '/api/cmr/vendors') return json({ success: true, data: view })
    if (url === '/api/cmr/vendors/catalog') return json({ success: true, data: { vendors: CATALOG } })
    if (url === '/api/cmr/vendors/suggestions') return json({ success: true, data: SUGGESTIONS })
    if (url === '/api/cmr/vendors/suggestions?ai=1') {
      return json({ success: true, data: { ...SUGGESTIONS, pairs: [{ ...SUGGESTIONS.pairs[0], ai: { verdict: 'different', note: 'Different legal entities.' } }], engine: { heuristic: true, ai: 'used', aiMessage: null } } })
    }
    return json({ success: false, error: `unexpected ${url}` })
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const mount = () => render(<DialogProvider><CmrVendorsClient /></DialogProvider>)
const asController = () => { view = { ...makeView(), vendors: [...makeView().vendors, { id: 'v-acmi', canonicalName: 'ACME INC' }], lines: [...makeView().lines, ln({ accountId: ACC.STS, vendorName: 'ACME INC', vendorId: 'v-acmi', invoiceNum: 'A1', openBalanceCents: 40_00 })], canManage: true } }
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

  it('Viewer / Requester (canManage false): read only — no merge / rename / split / suggestion control, and nothing but the one GET', async () => {
    view = { ...makeView(), canManage: false }
    mount()
    await screen.findByText('Owed to vendors · All accounts')
    fireEvent.click(within(list()).getByRole('button', { name: /ZAP MANUFACTURING INC\./ }))
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    for (const word of [/merge/i, /rename/i, /alias/i, /split/i, /suggest/i, /import/i, /delete/i, /duplicate/i, /\bAI\b/, /not the same/i]) {
      expect(buttons.some((t) => word.test(t)), String(word)).toBe(false)
    }
    expect(calls).toEqual(['GET /api/cmr/vendors'])
    expect(rowButtons().length).toBeGreaterThan(0)
    expect(screen.queryByText('Possible duplicates')).toBeNull()
  })

  it('with nothing imported it points at Accounts Payable', async () => {
    view = { ...makeView(), imports: [], lines: [], vendors: [] }
    mount()
    expect(await screen.findByText(/No A\/P has been imported yet/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Accounts Payable' }).getAttribute('href')).toBe('/cmr/ap')
  })

  // ── AP Phase 3b: the Controller's tools ──────────────────────────────────

  const dupList = () => screen.getByRole('list', { name: 'Possible duplicate vendors' })
  const dialog = () => screen.getByRole('dialog')

  it('Controller: "Possible duplicates" lists each suggested pair with both sides, the reason and Merge / Not the same', async () => {
    asController()
    mount()
    const dups = await screen.findByRole('list', { name: 'Possible duplicate vendors' })
    const row = within(dups).getAllByRole('listitem')[0]
    expect(row.textContent).toContain('ACME INC')
    expect(row.textContent).toContain('STS · $40.00')
    expect(row.textContent).toContain('ACME LLC')
    expect(row.textContent).toContain('Holdings · $250.00')
    expect(row.textContent).toContain('Company suffix')
    expect(row.textContent).toContain('Same name apart from the company suffix')
    expect(within(row).getByRole('button', { name: 'Merge ACME INC and ACME LLC' })).toBeTruthy()
    expect(calls).toEqual(['GET /api/cmr/vendors', 'GET /api/cmr/vendors/catalog', 'GET /api/cmr/vendors/suggestions'])
  })

  it('Merge from a suggestion: the Controller picks the name to keep; that vendor is the target', async () => {
    asController()
    postReply = () => ({ success: true, data: { vendorId: 'v-acme' } })
    mount()
    await screen.findByRole('list', { name: 'Possible duplicate vendors' })
    fireEvent.click(within(dupList()).getByRole('button', { name: /^Merge ACME INC/ }))
    const d = dialog()
    expect(d.textContent).toContain('Together: $290.00 owed across STS, Holdings')
    // default keeps the first; choose ACME LLC instead
    fireEvent.click(within(d).getByRole('radio', { name: /ACME LLC/ }))
    fireEvent.click(within(d).getByRole('button', { name: 'Merge' }))
    await screen.findByText('Merged ACME INC into ACME LLC.')
    expect(bodies).toEqual([{ targetId: 'v-acme', sourceId: 'v-acmi' }])
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual(['POST /api/cmr/vendors/merge'])
    expect(screen.queryByRole('dialog')).toBeNull()
    // …and everything was re-read
    expect(calls.filter((c) => c === 'GET /api/cmr/vendors')).toHaveLength(2)
  })

  it('Not the same: asks in an in-app confirm, then records the dismissal; Cancel does nothing', async () => {
    asController()
    mount()
    await screen.findByRole('list', { name: 'Possible duplicate vendors' })
    fireEvent.click(within(dupList()).getByRole('button', { name: /^Dismiss/ }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(bodies).toEqual([])
    fireEvent.click(within(dupList()).getByRole('button', { name: /^Dismiss/ }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Stop suggesting' }))
    await screen.findByText(/won’t be suggested again/)
    expect(bodies).toEqual([{ vendorIdA: 'v-acmi', vendorIdB: 'v-acme' }])
    expect(calls).toContain('POST /api/cmr/vendors/dismiss')
  })

  it('Ask AI to review: re-reads with ?ai=1 and shows the AI verdict beside the rule', async () => {
    asController()
    mount()
    await screen.findByRole('list', { name: 'Possible duplicate vendors' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI to review' }))
    expect(await screen.findByText(/AI: likely different — Different legal entities\./)).toBeTruthy()
    expect(calls).toContain('GET /api/cmr/vendors/suggestions?ai=1')
    expect(screen.getByText(/reviewed by AI/)).toBeTruthy()
  })

  it('the AI verdicts survive an action that re-reads the list (no second AI call)', async () => {
    asController()
    mount()
    await screen.findByRole('list', { name: 'Possible duplicate vendors' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI to review' }))
    await screen.findByText(/AI: likely different/)
    fireEvent.click(within(list()).getByRole('button', { name: /ACME LLC/ }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Manage ACME LLC' })).getByRole('button', { name: /Rename/ }))
    fireEvent.change(within(dialog()).getByRole('textbox'), { target: { value: 'Acme' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Rename' }))
    await screen.findByText('Renamed to Acme.')
    expect(screen.getByText(/AI: likely different — Different legal entities\./)).toBeTruthy()
    expect(calls.filter((c) => c.includes('ai=1'))).toHaveLength(1)
    expect(calls.filter((c) => c === 'GET /api/cmr/vendors/suggestions')).toHaveLength(2)
  })

  it('an open vendor offers Merge with… / Rename / Split; Rename sends the trimmed new name', async () => {
    asController()
    postReply = () => ({ success: true, data: { changed: true } })
    mount()
    await screen.findByRole('list', { name: 'Possible duplicate vendors' })
    fireEvent.click(within(list()).getByRole('button', { name: /ACME LLC/ }))
    const bar = screen.getByRole('group', { name: 'Manage ACME LLC' })
    expect(within(bar).getByRole('button', { name: /Split/ }).hasAttribute('disabled')).toBe(true) // one spelling
    fireEvent.click(within(bar).getByRole('button', { name: /Rename/ }))
    const input = within(dialog()).getByRole('textbox')
    fireEvent.change(input, { target: { value: '  Acme, LLC  ' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Rename' }))
    await screen.findByText('Renamed to Acme, LLC.')
    expect(bodies).toEqual([{ vendorId: 'v-acme', name: 'Acme, LLC' }])
  })

  it('Merge with…: pick the other vendor from the searchable list, then confirm', async () => {
    asController()
    mount()
    await screen.findByRole('list', { name: 'Possible duplicate vendors' })
    fireEvent.click(within(list()).getByRole('button', { name: /ACME LLC/ }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Manage ACME LLC' })).getByRole('button', { name: /Merge with/ }))
    const merge = within(dialog()).getByRole('button', { name: 'Merge' })
    expect(merge.hasAttribute('disabled')).toBe(true)
    const combo = within(dialog()).getByRole('combobox', { name: 'Vendor to merge with' })
    fireEvent.focus(combo)
    fireEvent.change(combo, { target: { value: 'ZAP' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /ZAP MANUFACTURING INC\./ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Merge' }))
    await screen.findByText(/^Merged ZAP MANUFACTURING INC\. into ACME LLC\.$/)
    expect(bodies).toEqual([{ targetId: 'v-acme', sourceId: 'v-zap' }])
  })

  it('Split: tick spellings, the new name defaults to the first ticked; ticking every spelling is refused', async () => {
    asController()
    postReply = () => ({ success: true, data: { vendorId: 'v-new' } })
    mount()
    await screen.findByRole('list', { name: 'Possible duplicate vendors' })
    fireEvent.click(within(list()).getByRole('button', { name: /ZAP MANUFACTURING INC\./ }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Manage ZAP MANUFACTURING INC.' })).getByRole('button', { name: /Split/ }))
    const d = dialog()
    const [one, two] = within(d).getAllByRole('checkbox')
    expect(d.textContent).toContain('2 lines in TCS')
    fireEvent.click(one)
    fireEvent.click(two)
    expect(d.textContent).toContain('Leave at least one spelling')
    expect(within(d).getByRole('button', { name: /Split off/ }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(two)
    expect((within(d).getByRole('textbox') as HTMLInputElement).value).toBe('ZAP MANUFACTURING INC')
    fireEvent.click(within(d).getByRole('button', { name: 'Split off' }))
    await screen.findByText('Split one spelling off into ZAP MANUFACTURING INC.')
    expect(bodies).toEqual([{ vendorId: 'v-zap', aliasIds: ['al-zap1'], name: 'ZAP MANUFACTURING INC' }])
  })

  it('a refusal from the server is shown in an in-app alert, and the dialog stays open', async () => {
    asController()
    postReply = () => ({ success: false, error: 'Another vendor already uses that name. Choose a different name for the new vendor.', code: 'NAME_TAKEN' })
    mount()
    await screen.findByRole('list', { name: 'Possible duplicate vendors' })
    fireEvent.click(within(list()).getByRole('button', { name: /ZAP MANUFACTURING INC\./ }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Manage ZAP MANUFACTURING INC.' })).getByRole('button', { name: /Split/ }))
    fireEvent.click(within(dialog()).getAllByRole('checkbox')[1])
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Split off' }))
    expect(await screen.findByText(/Another vendor already uses that name/)).toBeTruthy()
    expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0)
  })
})
