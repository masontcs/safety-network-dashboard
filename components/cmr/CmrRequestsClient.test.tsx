// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import CmrRequestsClient from './CmrRequestsClient'
import { DialogProvider } from '@/components/ui/DialogProvider'
import { computeRequestTotals, type CmrRequest, type CmrRequestsView } from '@/lib/cmr/requests'

vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

/**
 * Vendor requests screen. What matters here is that the CONTROLS match the role — a Viewer gets
 * no form and no row buttons, a Requester gets the form plus Edit/Withdraw on their OWN queued
 * rows only (never Place or Decline), and the Controller gets Place + Decline on everything.
 * Hiding a control is cosmetic (the API re-checks), but showing the wrong one is how a user
 * discovers a 403 the hard way.
 *
 * Also: Place opens an in-app dialog (never window.prompt/confirm) pre-filled from the due date,
 * with Pending (day + AM/PM) and Priority (week) targets; Withdraw and Decline go through the
 * root DialogProvider.
 */

const ME = 'u-me'
const THEM = 'u-them'
const ACC = { TCS: 'a-tcs', SIGNS: 'a-signs', OLD: 'a-old' }

let store: CmrRequest[]
let canEdit: boolean
let canRequest: boolean
let calls: { method: string; url: string; body: any }[] // eslint-disable-line @typescript-eslint/no-explicit-any
let placeFails: string | null
let unplaceFails: string | null

const rq = (id: string, over: Partial<CmrRequest> = {}): CmrRequest => ({
  id,
  requestedBy: ME,
  requestedByName: 'Jordan Requester',
  accountId: ACC.TCS,
  accountName: 'TCS',
  accountActive: true,
  vendor: `Vendor ${id}`,
  amountCents: 0,
  dueDate: null,
  notes: null,
  status: 'queued',
  placedKind: null,
  placedRefId: null,
  placedAt: null,
  placedBy: null,
  placedByName: null,
  createdAt: '2026-09-15T15:00:00Z',
  canUnplace: false,
  unplaceBlockedReason: null,
  invoices: [],
  fromAp: false,
  staleInvoiceCount: 0,
  ...over,
})

const viewNow = (): CmrRequestsView => {
  const queued = store.filter((r) => r.status === 'queued')
  const history = store.filter((r) => r.status !== 'queued')
  return {
    queued,
    history,
    totals: computeRequestTotals(queued, history, ME),
    accounts: [
      { id: ACC.TCS, name: 'TCS', accountType: 'Checking', active: true, sortOrder: 0 },
      { id: ACC.SIGNS, name: 'Signs', accountType: null, active: true, sortOrder: 1 },
      { id: ACC.OLD, name: 'Old Account', accountType: null, active: false, sortOrder: 2 },
    ],
    today: '2026-09-16',
    thisWeekStart: '2026-09-13',
    canEdit,
    canRequest,
    userId: ME,
  }
}

// The picker's A/P: TCS has an import (TRAFFIX with a credit, ZAP bills-only); Signs has none.
const apl = (id: string, vendorName: string, invoiceNum: string, docType: string, cents: number) => ({
  id, importId: 'imp-tcs', accountId: ACC.TCS, vendorName, invoiceNum, docType, billDate: '2025-11-24', dueDate: '2025-12-04',
  agingDays: 292, agingBucket: '> 90', openBalanceCents: cents, payable: true,
})
const TRX = [apl('l-103', 'TRAFFIX DEVICES', '4092103', 'Bill', 293_080), apl('l-104', 'TRAFFIX DEVICES', '4092104', 'Bill', 1_530_050), apl('l-cm', 'TRAFFIX DEVICES', 'CM', 'Credit', -600_814)]
const ZAP = [apl('l-9421', 'ZAP MANUFACTURING INC.', '9421', 'Bill', 171_000)]
const group = (vendorName: string, lines: ReturnType<typeof apl>[]) => ({
  key: `${ACC.TCS}\u0000${vendorName}`, accountId: ACC.TCS, accountName: 'TCS', vendorName,
  owedCents: lines.reduce((s, l) => s + l.openBalanceCents, 0),
  billCount: lines.filter((l) => l.docType === 'Bill').length, creditCount: lines.filter((l) => l.docType === 'Credit').length,
  oldestAgingDays: 292, lines,
})
const pickerFor = (accountId: string) =>
  accountId === ACC.TCS
    ? {
        account: { id: ACC.TCS, name: 'TCS', active: true, sortOrder: 0 },
        import: { id: 'imp-tcs', importedAt: '2026-09-22T20:05:39Z', sourceFilename: 'TCS AP 92226.xlsx' },
        vendors: [group('TRAFFIX DEVICES', TRX), group('ZAP MANUFACTURING INC.', ZAP)],
      }
    : { account: { id: accountId, name: 'Signs', active: true, sortOrder: 1 }, import: null, vendors: [] }

const json = (data: unknown, status = 200) => Promise.resolve({ status, json: () => Promise.resolve(data) })

beforeEach(() => {
  store = [
    rq('mine', { vendor: 'Sunbelt Rentals', amountCents: 125_000, dueDate: '2026-09-18', notes: 'Credit hold' }),
    rq('mine2', { vendor: 'Call the bank', createdAt: '2026-09-15T16:00:00Z' }),
    rq('theirs', { requestedBy: THEM, requestedByName: 'Russ Requester', vendor: 'Wells Fargo', amountCents: 3_200_000, accountId: ACC.SIGNS, accountName: 'Signs', createdAt: '2026-09-15T17:00:00Z' }),
    rq('done', {
      vendor: 'Already placed',
      amountCents: 5_000,
      status: 'placed',
      placedKind: 'pending',
      placedRefId: 'p1',
      placedAt: '2026-09-15T18:00:00Z',
      placedBy: THEM,
      placedByName: 'Mason Doty',
      createdAt: '2026-09-15T12:00:00Z',
      canUnplace: true,
    }),
    rq('nope', { vendor: 'Already declined', status: 'declined', createdAt: '2026-09-15T11:00:00Z' }),
  ]
  canEdit = true
  canRequest = true
  calls = []
  placeFails = null
  unplaceFails = null
  window.confirm = vi.fn(() => true)
  window.alert = vi.fn()
  window.prompt = vi.fn(() => 'x')
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0 }) as typeof requestAnimationFrame
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const u = new URL(url, 'https://cmr.example')

    if (u.pathname === '/api/cmr/requests' && method === 'GET') return json({ success: true, data: viewNow() })
    if (u.pathname === '/api/cmr/ap/vendors') return json({ success: true, data: pickerFor(u.searchParams.get('accountId')!) })
    if (u.pathname === '/api/cmr/requests' && method === 'POST') {
      const added = rq(`new-${store.length}`, { vendor: body.vendor, amountCents: body.amountCents ?? 0, accountId: body.accountId, dueDate: body.dueDate ?? null, notes: body.notes ?? null })
      store.push(added)
      return json({ success: true, data: { request: added } }, 201)
    }
    if (u.pathname === '/api/cmr/requests' && method === 'PATCH') {
      const row = store.find((r) => r.id === body.id)!
      Object.assign(row, body.vendor !== undefined ? { vendor: body.vendor } : {}, body.amountCents !== undefined ? { amountCents: body.amountCents } : {})
      return json({ success: true, data: { request: row, changed: true } })
    }
    if (u.pathname === '/api/cmr/requests' && method === 'DELETE') {
      store = store.filter((r) => r.id !== u.searchParams.get('id'))
      return json({ success: true, data: { deleted: true } })
    }
    if (u.pathname === '/api/cmr/requests/place') {
      if (placeFails) return json({ success: false, error: placeFails, code: 'NOT_QUEUED' }, 409)
      const row = store.find((r) => r.id === body.id)!
      Object.assign(row, { status: 'placed', placedKind: body.target, placedRefId: 'ref', placedAt: '2026-09-16T12:00:00Z', placedByName: 'Mason Doty', canUnplace: true, unplaceBlockedReason: null })
      return json({ success: true, data: { request: row, placedKind: body.target, placedRefId: 'ref', where: body.target === 'pending' ? `${body.date} ${body.period}` : 'Sep 13 – 19' } })
    }
    if (u.pathname === '/api/cmr/requests/unplace') {
      if (unplaceFails) return json({ success: false, error: unplaceFails, code: 'ROW_PAID' }, 409)
      const row = store.find((r) => r.id === body.id)!
      Object.assign(row, {
        status: 'queued',
        placedKind: null,
        placedRefId: null,
        placedAt: null,
        placedBy: null,
        placedByName: null,
        canUnplace: false,
        unplaceBlockedReason: null,
      })
      return json({ success: true, data: { request: row, removedRowId: 'ref' } })
    }
    if (u.pathname === '/api/cmr/requests/decline') {
      const row = store.find((r) => r.id === body.id)!
      Object.assign(row, { status: 'declined' })
      return json({ success: true, data: { request: row } })
    }
    return json({ success: false, error: `unexpected ${method} ${u.pathname}` }, 500)
  }) as unknown as typeof fetch
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const mount = () => render(<DialogProvider><CmrRequestsClient /></DialogProvider>)
const ready = async () => { await screen.findByText('Sunbelt Rentals') }
const rowFor = (vendor: string) => screen.getByText(vendor).closest('li') as HTMLElement
const writes = () => calls.filter((c) => c.method !== 'GET')

// ── what each role sees ─────────────────────────────────────────────────────

describe('role → controls', () => {
  it('CONTROLLER: Place + Decline on every queued row, Edit + Withdraw too', async () => {
    mount()
    await ready()
    for (const v of ['Sunbelt Rentals', 'Call the bank', 'Wells Fargo']) {
      const row = within(rowFor(v))
      expect(row.getByRole('button', { name: `Place the request for ${v}` })).toBeTruthy()
      expect(row.getByRole('button', { name: `Decline the request for ${v}` })).toBeTruthy()
      expect(row.getByRole('button', { name: `Edit the request for ${v}` })).toBeTruthy()
      expect(row.getByRole('button', { name: `Withdraw the request for ${v}` })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'Submit a vendor payment request' })).toBeTruthy()
  })

  it('REQUESTER: form + Edit/Withdraw on their OWN rows only, and NEVER Place or Decline', async () => {
    canEdit = false
    mount()
    await ready()
    expect(screen.getByRole('button', { name: 'Submit a vendor payment request' })).toBeTruthy()

    for (const v of ['Sunbelt Rentals', 'Call the bank']) {
      const row = within(rowFor(v))
      expect(row.getByRole('button', { name: `Edit the request for ${v}` })).toBeTruthy()
      expect(row.getByRole('button', { name: `Withdraw the request for ${v}` })).toBeTruthy()
    }
    // Someone else's queued request: readable, untouchable.
    const theirs = within(rowFor('Wells Fargo'))
    expect(theirs.queryByRole('button', { name: /Edit the request/ })).toBeNull()
    expect(theirs.queryByRole('button', { name: /Withdraw the request/ })).toBeNull()

    expect(screen.queryByRole('button', { name: /^Place the request/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Decline the request/ })).toBeNull()
  })

  it('VIEWER: reads the queue and the history, and gets no controls at all', async () => {
    canEdit = false
    canRequest = false
    mount()
    await ready()
    expect(screen.getByText('Wells Fargo')).toBeTruthy()
    expect(screen.getByText('Already placed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit a vendor payment request' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Place the request/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Decline the request/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit the request/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Withdraw the request/ })).toBeNull()
    expect(screen.getByText(/Only a Controller or a Requester can submit/)).toBeTruthy()
  })

  it('a settled request says where it went; only a Controller gets Undo placement, and only on a placed one', async () => {
    mount()
    await ready()
    const placed = within(rowFor('Already placed'))
    expect(placed.getByText('Placed')).toBeTruthy()
    expect(placed.getByText('Daily pending')).toBeTruthy()
    // The one control a settled row ever has — and the fixture says its line is still untouched.
    expect(placed.getByRole('button', { name: 'Undo the placement of Already placed' })).toBeTruthy()
    const declined = within(rowFor('Already declined'))
    expect(declined.getByText('Declined')).toBeTruthy()
    expect(declined.queryByRole('button')).toBeNull()
  })

  it('a requester or viewer never sees Undo placement', async () => {
    canEdit = false
    mount()
    await ready()
    expect(screen.queryByRole('button', { name: /^Undo the placement/ })).toBeNull()
  })

  it('Undo placement is disabled, with the reason on the row, once the line was paid or moved', async () => {
    store = store.map((r) =>
      r.vendor === 'Already placed'
        ? { ...r, canUnplace: false, unplaceBlockedReason: 'It was already paid — undoing would erase the payment. Mark it unpaid first.' }
        : r,
    )
    mount()
    await ready()
    const placed = within(rowFor('Already placed'))
    expect((placed.getByRole('button', { name: 'Undo the placement of Already placed' }) as HTMLButtonElement).disabled).toBe(true)
    expect(placed.getByText(/Can’t be undone: It was already paid/)).toBeTruthy()
  })
})

// ── submitting ──────────────────────────────────────────────────────────────

describe('submitting', () => {
  it('CONTROLLER “Enter by hand”: submits vendor + account + amount and never sends a requestedBy', async () => {
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Submit a vendor payment request' }))
    const form = await screen.findByRole('form', { name: 'New vendor payment request' })
    fireEvent.click(within(form).getByRole('button', { name: 'Enter by hand' }))
    fireEvent.change(within(form).getByRole('textbox', { name: 'Vendor' }), { target: { value: 'Pacific Gas' } })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Account' }), { target: { value: ACC.SIGNS } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Amount (optional)' }), { target: { value: '1234.50' } })
    fireEvent.submit(form)

    await waitFor(() => expect(writes().some((c) => c.method === 'POST')).toBe(true))
    const post = writes().find((c) => c.method === 'POST')!
    expect(post.body).toMatchObject({ vendor: 'Pacific Gas', accountId: ACC.SIGNS, amountCents: 123_450 })
    expect(post.body).not.toHaveProperty('requestedBy')
    expect(post.body).not.toHaveProperty('status')
  })

  it('the account picker offers ACTIVE accounts only', async () => {
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Submit a vendor payment request' }))
    const select = await screen.findByRole('combobox', { name: 'Account' })
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options.some((t) => t?.includes('TCS'))).toBe(true)
    expect(options.some((t) => t?.includes('Old Account'))).toBe(false)
  })

  it('an empty vendor is refused in the browser, nothing is sent', async () => {
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Submit a vendor payment request' }))
    const form = await screen.findByRole('form', { name: 'New vendor payment request' })
    fireEvent.click(within(form).getByRole('button', { name: 'Enter by hand' }))
    fireEvent.submit(form)
    await screen.findByText('Enter a vendor name.')
    expect(writes()).toHaveLength(0)
  })
})

// ── editing and withdrawing ─────────────────────────────────────────────────

describe('editing and withdrawing', () => {
  it('a requester edits the note of their own (hand-entered, pre-A/P) request — no amount field, no re-compose', async () => {
    canEdit = false
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the request for Sunbelt Rentals' }))
    const form = await screen.findByRole('form', { name: 'Edit the request for Sunbelt Rentals' })
    expect(within(form).queryByRole('textbox', { name: 'Amount (optional)' })).toBeNull()
    expect(within(form).getByText(/This request was entered by hand/)).toBeTruthy()
    fireEvent.change(within(form).getByRole('textbox', { name: /Notes/ }), { target: { value: 'Called them' } })
    fireEvent.submit(form)
    await waitFor(() => expect(writes().some((c) => c.method === 'PATCH')).toBe(true))
    expect(writes().find((c) => c.method === 'PATCH')!.body).toEqual({ id: 'mine', notes: 'Called them' })
  })

  it('a requester cannot silently move a hand-entered request to another account without picking invoices', async () => {
    canEdit = false
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the request for Sunbelt Rentals' }))
    const form = await screen.findByRole('form', { name: 'Edit the request for Sunbelt Rentals' })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Account' }), { target: { value: ACC.SIGNS } })
    fireEvent.submit(form)
    await within(form).findByText(/To move this request to another account/)
    expect(writes()).toHaveLength(0)
  })

  it('a CONTROLLER still hand-edits a hand-entered request', async () => {
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the request for Sunbelt Rentals' }))
    const form = await screen.findByRole('form', { name: 'Edit the request for Sunbelt Rentals' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Amount (optional)' }), { target: { value: '999.00' } })
    fireEvent.submit(form)
    await waitFor(() => expect(writes().some((c) => c.method === 'PATCH')).toBe(true))
    expect(writes().find((c) => c.method === 'PATCH')!.body).toMatchObject({ id: 'mine', amountCents: 99_900 })
  })

  it('withdrawing asks in-app first — never window.confirm', async () => {
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw the request for Sunbelt Rentals' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Withdraw the request for Sunbelt Rentals\?/)).toBeTruthy()
    expect(window.confirm).not.toHaveBeenCalled()
    expect(writes()).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw request' }))
    await waitFor(() => expect(writes().some((c) => c.method === 'DELETE')).toBe(true))
    expect(writes().find((c) => c.method === 'DELETE')!.url).toContain('id=mine')
    await waitFor(() => expect(screen.queryByText('Sunbelt Rentals')).toBeNull())
  })

  it('cancelling the withdraw confirm changes nothing', async () => {
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw the request for Sunbelt Rentals' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(writes()).toHaveLength(0)
    expect(screen.getByText('Sunbelt Rentals')).toBeTruthy()
  })
})

// ── placing ─────────────────────────────────────────────────────────────────

describe('the Place dialog', () => {
  const openPlace = async (vendor = 'Sunbelt Rentals') => {
    fireEvent.click(screen.getByRole('button', { name: `Place the request for ${vendor}` }))
    return screen.findByRole('dialog')
  }

  it('opens in-app, pre-filled from the request’s due date, and sends the pending target', async () => {
    mount()
    await ready()
    const dialog = await openPlace()
    expect(window.prompt).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/Place Sunbelt Rentals/)).toBeTruthy()
    // Pre-filled with the request's own due date, AM.
    const day = within(dialog).getByLabelText('Day') as HTMLInputElement
    expect(day.value).toBe('2026-09-18')

    fireEvent.click(within(dialog).getByRole('button', { name: 'PM' }))
    fireEvent.change(day, { target: { value: '2026-09-17' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Add to that day/ }))

    await waitFor(() => expect(writes().some((c) => c.url.includes('/place'))).toBe(true))
    expect(writes().find((c) => c.url.includes('/place'))!.body).toEqual({
      id: 'mine',
      target: 'pending',
      date: '2026-09-17',
      period: 'pm',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('switches to the weekly-priority target and sends that week’s Sunday', async () => {
    mount()
    await ready()
    const dialog = await openPlace()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly priority' }))
    const week = within(dialog).getByLabelText('Week') as HTMLInputElement
    expect(week.value).toBe('2026-09-13') // the Sunday of the due date's week
    fireEvent.change(week, { target: { value: '2026-09-24' } }) // a Thursday
    expect((within(dialog).getByLabelText('Week') as HTMLInputElement).value).toBe('2026-09-20')
    fireEvent.click(within(dialog).getByRole('button', { name: /Add to that week/ }))

    await waitFor(() => expect(writes().some((c) => c.url.includes('/place'))).toBe(true))
    expect(writes().find((c) => c.url.includes('/place'))!.body).toEqual({ id: 'mine', target: 'priority', weekStart: '2026-09-20' })
  })

  it('a request with no due date falls back to today / this week', async () => {
    mount()
    await ready()
    const dialog = await openPlace('Call the bank')
    expect((within(dialog).getByLabelText('Day') as HTMLInputElement).value).toBe('2026-09-16')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly priority' }))
    expect((within(dialog).getByLabelText('Week') as HTMLInputElement).value).toBe('2026-09-13')
  })

  it('Cancel and Escape close it without placing anything', async () => {
    mount()
    await ready()
    const dialog = await openPlace()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes()).toHaveLength(0)

    await openPlace()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes()).toHaveLength(0)
  })

  it('a refused placement reports it and reloads instead of pretending', async () => {
    placeFails = 'That request has already been placed or declined.'
    mount()
    await ready()
    const dialog = await openPlace()
    fireEvent.click(within(dialog).getByRole('button', { name: /Add to that day/ }))
    await screen.findByText('That request has already been placed or declined.')
    expect(window.alert).not.toHaveBeenCalled()
  })
})

// ── declining ───────────────────────────────────────────────────────────────

describe('declining', () => {
  it('asks in-app, then moves the request into the history', async () => {
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Decline the request for Sunbelt Rentals' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Decline the request for Sunbelt Rentals\?/)).toBeTruthy()
    expect(window.confirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline request' }))

    await waitFor(() => expect(writes().some((c) => c.url.includes('/decline'))).toBe(true))
    expect(writes().find((c) => c.url.includes('/decline'))!.body).toEqual({ id: 'mine' })
    await waitFor(() => expect(within(rowFor('Sunbelt Rentals')).getByText('Declined')).toBeTruthy())
  })
})

// ── the queue itself ────────────────────────────────────────────────────────

describe('the queue', () => {
  it('shows the total asked for, marks the caller’s own rows, and flags an overdue one', async () => {
    mount()
    await ready()
    // 125,000 + 0 + 3,200,000 cents
    expect(screen.getAllByText('$33,250.00').length).toBeGreaterThan(0)
    expect(within(rowFor('Sunbelt Rentals')).getByText('Yours')).toBeTruthy()
    expect(within(rowFor('Wells Fargo')).queryByText('Yours')).toBeNull()
    // due 2026-09-18, today 2026-09-16 → not overdue
    expect(within(rowFor('Sunbelt Rentals')).queryByText('Overdue')).toBeNull()
  })

  it('an empty queue says so', async () => {
    store = store.filter((r) => r.status !== 'queued')
    mount()
    await screen.findByText(/Nothing waiting/)
  })

  it('a load failure offers Retry', async () => {
    global.fetch = vi.fn(() => json({ success: false, error: 'Database unavailable.' }, 500)) as unknown as typeof fetch
    mount()
    await screen.findByText('Database unavailable.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

// ── Phase 6: undoing a placement ────────────────────────────────────────────

describe('undo placement', () => {
  it('takes the request back to the queue after an in-app confirm (never window.confirm)', async () => {
    mount()
    await ready()
    fireEvent.click(within(rowFor('Already placed')).getByRole('button', { name: 'Undo the placement of Already placed' }))

    const ask = await screen.findByRole('alertdialog')
    expect(ask.textContent).toContain('Undo the placement of Already placed?')
    expect(ask.textContent).toContain('deletes the daily pending line')
    expect(window.confirm).not.toHaveBeenCalled()
    fireEvent.click(within(ask).getByRole('button', { name: 'Undo placement' }))

    await waitFor(() => expect(calls.some((c) => c.url === '/api/cmr/requests/unplace')).toBe(true))
    expect(calls.find((c) => c.url === '/api/cmr/requests/unplace')!.body).toMatchObject({ id: 'done' })
    // It is back in the queue, with the queue's controls again.
    await waitFor(() => expect(within(rowFor('Already placed')).getByRole('button', { name: 'Place the request for Already placed' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^Undo the placement/ })).toBeNull()
  })

  it('cancelling the confirm writes nothing', async () => {
    mount()
    await ready()
    fireEvent.click(within(rowFor('Already placed')).getByRole('button', { name: 'Undo the placement of Already placed' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.url === '/api/cmr/requests/unplace')).toBe(false)
    expect(within(rowFor('Already placed')).getByText('Placed')).toBeTruthy()
  })

  it('a refusal from the server is reported in-app and the row stays placed', async () => {
    unplaceFails = 'What this request became was already paid — undoing would erase the payment.'
    mount()
    await ready()
    fireEvent.click(within(rowFor('Already placed')).getByRole('button', { name: 'Undo the placement of Already placed' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Undo placement' }))
    await screen.findByText('Could not undo the placement')
    expect(window.alert).not.toHaveBeenCalled()
    expect(within(rowFor('Already placed')).getByText('Placed')).toBeTruthy()
  })

  it('a request just placed can be taken straight back', async () => {
    mount()
    await ready()
    fireEvent.click(within(rowFor('Sunbelt Rentals')).getByRole('button', { name: 'Place the request for Sunbelt Rentals' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add to that day' }))
    await waitFor(() => expect(within(rowFor('Sunbelt Rentals')).getByText('Placed')).toBeTruthy())

    fireEvent.click(within(rowFor('Sunbelt Rentals')).getByRole('button', { name: 'Undo the placement of Sunbelt Rentals' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Undo placement' }))
    await waitFor(() => expect(within(rowFor('Sunbelt Rentals')).getByRole('button', { name: 'Place the request for Sunbelt Rentals' })).toBeTruthy())
  })
})

// ── AP Phase 2: the A/P picker ──────────────────────────────────────────────

const openNew = async () => {
  mount()
  await ready()
  fireEvent.click(screen.getByRole('button', { name: 'Submit a vendor payment request' }))
  return screen.findByRole('form', { name: 'New vendor payment request' })
}
const pickVendor = async (form: HTMLElement, label: string) => {
  const box = await within(form).findByRole('combobox', { name: 'Vendor' })
  fireEvent.focus(box)
  fireEvent.mouseDown(await within(form).findByRole('option', { name: new RegExp(label) }))
}

describe('A/P picker (AP Phase 2)', () => {
  // jsdom has no scrollIntoView (the Combobox keeps its highlighted option in view).
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })

  it('REQUESTER: no free-text vendor or amount — account → vendor → tick invoices; credits subtract; submits ids, never an amount', async () => {
    canEdit = false
    const form = await openNew()
    expect(within(form).queryByRole('textbox', { name: 'Vendor' })).toBeNull()
    expect(within(form).queryByRole('textbox', { name: 'Amount (optional)' })).toBeNull()
    expect(within(form).queryByRole('button', { name: 'Enter by hand' })).toBeNull()
    expect(calls.some((c) => c.url.includes(`/api/cmr/ap/vendors?accountId=${ACC.TCS}`))).toBe(true)

    await pickVendor(form, 'TRAFFIX DEVICES')
    const list = await within(form).findByRole('list', { name: 'TRAFFIX DEVICES invoices' })
    fireEvent.click(within(list).getByRole('checkbox', { name: /Bill 4092103/ }))
    fireEvent.click(within(list).getByRole('checkbox', { name: /Bill 4092104/ }))
    fireEvent.click(within(list).getByRole('checkbox', { name: /Credit CM, −\$6,008\.14 \(subtracts\)/ }))
    // live total = Σ bills − Σ credits
    expect(within(form).getByText('$12,223.16')).toBeTruthy()
    expect(within(form).getByRole('button', { name: /Request \$12,223\.16/ })).toBeTruthy()

    fireEvent.submit(form)
    await waitFor(() => expect(writes().some((c) => c.method === 'POST')).toBe(true))
    const post = writes().find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ accountId: ACC.TCS, vendorName: 'TRAFFIX DEVICES', apLineIds: ['l-103', 'l-104', 'l-cm'], dueDate: null, notes: null })
  })

  it('a credit-only selection is refused in the browser — submit stays disabled', async () => {
    canEdit = false
    const form = await openNew()
    await pickVendor(form, 'TRAFFIX DEVICES')
    fireEvent.click(within(form).getByRole('checkbox', { name: /Credit CM/ }))
    expect(within(form).getByText(/The credits cancel out the bills/)).toBeTruthy()
    expect((within(form).getByRole('button', { name: 'Submit request' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('“Tick all bills” ticks bills only; switching vendor clears the ticks', async () => {
    canEdit = false
    const form = await openNew()
    await pickVendor(form, 'TRAFFIX DEVICES')
    fireEvent.click(within(form).getByRole('button', { name: 'Tick all 2 bills' }))
    expect((within(form).getByRole('checkbox', { name: /Bill 4092103/ }) as HTMLInputElement).checked).toBe(true)
    expect((within(form).getByRole('checkbox', { name: /Credit CM/ }) as HTMLInputElement).checked).toBe(false)
    expect(within(form).getByText('$18,231.30')).toBeTruthy()
    await pickVendor(form, 'ZAP MANUFACTURING INC.')
    expect((within(form).getByRole('checkbox', { name: /Bill 9421/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('an account with no A/P import says “Import … A/P first” and cannot be submitted', async () => {
    canEdit = false
    const form = await openNew()
    fireEvent.change(within(form).getByRole('combobox', { name: 'Account' }), { target: { value: ACC.SIGNS } })
    expect(await within(form).findByText('Import Signs’s A/P first.')).toBeTruthy()
    expect(within(form).queryByRole('link', { name: 'Accounts Payable' })?.getAttribute('href')).toBe('/cmr/ap')
    expect((within(form).getByRole('button', { name: 'Submit request' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('VIEWER: no form, no picker — the A/P picker is never even fetched', async () => {
    canEdit = false
    canRequest = false
    mount()
    await ready()
    expect(screen.queryByRole('button', { name: 'Submit a vendor payment request' })).toBeNull()
    expect(screen.queryByRole('form')).toBeNull()
    expect(calls.some((c) => c.url.includes('/api/cmr/ap/vendors'))).toBe(false)
  })

  it('lists a composed request’s invoices on its row and in the Place dialog, with the “no longer in current AP” hint', async () => {
    const inv = (id: string, num: string, docType: string, cents: number, inCurrentAp: boolean) => ({
      id, apLineId: null, vendorName: 'TRAFFIX DEVICES', invoiceNum: num, docType, billDate: '2025-11-24', dueDate: null,
      openBalanceCents: cents, inCurrentAp, currentApLineId: inCurrentAp ? `l-${num}` : null, currentBalanceCents: null,
    })
    store.push(rq('ap1', {
      vendor: 'TRAFFIX DEVICES', amountCents: 1_222_316, fromAp: true, staleInvoiceCount: 1, createdAt: '2026-09-15T19:00:00Z',
      invoices: [inv('i1', '4092103', 'Bill', 293_080, true), inv('i2', '4092104', 'Bill', 1_530_050, false), inv('i3', 'CM', 'Credit', -600_814, true)],
    }))
    mount()
    await ready()
    const row = within(rowFor('TRAFFIX DEVICES'))
    expect(row.getByText('3 invoices · 1 credit')).toBeTruthy()
    expect(row.getByText('1 no longer in current AP')).toBeTruthy()

    fireEvent.click(row.getByRole('button', { name: 'Place the request for TRAFFIX DEVICES' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Built from these 3 invoices')).toBeTruthy()
    for (const t of ['4092103', '4092104', 'Credit CM', '−$6,008.14', '$12,223.16']) expect(within(dialog).getAllByText(t).length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/no longer in current AP/)).toBeTruthy()
    expect(within(dialog).getByText(/You can still place it/)).toBeTruthy()
    // not blocked
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to that day' }))
    await waitFor(() => expect(writes().some((c) => c.url.endsWith('/api/cmr/requests/place'))).toBe(true))
  })

  it('editing a composed request pre-ticks its invoices still in A/P; a note-only change sends just the note', async () => {
    canEdit = false
    store.push(rq('ap2', {
      vendor: 'ZAP MANUFACTURING INC.', amountCents: 171_000, fromAp: true, accountId: ACC.TCS, createdAt: '2026-09-15T19:00:00Z',
      invoices: [{ id: 'i1', apLineId: null, vendorName: 'ZAP MANUFACTURING INC.', invoiceNum: '9421', docType: 'Bill', billDate: '2025-01-24', dueDate: null, openBalanceCents: 171_000, inCurrentAp: true, currentApLineId: 'l-9421', currentBalanceCents: null }],
    }))
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the request for ZAP MANUFACTURING INC.' }))
    const form = await screen.findByRole('form', { name: 'Edit the request for ZAP MANUFACTURING INC.' })
    const box = await within(form).findByRole('checkbox', { name: /Bill 9421/ })
    expect((box as HTMLInputElement).checked).toBe(true)
    fireEvent.change(within(form).getByRole('textbox', { name: /Notes/ }), { target: { value: 'Urgent' } })
    fireEvent.submit(form)
    await waitFor(() => expect(writes().some((c) => c.method === 'PATCH')).toBe(true))
    expect(writes().find((c) => c.method === 'PATCH')!.body).toEqual({ id: 'ap2', notes: 'Urgent' })
  })
})
