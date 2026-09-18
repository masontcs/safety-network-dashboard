// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import CmrRecurringClient from './CmrRecurringClient'
import { DialogProvider } from '@/components/ui/DialogProvider'
import type { CmrRecurringVendor } from '@/lib/cmr/recurring'

/**
 * Recurring screen behaviour: five frequency sections; read-only roles see data but no
 * controls; the Controller adds (dollars → cents, with the structured schedule its frequency
 * needs), edits (incl. last amount sent, changing frequency), holds, deactivates through the
 * in-app confirm (never window.confirm), and reorders a section with the full id list (rolled
 * back on failure).
 */

type V = CmrRecurringVendor
let vendors: V[]
let canEdit: boolean
let calls: { method: string; url: string; body: unknown }[]
let reorderFails = false

const mk = (id: string, vendorName: string, section: V['section'], sortOrder: number, over: Partial<V> = {}): V => ({
  id, vendorName, section, sortOrder,
  accountId: 'a1', accountName: 'TCS', accountActive: true,
  amountCents: 10000, lastAmountSentCents: null,
  schedule: { weekday: null, dayOfMonth: null, anchorMonth: null },
  scheduleComplete: section === 'urgent',
  planTerms: null, planDueDate: null, notes: null, onHold: false, active: true,
  createdAt: '2026-09-16T10:00:00Z',
  ...over,
})

/** A vendor with the schedule its frequency needs. */
const withSchedule = (
  id: string, vendorName: string, section: V['section'], sortOrder: number,
  schedule: Partial<V['schedule']>, over: Partial<V> = {},
): V =>
  mk(id, vendorName, section, sortOrder, {
    schedule: { weekday: null, dayOfMonth: null, anchorMonth: null, ...schedule },
    scheduleComplete: true,
    ...over,
  })
const accounts = [
  { id: 'a1', name: 'TCS', active: true, sortOrder: 0 },
  { id: 'a2', name: 'STS', active: true, sortOrder: 1 },
  { id: 'a3', name: 'Old Payroll', active: false, sortOrder: 2 },
]

const json = (data: unknown) => Promise.resolve({ status: 200, json: () => Promise.resolve(data) })

beforeEach(() => {
  vendors = [
    withSchedule('w1', 'Fuel card', 'weekly', 0, { weekday: 4 }, { amountCents: 120000 }),
    withSchedule('w2', 'Tire shop', 'weekly', 1, { weekday: 1 }, { amountCents: 45050, onHold: true, accountId: 'a2', accountName: 'STS' }),
    withSchedule('w3', 'Old uniforms', 'weekly', 2, { weekday: 2 }, { amountCents: 9900, active: false }),
    withSchedule('m1', 'Yard rent', 'monthly', 0, { dayOfMonth: 1 }, { amountCents: 250000, lastAmountSentCents: 249999, notes: 'Landlord: Bob' }),
    withSchedule('q1', 'Insurance premium', 'quarterly', 0, { dayOfMonth: 10, anchorMonth: 2 }, { amountCents: 500000 }),
    withSchedule('y1', 'Permit renewal', 'annually', 0, { dayOfMonth: 31, anchorMonth: 12 }, { amountCents: 75000 }),
    mk('u1', 'IRS plan', 'urgent', 0, { amountCents: 150000, planTerms: '$1,500/wk until paid', planDueDate: '2020-01-01' }),
  ]
  canEdit = true
  calls = []
  reorderFails = false
  window.confirm = vi.fn(() => true)
  window.alert = vi.fn()
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0 }) as typeof requestAnimationFrame
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (url === '/api/cmr/recurring' && method === 'GET') return json({ success: true, data: { vendors, accounts, canEdit } })
    if (url === '/api/cmr/recurring' && method === 'PATCH') {
      const b = body as Partial<V> & { id: string }
      vendors = vendors.map((v) => (v.id === b.id ? { ...v, ...b } : v))
      return json({ success: true, data: { vendor: vendors.find((v) => v.id === b.id), changed: true } })
    }
    if (url === '/api/cmr/recurring' && method === 'POST') {
      const b = body as Partial<V>
      const v = mk('n1', b.vendorName!, b.section!, 99, { ...b })
      vendors = [...vendors, v]
      return json({ success: true, data: { vendor: v } })
    }
    if (url === '/api/cmr/recurring/reorder') {
      if (reorderFails) return json({ success: false, error: 'Boom', code: 'INTERNAL_ERROR' })
      return json({ success: true, data: { changed: true } })
    }
    return json({ success: false, error: 'unexpected' })
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

const mount = () => render(<DialogProvider><CmrRecurringClient /></DialogProvider>)
const section = (name: string) => screen.getByRole('region', { name })
const namesIn = (name: string) =>
  within(section(name)).queryAllByRole('listitem').map((li) => li.querySelector('.nm')!.textContent)

describe('CmrRecurringClient — read-only roles', () => {
  it('shows all three sections with the data but no edit controls', async () => {
    canEdit = false
    mount()
    await screen.findByText('Fuel card')
    expect(namesIn('Weekly')).toEqual(['Fuel card', 'Tire shop', 'Old uniforms'])
    expect(namesIn('Monthly')).toEqual(['Yard rent'])
    expect(namesIn('Urgent Payment Plans')).toEqual(['IRS plan'])
    expect(screen.getByText(/Only a Controller can add or change them/)).toBeTruthy()

    // Data: amounts in dollars, last sent, notes, plan terms + due date, flags.
    expect(within(section('Weekly')).getByText('$1,200.00', { selector: '.amt' })).toBeTruthy()
    expect(screen.getByText('$2,499.99')).toBeTruthy()
    expect(screen.getByText('Landlord: Bob')).toBeTruthy()
    expect(screen.getByText('Plan: $1,500/wk until paid')).toBeTruthy()
    expect(screen.getByText(/Due Jan 1, 2020/)).toBeTruthy()
    expect(screen.getByText('Past due')).toBeTruthy()
    expect(within(section('Weekly')).getByText('On hold')).toBeTruthy()
    expect(within(section('Weekly')).getByText('Inactive')).toBeTruthy()
    // Active total excludes on-hold and inactive vendors.
    expect(within(section('Weekly')).getByText('$1,200.00', { selector: 'b' })).toBeTruthy()

    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Add a / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Reorder / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull()
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('a 403 (no grant) sends the browser to /cmr/no-access', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { set href(v: string) { assign(v) } }, configurable: true })
    global.fetch = vi.fn(() => json({ success: false, error: 'nope', code: 'FORBIDDEN' })) as unknown as typeof fetch
    mount()
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/cmr/no-access'))
  })
})

describe('CmrRecurringClient — controller', () => {
  it('deactivating asks with the in-app dialog, then PATCHes active=false', async () => {
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('switch', { name: 'Fuel card active' }))
    await screen.findByText('Deactivate Fuel card?')
    expect(window.confirm).not.toHaveBeenCalled()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ id: 'w1', active: false }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Fuel card active' }).getAttribute('aria-checked')).toBe('false'))
  })

  it('reactivating and holding need no confirmation; hold is its own flag', async () => {
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('switch', { name: 'Old uniforms active' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ id: 'w3', active: true }]))
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Fuel card on hold' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('switch', { name: 'Fuel card on hold' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toContainEqual({ id: 'w1', onHold: true }))
    expect(screen.queryByText('Deactivate Fuel card?')).toBeNull()
  })

  it('move-down sends that section’s full new order only', async () => {
    mount()
    await screen.findByText('Fuel card')
    expect((screen.getByRole('button', { name: 'Move Fuel card up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Move Yard rent down' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move Fuel card down' }))
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/reorder'))?.body).toEqual({ section: 'weekly', ids: ['w2', 'w1', 'w3'] }),
    )
    await waitFor(() => expect(namesIn('Weekly')).toEqual(['Tire shop', 'Fuel card', 'Old uniforms']))
    expect(namesIn('Monthly')).toEqual(['Yard rent'])
    expect(document.querySelector('p.cmr-sr-only[role="status"]')?.textContent).toBe('Fuel card moved to position 2 of 3 in Weekly.')
  })

  it('a failed reorder rolls back and shows the error in-app', async () => {
    reorderFails = true
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('button', { name: 'Move Tire shop up' }))
    await screen.findByText('Could not save the new order')
    expect(namesIn('Weekly')).toEqual(['Fuel card', 'Tire shop', 'Old uniforms'])
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('adds a vendor in a section: dollars become integer cents, account picker lists active accounts only', async () => {
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('button', { name: 'Add a Monthly vendor' }))
    const form = screen.getByRole('form', { name: 'New Monthly vendor' })
    const picker = within(form).getByRole('combobox', { name: 'Account' }) as HTMLSelectElement
    const choices = [...picker.options].filter((o) => !o.disabled).map((o) => o.textContent)
    expect(choices).toEqual(['TCS', 'STS'])
    // Plan fields only show for Urgent.
    expect(within(form).queryByRole('textbox', { name: /Plan terms/ })).toBeNull()

    // Validation stays in-app.
    fireEvent.click(within(form).getByRole('button', { name: /Add vendor/ }))
    expect(await within(form).findByRole('alert')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    fireEvent.change(within(form).getByRole('textbox', { name: 'Vendor' }), { target: { value: 'Insurance' } })
    fireEvent.change(picker, { target: { value: 'a2' } })
    const amount = within(form).getByRole('textbox', { name: 'Amount' })
    fireEvent.focus(amount)
    fireEvent.change(amount, { target: { value: '1234.5' } })
    fireEvent.blur(amount)
    // A monthly vendor asks for a day of the month — and only that.
    expect(within(form).queryByRole('combobox', { name: 'Day of the week' })).toBeNull()
    expect(within(form).queryByRole('combobox', { name: /month of the quarter/ })).toBeNull()
    fireEvent.change(within(form).getByRole('combobox', { name: 'Day of the month' }), { target: { value: '15' } })
    fireEvent.click(within(form).getByRole('button', { name: /Add vendor/ }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        vendorName: 'Insurance', accountId: 'a2', section: 'monthly', amountCents: 123450,
        scheduleWeekday: null, scheduleDayOfMonth: 15, scheduleAnchorMonth: null,
        notes: null, planTerms: null, planDueDate: null,
      }),
    )
    await waitFor(() => expect(namesIn('Monthly')).toEqual(['Yard rent', 'Insurance']))
    expect(screen.queryByRole('form', { name: 'New Monthly vendor' })).toBeNull()
  })

  it('urgent add form carries plan terms + due date', async () => {
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('button', { name: 'Add a Urgent Payment Plans vendor' }))
    const form = screen.getByRole('form', { name: 'New Urgent Payment Plans vendor' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Vendor' }), { target: { value: 'EDD' } })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Account' }), { target: { value: 'a1' } })
    const amount = within(form).getByRole('textbox', { name: 'Amount' })
    fireEvent.focus(amount)
    fireEvent.change(amount, { target: { value: '0' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /Plan terms/ }), { target: { value: '$500/mo' } })
    fireEvent.change(form.querySelector('input[type="date"]')!, { target: { value: '2027-01-15' } })
    fireEvent.click(within(form).getByRole('button', { name: /Add vendor/ }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        vendorName: 'EDD', section: 'urgent', amountCents: 0, planTerms: '$500/mo', planDueDate: '2027-01-15',
      }),
    )
  })

  it('edit sends only changed fields — including the last amount sent', async () => {
    mount()
    await screen.findByText('Yard rent')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Yard rent' }))
    const form = screen.getByRole('form', { name: 'Edit Yard rent' })
    const last = within(form).getByRole('textbox', { name: 'Last amount sent' })
    fireEvent.focus(last)
    fireEvent.change(last, { target: { value: '2500' } })
    fireEvent.blur(last)
    fireEvent.click(within(form).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ id: 'm1', lastAmountSentCents: 250000 }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Yard rent' })).toBeNull())
    expect(screen.getByText('$2,500.00', { selector: '.mt .cmr-num' })).toBeTruthy()
  })

  it('moving an urgent vendor to Weekly re-states the schedule and clears the plan', async () => {
    mount()
    await screen.findByText('IRS plan')
    fireEvent.click(screen.getByRole('button', { name: 'Edit IRS plan' }))
    const form = screen.getByRole('form', { name: 'Edit IRS plan' })
    // Urgent asks for no schedule at all.
    expect(within(form).queryByRole('combobox', { name: 'Day of the week' })).toBeNull()

    fireEvent.change(within(form).getByRole('combobox', { name: 'Frequency' }), { target: { value: 'weekly' } })
    expect(within(form).queryByRole('textbox', { name: /Plan terms/ })).toBeNull()
    expect(within(form).getByText(/clears this vendor.s plan terms/)).toBeTruthy()

    // The new frequency needs its own schedule before it can be saved.
    fireEvent.click(within(form).getByRole('button', { name: /Save/ }))
    expect(await within(form).findByRole('alert')).toBeTruthy()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)

    fireEvent.change(within(form).getByRole('combobox', { name: 'Day of the week' }), { target: { value: '3' } })
    fireEvent.click(within(form).getByRole('button', { name: /Save/ }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        id: 'u1', section: 'weekly', scheduleWeekday: 3, scheduleDayOfMonth: null, scheduleAnchorMonth: null,
      }),
    )
  })

  it('a quarterly vendor asks for the day AND the first month of the quarter', async () => {
    mount()
    await screen.findByText('Insurance premium')
    fireEvent.click(screen.getByRole('button', { name: 'Add a Quarterly vendor' }))
    const form = screen.getByRole('form', { name: 'New Quarterly vendor' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Vendor' }), { target: { value: 'Water district' } })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Account' }), { target: { value: 'a1' } })
    const amount = within(form).getByRole('textbox', { name: 'Amount' })
    fireEvent.focus(amount)
    fireEvent.change(amount, { target: { value: '800' } })
    fireEvent.blur(amount)

    // Day alone is not enough.
    fireEvent.change(within(form).getByRole('combobox', { name: 'Day of the month' }), { target: { value: '10' } })
    fireEvent.click(within(form).getByRole('button', { name: /Add vendor/ }))
    expect(await within(form).findByRole('alert')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    fireEvent.change(within(form).getByRole('combobox', { name: 'First month of the quarter' }), { target: { value: '2' } })
    expect(within(form).getByText(/the 10th of feb, may, aug, nov/i)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: /Add vendor/ }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        section: 'quarterly', scheduleWeekday: null, scheduleDayOfMonth: 10, scheduleAnchorMonth: 2,
      }),
    )
  })

  it('warns that a day past the 28th falls back to a short month’s last day', async () => {
    mount()
    await screen.findByText('Yard rent')
    fireEvent.click(screen.getByRole('button', { name: 'Add a Monthly vendor' }))
    const form = screen.getByRole('form', { name: 'New Monthly vendor' })
    expect(within(form).queryByText(/use their last day instead/)).toBeNull()
    fireEvent.change(within(form).getByRole('combobox', { name: 'Day of the month' }), { target: { value: '31' } })
    expect(within(form).getByText(/Months shorter than the 31st use their last day instead/)).toBeTruthy()
  })

  it('Escape cancels an edit with no request; an unchanged save sends nothing', async () => {
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fuel card' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Vendor' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Fuel card' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fuel card' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Edit Fuel card' })).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Fuel card' })).toBeNull())
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('a vendor on an inactive account shows it, and the picker flags it instead of offering it', async () => {
    vendors[3] = { ...vendors[3], accountId: 'a3', accountName: 'Old Payroll', accountActive: false }
    mount()
    await screen.findByText('Yard rent')
    expect(screen.getByText('(inactive account)', { selector: '.acct-off' }).closest('.mt')?.textContent).toMatch(/^Old Payroll \(inactive account\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Yard rent' }))
    const picker = within(screen.getByRole('form', { name: 'Edit Yard rent' })).getByRole('combobox', { name: 'Account' }) as HTMLSelectElement
    const opt = [...picker.options].find((o) => o.value === 'a3')!
    expect(opt.disabled).toBe(true)
    expect(opt.textContent).toMatch(/inactive/)
  })
})
