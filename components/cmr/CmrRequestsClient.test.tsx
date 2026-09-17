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
    }),
    rq('nope', { vendor: 'Already declined', status: 'declined', createdAt: '2026-09-15T11:00:00Z' }),
  ]
  canEdit = true
  canRequest = true
  calls = []
  placeFails = null
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
      Object.assign(row, { status: 'placed', placedKind: body.target, placedRefId: 'ref', placedAt: '2026-09-16T12:00:00Z', placedByName: 'Mason Doty' })
      return json({ success: true, data: { request: row, placedKind: body.target, placedRefId: 'ref', where: body.target === 'pending' ? `${body.date} ${body.period}` : 'Sep 13 – 19' } })
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

  it('a settled request is read-only for everyone, and says where it went', async () => {
    mount()
    await ready()
    const placed = within(rowFor('Already placed'))
    expect(placed.getByText('Placed')).toBeTruthy()
    expect(placed.getByText('Daily pending')).toBeTruthy()
    expect(placed.queryByRole('button')).toBeNull()
    const declined = within(rowFor('Already declined'))
    expect(declined.getByText('Declined')).toBeTruthy()
    expect(declined.queryByRole('button')).toBeNull()
  })
})

// ── submitting ──────────────────────────────────────────────────────────────

describe('submitting', () => {
  it('submits vendor + account + amount and never sends a requestedBy', async () => {
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Submit a vendor payment request' }))
    const form = await screen.findByRole('form', { name: 'New vendor payment request' })
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
    fireEvent.submit(form)
    await screen.findByText('Enter a vendor name.')
    expect(writes()).toHaveLength(0)
  })
})

// ── editing and withdrawing ─────────────────────────────────────────────────

describe('editing and withdrawing', () => {
  it('a requester edits their own request', async () => {
    canEdit = false
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
