// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import CmrRollupClient from './CmrRollupClient'
import { DialogProvider } from '@/components/ui/DialogProvider'
import type { CmrRollupVendorState, CmrRollupView } from '@/lib/cmr/rollup'

/**
 * Weekly rollup screen: every role reads the week; only a Controller gets Add, and Add opens the
 * pick-a-target dialog rather than writing anything on its own. The account filter re-cuts the
 * by-frequency figures and the due list in the browser, with no second request.
 */

const WEEK = '2026-09-13'
const ACC = { TCS: 'acc-tcs', STS: 'acc-sts' }

let view: CmrRollupView
let calls: { method: string; url: string; body: unknown }[]
let placeFails: { error: string; code?: string } | null

const v = (over: Partial<CmrRollupVendorState> & { vendorId: string }): CmrRollupVendorState => ({
  vendorName: over.vendorId,
  accountId: ACC.TCS,
  accountName: 'TCS',
  accountActive: true,
  section: 'weekly',
  scheduleText: 'Every Thursday',
  amountCents: 120_00,
  lastAmountSentCents: null,
  suggestedCents: 120_00,
  notes: null,
  active: true,
  onHold: false,
  scheduleComplete: true,
  state: 'due',
  occurrenceDate: '2026-09-17',
  handledBy: null,
  ...over,
})

const makeView = (canEdit: boolean): CmrRollupView => ({
  weekStart: WEEK,
  weekEnd: '2026-09-19',
  today: '2026-09-16',
  thisWeekStart: WEEK,
  days: ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'].map((date) => ({
    date,
    am: null,
    pm:
      date === '2026-09-16'
        ? { period: 'pm' as const, beginningCashCents: 1000_00, adjustmentsTotalCents: 0, pendingRollupCents: 250_00, currentBalanceCents: 750_00 }
        : null,
  })),
  cash: {
    snapshotCount: 1,
    openingDate: '2026-09-16',
    openingPeriod: 'pm',
    openingCents: 1000_00,
    closingDate: '2026-09-16',
    closingPeriod: 'pm',
    closingCents: 750_00,
  },
  pending: { totalCents: 250_00, paidCents: 0, openCents: 250_00, count: 1, openCount: 1 },
  priorities: { neededCents: 500_00, paidResolvedCents: 0, totalCents: 500_00, count: 1, openCount: 1, openTopPriorityCount: 0 },
  accounts: [
    { id: ACC.TCS, name: 'TCS', active: true, sortOrder: 0 },
    { id: ACC.STS, name: 'STS', active: true, sortOrder: 1 },
  ],
  recurring: [
    v({ vendorId: 'Fuel card' }),
    v({
      vendorId: 'Yard rent', section: 'monthly', scheduleText: 'The 15th of each month',
      accountId: ACC.STS, accountName: 'STS', amountCents: 2500_00, lastAmountSentCents: 2499_99,
      suggestedCents: 2499_99, occurrenceDate: '2026-09-15', notes: 'Landlord: Bob',
    }),
    v({ vendorId: 'Old permit', section: 'annually', scheduleText: 'The 1st of September each year', amountCents: 750_00, suggestedCents: 750_00, occurrenceDate: '2026-09-01', state: 'handled', handledBy: 'pending' }),
    v({ vendorId: 'IRS plan', section: 'urgent', scheduleText: 'No fixed schedule', state: 'unscheduled', occurrenceDate: null, scheduleComplete: true }),
  ],
  canEdit,
})

const json = (data: unknown) => Promise.resolve({ status: 200, json: () => Promise.resolve(data) })

beforeEach(() => {
  view = makeView(true)
  calls = []
  placeFails = null
  window.confirm = vi.fn(() => true)
  window.alert = vi.fn()
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0 }) as typeof requestAnimationFrame
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (url.startsWith('/api/cmr/rollup')) return json({ success: true, data: view })
    if (url === '/api/cmr/recurring/place') {
      if (placeFails) return json({ success: false, ...placeFails })
      return json({ success: true, data: { placedKind: body.target, placedRefId: 'x', where: 'somewhere' } })
    }
    return json({ success: false, error: `unexpected ${method} ${url}` })
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const mount = () => render(<DialogProvider><CmrRollupClient initialWeek={WEEK} /></DialogProvider>)
const dueList = () => screen.getByRole('list', { name: 'Recurring vendors due this week' })
const dueNames = () => within(dueList()).getAllByRole('listitem').map((li) => li.querySelector('.nm')?.textContent)
const freqRow = (label: string) =>
  within(screen.getByRole('list', { name: 'Recurring totals by frequency' }))
    .getAllByRole('listitem')
    .find((li) => li.querySelector('.nm')?.textContent === label)!

describe('CmrRollupClient — the week', () => {
  it('shows the cash picture, labelled with the snapshot it came from', async () => {
    mount()
    expect(await screen.findByText(/Balance at Wed, Sep 16 PM/)).toBeTruthy()
    // The headline balance and the day row it came from both read $750.00.
    expect(screen.getAllByText((_t, el) => el?.textContent?.replace(/\s/g, '') === '$750.00').length).toBeGreaterThan(0)
    expect(screen.getByText(/Opened at/)).toBeTruthy()
    expect(screen.getByText('$1,000.00')).toBeTruthy()
    // Seven days, whether or not anything was saved on them.
    expect(within(screen.getByRole('list', { name: 'Each day of the week' })).getAllByRole('listitem')).toHaveLength(7)
  })

  it('lists what is due, soonest first, and leaves handled and urgent out', async () => {
    mount()
    await screen.findByText('Fuel card')
    expect(dueNames()).toEqual(['Yard rent', 'Fuel card'])
    expect(within(dueList()).queryByText('Old permit')).toBeNull()
    expect(within(dueList()).queryByText('IRS plan')).toBeNull()
  })

  it('shows the amount that would actually be entered', async () => {
    mount()
    await screen.findByText('Yard rent')
    const row = within(dueList()).getAllByRole('listitem')[0]
    expect(within(row).getByText('$2,499.99')).toBeTruthy()
    expect(within(row).getByText('last sent')).toBeTruthy()
  })

  it('totals each frequency and the whole week', async () => {
    mount()
    await screen.findByText('Fuel card')
    expect(freqRow('Weekly').textContent).toMatch(/1 vendor/)
    expect(within(freqRow('Monthly')).getByText('$2,499.99')).toBeTruthy()
    expect(freqRow('Quarterly').textContent).toMatch(/No vendors/)
    expect(within(freqRow('Due this week')).getByText('$2,619.99')).toBeTruthy()
  })

  it('the account filter re-cuts the figures without another request', async () => {
    mount()
    await screen.findByText('Fuel card')
    const before = calls.filter((c) => c.url.startsWith('/api/cmr/rollup')).length

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by account' }), { target: { value: ACC.STS } })
    await waitFor(() => expect(dueNames()).toEqual(['Yard rent']))
    expect(within(freqRow('Weekly')).getByText('No vendors')).toBeTruthy()
    expect(within(freqRow('Due this week')).getByText('$2,499.99')).toBeTruthy()
    expect(calls.filter((c) => c.url.startsWith('/api/cmr/rollup')).length).toBe(before)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by account' }), { target: { value: '' } })
    await waitFor(() => expect(dueNames()).toEqual(['Yard rent', 'Fuel card']))
  })
})

describe('CmrRollupClient — who can add', () => {
  it('a read-only role sees the week but no Add, and is told why', async () => {
    view = makeView(false)
    mount()
    await screen.findByText('Fuel card')
    expect(screen.getByText(/Only a Controller can add a due vendor/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull()
    expect(dueNames()).toEqual(['Yard rent', 'Fuel card'])
  })

  it('Add opens the dialog and writes nothing until it is confirmed', async () => {
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('button', { name: 'Add Fuel card to the ledger' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Fuel card' })
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    // It pre-fills the scheduled day, and the choice of target is the Controller's.
    expect((within(dialog).getByLabelText('Day') as HTMLInputElement).value).toBe('2026-09-17')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to that day' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        id: 'Fuel card', week: WEEK, target: 'pending', date: '2026-09-17', period: 'am',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('can send it to a week instead', async () => {
    mount()
    await screen.findByText('Yard rent')
    fireEvent.click(screen.getByRole('button', { name: 'Add Yard rent to the ledger' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Yard rent' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly priority' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to that week' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        id: 'Yard rent', week: WEEK, target: 'priority', weekStart: WEEK,
      }),
    )
  })

  it('Escape closes the dialog without adding anything', async () => {
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('button', { name: 'Add Fuel card to the ledger' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('a refusal is shown in-app and the week is reloaded', async () => {
    placeFails = { error: 'Fuel card has already been added for this period.', code: 'ALREADY_HANDLED' }
    mount()
    await screen.findByText('Fuel card')
    const before = calls.filter((c) => c.url.startsWith('/api/cmr/rollup')).length
    fireEvent.click(screen.getByRole('button', { name: 'Add Fuel card to the ledger' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add to that day' }))

    expect(await screen.findByText(/already been added for this period/)).toBeTruthy()
    expect(window.alert).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /OK|Close|Dismiss/ }))
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/cmr/rollup')).length).toBeGreaterThan(before))
  })
})

describe('CmrRollupClient — the week navigator', () => {
  it('asks the API for the week in the address', async () => {
    mount()
    await screen.findByText('Fuel card')
    expect(calls[0].url).toBe(`/api/cmr/rollup?week=${WEEK}`)
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/cmr/rollup?week=2026-09-06')).toBe(true))
  })
})
