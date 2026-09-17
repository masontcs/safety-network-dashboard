// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import CmrPrioritiesClient from './CmrPrioritiesClient'
import { DialogProvider } from '@/components/ui/DialogProvider'
import { computePriorityTotals, type CmrPrioritiesView, type CmrPriority } from '@/lib/cmr/priorities'
import { weekEndSaturday, weekStartSunday } from '@/lib/cmr/week'

vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

/**
 * Weekly priorities screen: week selector (Sun–Sat) + totals masthead; read-only roles see
 * everything but no controls; the Controller adds (with and without an amount), edits, flags,
 * resolves, pays (paid stamp shows), unpays through the in-app confirm, deletes (in-app confirm,
 * never window.confirm) and reorders — totals follow every change; weeks don't bleed together.
 */

let store: CmrPriority[]
let canEdit: boolean
let calls: { method: string; url: string; body: unknown }[]
let reorderFails = false
let nextId = 0

const pr = (id: string, weekStart: string, description: string, amountCents: number, sortOrder: number, over: Partial<CmrPriority> = {}): CmrPriority => ({
  id, weekStart, description, amountCents, sortOrder,
  dueDate: null, notes: null, isTopPriority: false, status: 'open', carriedFromId: null,
  paidAt: null, paidBy: null, paidByName: null, createdAt: '2026-09-14T15:00:00Z', ...over,
})

const viewFor = (w: string): CmrPrioritiesView => {
  const weekStart = weekStartSunday(w)
  const priorities = store.filter((p) => p.weekStart === weekStart).sort((a, b) => a.sortOrder - b.sortOrder)
  return {
    weekStart,
    weekEnd: weekEndSaturday(weekStart),
    today: '2026-09-16',
    thisWeekStart: '2026-09-13',
    priorities,
    totals: computePriorityTotals(priorities),
    canEdit,
  }
}

const json = (data: unknown) => Promise.resolve({ status: 200, json: () => Promise.resolve(data) })

beforeEach(() => {
  store = [
    pr('c1', '2026-09-13', 'CDTFA sales tax', 6_450_000, 0, { isTopPriority: true, dueDate: '2026-09-17' }),
    pr('l1', '2026-09-13', 'Equipment loan — Wells Fargo', 3_200_000, 1, { dueDate: '2026-09-15', notes: 'Autopay failed' }),
    pr('t1', '2026-09-13', 'Call Sunbelt about the hold', 0, 2),
    pr('f1', '2026-09-13', 'Fuel card', 1_000_000, 3, { status: 'paid', paidAt: '2026-09-15T16:02:00Z', paidBy: 'u1', paidByName: 'Mason Doty' }),
    pr('n1', '2026-09-20', 'Next week only', 50_000, 0),
  ]
  canEdit = true
  calls = []
  reorderFails = false
  nextId = 0
  window.confirm = vi.fn(() => true)
  window.alert = vi.fn()
  window.history.replaceState(null, '', '/cmr/priorities')
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0 }) as typeof requestAnimationFrame
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const u = new URL(url, 'https://cmr.example')
    if (u.pathname === '/api/cmr/priorities') {
      if (method === 'GET') return json({ success: true, data: viewFor(u.searchParams.get('week')!) })
      if (method === 'POST') {
        const w = weekStartSunday(body.weekStart)
        const p = pr(`x${++nextId}`, w, body.description, body.amountCents ?? 0, 99, {
          dueDate: body.dueDate, notes: body.notes, isTopPriority: body.isTopPriority,
        })
        store.push(p)
        return json({ success: true, data: { priority: p } })
      }
      if (method === 'PATCH') {
        store = store.map((p) => {
          if (p.id !== body.id) return p
          const next = { ...p, ...body }
          if (body.status === 'paid') Object.assign(next, { paidAt: '2026-09-16T17:30:00Z', paidBy: 'u1', paidByName: 'Mason Doty' })
          else if (body.status) Object.assign(next, { paidAt: null, paidBy: null, paidByName: null })
          return next
        })
        return json({ success: true, data: { priority: store.find((p) => p.id === body.id), changed: true } })
      }
      if (method === 'DELETE') {
        store = store.filter((p) => p.id !== u.searchParams.get('id'))
        return json({ success: true, data: { deleted: true } })
      }
    }
    if (u.pathname === '/api/cmr/priorities/reorder') {
      if (reorderFails) return json({ success: false, error: 'Boom', code: 'INTERNAL_ERROR' })
      ;(body.ids as string[]).forEach((id, i) => { const p = store.find((x) => x.id === id); if (p) p.sortOrder = i })
      return json({ success: true, data: { changed: true } })
    }
    return json({ success: false, error: `unexpected ${method} ${url}` })
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

const mount = (initialWeek = '2026-09-13') =>
  render(<DialogProvider><CmrPrioritiesClient initialWeek={initialWeek} /></DialogProvider>)
const hero = () => screen.getByRole('region', { name: /^Needed this week/ })
const stmt = (label: string) => within(hero()).getByText(label).nextElementSibling?.textContent
const listSection = () => screen.getByRole('region', { name: 'Priorities' })
const names = () => within(listSection()).queryAllByRole('listitem').map((li) => li.querySelector('.nm')!.textContent)
const rowOf = (name: string) => within(listSection()).getByText(name).closest('li')!
const typeMoney = (el: HTMLElement, v: string) => { fireEvent.focus(el); fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el) }
const writes = () => calls.filter((c) => c.method !== 'GET')
const liveStatus = () => document.querySelector('p.cmr-sr-only[role="status"]')?.textContent

describe('CmrPrioritiesClient — week + totals + read-only roles', () => {
  it('shows the Sun–Sat week, totals and the list — but no controls for a requester/viewer', async () => {
    canEdit = false
    mount()
    await screen.findByText('CDTFA sales tax')
    expect(screen.getByText('Sun, Sep 13 – Sat, Sep 19, 2026')).toBeTruthy()
    expect(within(hero()).getByText('This week')).toBeTruthy()
    // needed = 64,500 + 32,000 (+ the $0 call); paid = 10,000
    expect(hero().querySelector('.cmr-hero-big')?.textContent).toBe('$96,500.00')
    expect(stmt('Still needed (open)')).toBe('$96,500.00')
    expect(stmt('Paid / resolved')).toBe('$10,000.00')
    expect(stmt('Top priorities')).toBe('1')
    expect(stmt('Week total')).toBe('$106,500.00')
    expect(hero().querySelector('.cmr-hero-meta')?.textContent).toBe('3 open priorities · 1 top priority (1 still open)')

    expect(names()).toEqual(['CDTFA sales tax', 'Equipment loan — Wells Fargo', 'Call Sunbelt about the hold', 'Fuel card'])
    const top = rowOf('CDTFA sales tax')
    expect(top.classList.contains('top')).toBe(true)
    expect(within(top).getByText('Top')).toBeTruthy()
    expect(top.textContent).toContain('Due Thu, Sep 17')
    expect(within(top).getByText('$64,500.00')).toBeTruthy()

    const loan = rowOf('Equipment loan — Wells Fargo')
    expect(within(loan).getByText('Overdue')).toBeTruthy() // due Sep 15, still open on Sep 16
    expect(within(loan).getByText('Autopay failed')).toBeTruthy()

    const task = rowOf('Call Sunbelt about the hold')
    expect(task.querySelector('.amt')?.textContent).toBe('No amount') // visually blank
    expect(task.querySelector('.amt .cmr-sr-only')).toBeTruthy()

    const paid = rowOf('Fuel card')
    expect(paid.classList.contains('paid')).toBe(true)
    expect(within(paid).getByText('Paid')).toBeTruthy()
    expect(paid.querySelector('.cmr-pr-stamp')?.textContent).toMatch(/^Paid Sep 15, 9:02\sAM · MD$/)
    expect(paid.querySelector('abbr')?.getAttribute('title')).toBe('Mason Doty')

    expect(screen.getByText(/Only a Controller can change them/)).toBeTruthy()
    for (const n of [/^Add /, /^Edit /, /^Delete /, /^Reorder /, /^Move /, /^Resolve /, /^Mark /, /^Top priority/]) {
      expect(screen.queryByRole('button', { name: n })).toBeNull()
    }
    expect(writes()).toHaveLength(0)
  })

  it('◀ / ▶ / This week switch weeks, keep the URL in sync, and weeks never mix', async () => {
    mount()
    await screen.findByText('CDTFA sales tax')
    expect((screen.getByRole('button', { name: 'This week' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Next week only')
    expect(calls.at(-1)?.url).toBe('/api/cmr/priorities?week=2026-09-20')
    expect(window.location.search).toBe('?week=2026-09-20')
    expect(screen.getByText('Sun, Sep 20 – Sat, Sep 26, 2026')).toBeTruthy()
    expect(names()).toEqual(['Next week only'])
    expect(within(hero()).queryByText('This week')).toBeNull()
    expect(stmt('Week total')).toBe('$500.00')

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText(/Nothing on the list for this week/)
    expect(hero().querySelector('.cmr-hero-big')?.textContent).toBe('$0.00')
    expect(screen.getByText('Sep 27 – Oct 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    await screen.findByText('CDTFA sales tax')
    expect(screen.queryByText('Next week only')).toBeNull()
    expect(window.location.search).toBe('?week=2026-09-13')

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/cmr/priorities?week=2026-09-06'))
    await screen.findByText(/Nothing on the list for this week/)
  })

  it('a 403 (no grant) sends the browser to /cmr/no-access', async () => {
    const assign = vi.fn()
    const orig = window.location
    Object.defineProperty(window, 'location', { value: { get href() { return orig.href }, set href(v: string) { assign(v) } }, configurable: true })
    global.fetch = vi.fn(() => json({ success: false, error: 'nope', code: 'FORBIDDEN' })) as unknown as typeof fetch
    mount()
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/cmr/no-access'))
    Object.defineProperty(window, 'location', { value: orig, configurable: true })
  })
})

describe('CmrPrioritiesClient — controller', () => {
  it('adds a priority with an amount, due date, notes and the Top flag; totals follow', async () => {
    mount()
    await screen.findByText('CDTFA sales tax')
    fireEvent.click(screen.getByRole('button', { name: 'Add a priority for this week' }))
    const form = screen.getByRole('form', { name: 'New priority for Sep 13 – 19' })

    fireEvent.click(within(form).getByRole('button', { name: /Add priority/ }))
    expect((await within(form).findByRole('alert')).textContent).toBe('Enter a description.')
    expect(writes()).toHaveLength(0)

    fireEvent.change(within(form).getByRole('textbox', { name: /What needs to be paid/ }), { target: { value: 'Payroll taxes' } })
    typeMoney(within(form).getByRole('textbox', { name: 'Amount (optional)' }), '41250.5')
    fireEvent.change(within(form).getByLabelText(/Due/), { target: { value: '2026-09-18' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /Notes/ }), { target: { value: 'EFTPS' } })
    fireEvent.click(within(form).getByRole('switch', { name: 'Top priority' }))
    fireEvent.click(within(form).getByRole('button', { name: /Add priority/ }))
    await waitFor(() =>
      expect(writes()[0]).toEqual({
        method: 'POST',
        url: '/api/cmr/priorities',
        body: { weekStart: '2026-09-13', description: 'Payroll taxes', amountCents: 4_125_050, dueDate: '2026-09-18', notes: 'EFTPS', isTopPriority: true },
      }),
    )
    await waitFor(() => expect(names().at(-1)).toBe('Payroll taxes'))
    expect(stmt('Still needed (open)')).toBe('$137,750.50')
    expect(stmt('Top priorities')).toBe('2')
    expect(rowOf('Payroll taxes').classList.contains('top')).toBe(true)
    expect(screen.queryByRole('form', { name: /New priority/ })).toBeNull()
    expect(liveStatus()).toBe('Payroll taxes ($41,250.50) added.')
  })

  it('adds a task with no amount → amountCents 0, needed unchanged', async () => {
    mount()
    await screen.findByText('CDTFA sales tax')
    fireEvent.click(screen.getByRole('button', { name: 'Add a priority for this week' }))
    const form = screen.getByRole('form', { name: /New priority/ })
    fireEvent.change(within(form).getByRole('textbox', { name: /What needs to be paid/ }), { target: { value: 'Chase the refund' } })
    fireEvent.click(within(form).getByRole('button', { name: /Add priority/ }))
    await waitFor(() =>
      expect(writes()[0].body).toEqual({ weekStart: '2026-09-13', description: 'Chase the refund', amountCents: 0, dueDate: null, notes: null, isTopPriority: false }),
    )
    await waitFor(() => expect(names()).toContain('Chase the refund'))
    expect(rowOf('Chase the refund').querySelector('.amt')?.textContent).toBe('No amount')
    expect(stmt('Still needed (open)')).toBe('$96,500.00')
    expect(liveStatus()).toBe('Chase the refund added.')
  })

  it('edits sending only what changed — clearing the amount sends 0', async () => {
    mount()
    await screen.findByText('Equipment loan — Wells Fargo')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Equipment loan — Wells Fargo' }))
    const form = screen.getByRole('form', { name: 'Edit Equipment loan — Wells Fargo' })
    const amount = within(form).getByRole('textbox', { name: 'Amount (optional)' }) as HTMLInputElement
    expect(amount.value).toBe('32000.00')
    typeMoney(amount, '')
    fireEvent.change(within(form).getByLabelText(/Due/), { target: { value: '' } })
    fireEvent.click(within(form).getByRole('button', { name: /Save/ }))
    await waitFor(() =>
      expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/cmr/priorities', body: { id: 'l1', amountCents: 0, dueDate: null } }),
    )
    await waitFor(() => expect(screen.queryByRole('form', { name: /^Edit / })).toBeNull())
    expect(stmt('Still needed (open)')).toBe('$64,500.00')
    expect(within(rowOf('Equipment loan — Wells Fargo')).queryByText('Overdue')).toBeNull()
  })

  it('Escape cancels an edit; an unchanged save sends nothing', async () => {
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('button', { name: 'Edit CDTFA sales tax' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: /What needs to be paid/ }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('form', { name: /^Edit / })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit CDTFA sales tax' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Edit CDTFA sales tax' })).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(screen.queryByRole('form', { name: /^Edit / })).toBeNull())
    expect(writes()).toHaveLength(0)
  })

  it('toggles the Top star', async () => {
    mount()
    await screen.findByText('CDTFA sales tax')
    const star = screen.getByRole('button', { name: 'Top priority: Equipment loan — Wells Fargo' })
    expect(star.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(star)
    await waitFor(() => expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/cmr/priorities', body: { id: 'l1', isTopPriority: true } }))
    await waitFor(() => expect(stmt('Top priorities')).toBe('2'))
    expect(screen.getByRole('button', { name: 'Top priority: Equipment loan — Wells Fargo' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Top priority: CDTFA sales tax' }))
    await waitFor(() => expect(writes()[1].body).toEqual({ id: 'c1', isTopPriority: false }))
    await waitFor(() => expect(rowOf('CDTFA sales tax').classList.contains('top')).toBe(false))
  })

  it('resolve → reopen, and pay (stamp shows) → unpay through the in-app confirm; needed follows', async () => {
    mount()
    await screen.findByText('CDTFA sales tax')

    fireEvent.click(screen.getByRole('button', { name: 'Resolve Equipment loan — Wells Fargo' }))
    await waitFor(() => expect(writes()[0].body).toEqual({ id: 'l1', status: 'resolved' }))
    await waitFor(() => expect(stmt('Still needed (open)')).toBe('$64,500.00'))
    expect(stmt('Paid / resolved')).toBe('$42,000.00')
    expect(within(rowOf('Equipment loan — Wells Fargo')).getByText('Resolved')).toBeTruthy()
    expect(within(rowOf('Equipment loan — Wells Fargo')).queryByText('Overdue')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen Equipment loan — Wells Fargo' }))
    await waitFor(() => expect(writes()[1].body).toEqual({ id: 'l1', status: 'open' }))
    await waitFor(() => expect(stmt('Still needed (open)')).toBe('$96,500.00'))

    fireEvent.click(screen.getByRole('button', { name: 'Mark CDTFA sales tax paid' }))
    await waitFor(() => expect(writes()[2].body).toEqual({ id: 'c1', status: 'paid' }))
    await waitFor(() => expect(stmt('Still needed (open)')).toBe('$32,000.00'))
    const row = rowOf('CDTFA sales tax')
    expect(row.classList.contains('paid')).toBe(true)
    expect(row.querySelector('.cmr-pr-stamp')?.textContent).toMatch(/^Paid Sep 16, 10:30\sAM · MD$/)
    expect(hero().querySelector('.cmr-hero-meta')?.textContent).toBe('2 open priorities · 1 top priority (0 still open)')
    expect(liveStatus()).toBe('CDTFA sales tax marked paid.')

    // Unpay asks first; cancelling sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Mark CDTFA sales tax unpaid' }))
    await screen.findByText('Mark CDTFA sales tax unpaid?')
    expect(screen.getByText(/clears the paid stamp \(Sep 16, 10:30\sAM, Mason Doty\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Mark CDTFA sales tax unpaid?')).toBeNull())
    expect(writes()).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Mark CDTFA sales tax unpaid' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mark unpaid' }))
    await waitFor(() => expect(writes()[3].body).toEqual({ id: 'c1', status: 'open' }))
    await waitFor(() => expect(stmt('Still needed (open)')).toBe('$96,500.00'))
    expect(rowOf('CDTFA sales tax').querySelector('.cmr-pr-stamp')).toBeNull()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('a resolved priority can be marked paid directly', async () => {
    store[1] = { ...store[1], status: 'resolved' }
    mount()
    await screen.findByText('Equipment loan — Wells Fargo')
    fireEvent.click(screen.getByRole('button', { name: 'Mark Equipment loan — Wells Fargo paid' }))
    await waitFor(() => expect(writes()[0].body).toEqual({ id: 'l1', status: 'paid' }))
    await waitFor(() => expect(rowOf('Equipment loan — Wells Fargo').classList.contains('paid')).toBe(true))
  })

  it('deleting asks with the in-app dialog (never window.confirm)', async () => {
    mount()
    await screen.findByText('Fuel card')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Fuel card' }))
    await screen.findByText('Delete “Fuel card”?')
    expect(screen.getByText(/\(\$10,000\.00\) from the week of Sep 13 – 19/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Delete “Fuel card”?')).toBeNull())
    expect(writes()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Fuel card' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete priority' }))
    await waitFor(() => expect(writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/cmr/priorities?id=f1' }))
    await waitFor(() => expect(names()).not.toContain('Fuel card'))
    expect(stmt('Paid / resolved')).toBe('$0.00')
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('reorders with the arrows (the whole week) and rolls back a failed save', async () => {
    mount()
    await screen.findByText('Fuel card')
    expect((screen.getByRole('button', { name: 'Move CDTFA sales tax up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Move Fuel card down' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Reorder Fuel card, position 4 of 4' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Move Fuel card up' }))
    await waitFor(() =>
      expect(writes()[0]).toEqual({ method: 'POST', url: '/api/cmr/priorities/reorder', body: { weekStart: '2026-09-13', ids: ['c1', 'l1', 'f1', 't1'] } }),
    )
    await waitFor(() => expect(names()).toEqual(['CDTFA sales tax', 'Equipment loan — Wells Fargo', 'Fuel card', 'Call Sunbelt about the hold']))
    expect(liveStatus()).toBe('Fuel card moved to position 3 of 4.')

    reorderFails = true
    fireEvent.click(screen.getByRole('button', { name: 'Move Fuel card up' }))
    await screen.findByText('Could not save the new order')
    expect(names()).toEqual(['CDTFA sales tax', 'Equipment loan — Wells Fargo', 'Fuel card', 'Call Sunbelt about the hold'])
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('adds into the week on screen, not this week', async () => {
    mount('2026-09-20')
    await screen.findByText('Next week only')
    fireEvent.click(screen.getByRole('button', { name: 'Add a priority for this week' }))
    const form = screen.getByRole('form', { name: 'New priority for Sep 20 – 26' })
    fireEvent.change(within(form).getByRole('textbox', { name: /What needs to be paid/ }), { target: { value: 'Rent' } })
    fireEvent.click(within(form).getByRole('button', { name: /Add priority/ }))
    await waitFor(() => expect(writes()[0].body).toMatchObject({ weekStart: '2026-09-20', description: 'Rent' }))
    await waitFor(() => expect(names()).toEqual(['Next week only', 'Rent']))
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    await screen.findByText('CDTFA sales tax')
    expect(names()).not.toContain('Rent')
  })

  it('a slow week load never shows the previous week’s rows under the new week’s header', async () => {
    const fast = global.fetch
    let release: () => void = () => {}
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('week=2026-09-20')) {
        return new Promise((resolve) => { release = () => resolve(fast(url, init)) })
      }
      return fast(url, init)
    }) as unknown as typeof fetch
    mount()
    await screen.findByText('CDTFA sales tax')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await waitFor(() => expect(screen.queryByText('CDTFA sales tax')).toBeNull())
    expect(screen.getByLabelText('Loading priorities for Sun, Sep 20 – Sat, Sep 26, 2026')).toBeTruthy()
    release()
    await screen.findByText('Next week only')
  })
})
