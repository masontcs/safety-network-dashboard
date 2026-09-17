// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import CmrLedgerClient from './CmrLedgerClient'
import { DialogProvider } from '@/components/ui/DialogProvider'
import {
  computeLedgerTotals,
  groupPendingByAccount,
  type CmrLedgerAccountRef,
  type CmrLedgerAdjustment,
  type CmrLedgerView,
  type CmrPendingItem,
} from '@/lib/cmr/ledger'

vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

/**
 * Daily ledger screen behaviour: statement header with the derived balance; read-only roles see
 * everything but no controls; the Controller sets beginning cash, adds signed lines (with a warn
 * note) and pending items (dollars → cents, active accounts only), edits, deletes through the
 * in-app confirm (never window.confirm), reorders; AM/PM + date switching reload that snapshot.
 */

type Snap = { beginning: number; exists: boolean; adjustments: CmrLedgerAdjustment[]; items: CmrPendingItem[] }
let snaps: Map<string, Snap>
let canEdit: boolean
let calls: { method: string; url: string; body: unknown }[]
let reorderFails = false
let pushFails = false
let unpushFails = false

const accounts: CmrLedgerAccountRef[] = [
  { id: 'a1', name: 'TCS', accountType: 'Checking', active: true, sortOrder: 0 },
  { id: 'a2', name: 'INC', accountType: 'Payroll', active: true, sortOrder: 1 },
  { id: 'a3', name: 'Old Payroll', accountType: null, active: false, sortOrder: 2 },
]
const accName = (id: string) => accounts.find((a) => a.id === id)!.name

const adj = (id: string, description: string, amountCents: number, sortOrder: number, over: Partial<CmrLedgerAdjustment> = {}): CmrLedgerAdjustment => ({
  id, description, amountCents, sortOrder, note: null, warnNote: null, createdAt: '2026-09-16T14:00:00Z', ...over,
})
const item = (
  id: string,
  accountId: string,
  payee: string,
  amountCents: number,
  sortOrder: number,
  over: Partial<CmrPendingItem> = {},
): CmrPendingItem => ({
  id, accountId, accountName: accName(accountId), accountActive: true, payee, amountCents,
  status: 'pending', source: 'manual', notes: null, sortOrder, createdAt: '2026-09-16T14:00:00Z',
  originalDate: null, effectiveDate: null, paidAt: null, paidBy: null, paidByName: null,
  pushedFromId: null, pushedFrom: null, pushedTo: null, canUnpush: false, unpushBlockedReason: null,
  ...over,
})

const viewFor = (date: string, period: 'am' | 'pm'): CmrLedgerView => {
  const s = snaps.get(`${date}:${period}`) ?? { beginning: 0, exists: false, adjustments: [], items: [] }
  const adjustments = [...s.adjustments].sort((a, b) => a.sortOrder - b.sortOrder)
  return {
    ledger: { id: s.exists ? `L-${date}-${period}` : null, ledgerDate: date, period, beginningCashCents: s.beginning, exists: s.exists, updatedAt: s.exists ? '2026-09-16T14:14:00Z' : null },
    adjustments,
    pending: groupPendingByAccount(s.items, accounts),
    totals: computeLedgerTotals(s.beginning, adjustments, s.items),
    accounts,
    today: '2026-09-16',
    canEdit,
  }
}

const json = (data: unknown) => Promise.resolve({ status: 200, json: () => Promise.resolve(data) })
let nextId = 0

function snapOf(body: { date: string; period: string }): Snap {
  const k = `${body.date}:${body.period}`
  if (!snaps.has(k)) snaps.set(k, { beginning: 0, exists: true, adjustments: [], items: [] })
  const s = snaps.get(k)!
  s.exists = true
  return s
}
const allSnaps = () => [...snaps.values()]

beforeEach(() => {
  snaps = new Map([
    ['2026-09-16:am', {
      beginning: 48_230_000,
      exists: true,
      adjustments: [
        adj('j1', 'Wires from prior week', 3_800_000, 0),
        adj('j2', 'Payroll hold', -2_200_000, 1, { warnNote: 'Cover by 2:00 PM', note: 'Per Jordan' }),
      ],
      items: [
        item('p1', 'a1', 'Ferguson Enterprises', 21_000_000, 0),
        item('p2', 'a1', 'Sunbelt Rentals', 10_200_000, 1),
        item('p3', 'a2', 'ADP payroll run', 17_752_000, 0),
      ],
    }],
    ['2026-09-16:pm', { beginning: 100_000, exists: true, adjustments: [], items: [item('p9', 'a2', 'PM only', 400, 0)] }],
  ])
  canEdit = true
  calls = []
  reorderFails = false
  pushFails = false
  unpushFails = false
  nextId = 0
  window.confirm = vi.fn(() => true)
  window.alert = vi.fn()
  window.history.replaceState(null, '', '/cmr')
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0 }) as typeof requestAnimationFrame
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const u = new URL(url, 'https://cmr.example')
    if (u.pathname === '/api/cmr/ledger' && method === 'GET') {
      return json({ success: true, data: viewFor(u.searchParams.get('date')!, u.searchParams.get('period') as 'am' | 'pm') })
    }
    if (u.pathname === '/api/cmr/ledger' && method === 'PUT') {
      snapOf(body).beginning = body.beginningCashCents
      return json({ success: true, data: { changed: true } })
    }
    if (u.pathname === '/api/cmr/ledger/adjustments') {
      if (method === 'POST') {
        const s = snapOf(body)
        const a = adj(`n${++nextId}`, body.description, body.amountCents, 99, { warnNote: body.warnNote, note: body.note })
        s.adjustments.push(a)
        return json({ success: true, data: { adjustment: a } })
      }
      if (method === 'PATCH') {
        for (const s of allSnaps()) s.adjustments = s.adjustments.map((a) => (a.id === body.id ? { ...a, ...body } : a))
        const a = allSnaps().flatMap((s) => s.adjustments).find((x) => x.id === body.id)
        return json({ success: true, data: { adjustment: a } })
      }
      if (method === 'DELETE') {
        const id = u.searchParams.get('id')
        for (const s of allSnaps()) s.adjustments = s.adjustments.filter((a) => a.id !== id)
        return json({ success: true, data: { deleted: true } })
      }
    }
    if (u.pathname === '/api/cmr/ledger/pending') {
      if (method === 'POST') {
        const s = snapOf(body)
        const it = { ...item(`q${++nextId}`, body.accountId, body.payee, body.amountCents, 99), notes: body.notes }
        s.items.push(it)
        return json({ success: true, data: { item: it } })
      }
      if (method === 'PATCH') {
        // The paid check-off is its own shape: status + the stamp, nothing else.
        if ('status' in body) {
          const paid = body.status === 'paid'
          for (const s of allSnaps()) {
            s.items = s.items.map((i) =>
              i.id === body.id
                ? { ...i, status: body.status, paidAt: paid ? '2026-09-16T18:30:00Z' : null, paidByName: paid ? 'Cora Controller' : null }
                : i,
            )
          }
          return json({ success: true, data: { item: allSnaps().flatMap((s) => s.items).find((x) => x.id === body.id), changed: true } })
        }
        for (const s of allSnaps()) {
          s.items = s.items.map((i) => (i.id === body.id ? { ...i, ...body, accountName: accName(body.accountId ?? i.accountId) } : i))
        }
        return json({ success: true, data: { item: allSnaps().flatMap((s) => s.items).find((x) => x.id === body.id) } })
      }
      if (method === 'DELETE') {
        const id = u.searchParams.get('id')
        for (const s of allSnaps()) s.items = s.items.filter((i) => i.id !== id)
        return json({ success: true, data: { deleted: true } })
      }
    }
    if (u.pathname === '/api/cmr/ledger/pending/push' && method === 'POST') {
      if (pushFails) return json({ success: false, error: 'It is no longer pending.', code: 'NOT_PENDING' })
      const from = [...snaps.entries()].find(([, s]) => s.items.some((i) => i.id === body.id))!
      const src = from[1].items.find((i) => i.id === body.id)!
      const [fromDate, fromPeriod] = from[0].split(':') as [string, 'am' | 'pm']
      const to = { date: body.targetDate as string, period: body.targetPeriod as 'am' | 'pm' }
      from[1].items = from[1].items.map((i) =>
        i.id === src.id ? { ...i, status: 'pushed', pushedTo: to, canUnpush: true, unpushBlockedReason: null } : i,
      )
      const target = snapOf({ date: to.date, period: to.period })
      target.items.push({
        ...src,
        id: `x${++nextId}`,
        status: 'pending',
        sortOrder: 99,
        pushedFromId: src.id,
        pushedFrom: { date: fromDate, period: fromPeriod },
        originalDate: src.originalDate ?? fromDate,
        effectiveDate: to.date,
      })
      return json({ success: true, data: { pushedId: src.id, to, where: `${to.date} ${to.period.toUpperCase()}` } })
    }
    if (u.pathname === '/api/cmr/ledger/pending/unpush' && method === 'POST') {
      if (unpushFails) return json({ success: false, error: 'It was already paid.', code: 'ROW_PAID' })
      let copyId: string | null = null
      for (const s of allSnaps()) {
        const copy = s.items.find((i) => i.pushedFromId === body.id)
        if (copy) { copyId = copy.id; s.items = s.items.filter((i) => i.id !== copy.id) }
      }
      for (const s of allSnaps()) {
        s.items = s.items.map((i) => (i.id === body.id ? { ...i, status: 'pending', pushedTo: null, canUnpush: false, unpushBlockedReason: null } : i))
      }
      return json({ success: true, data: { removedCopyId: copyId } })
    }
    if (u.pathname.endsWith('/reorder')) {
      if (reorderFails) return json({ success: false, error: 'Boom', code: 'INTERNAL_ERROR' })
      const s = snapOf(body)
      const list = u.pathname.includes('adjustments') ? s.adjustments : s.items
      ;(body.ids as string[]).forEach((id, i) => { const x = list.find((r) => r.id === id); if (x) x.sortOrder = i })
      return json({ success: true, data: { changed: true } })
    }
    return json({ success: false, error: `unexpected ${method} ${url}` })
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

const mount = (initialDate = '2026-09-16', initialPeriod: 'am' | 'pm' = 'am') =>
  render(<DialogProvider><CmrLedgerClient initialDate={initialDate} initialPeriod={initialPeriod} /></DialogProvider>)
const region = (name: string) => screen.getByRole('region', { name })
const hero = () => screen.getByRole('region', { name: /^Current balance/ })
const stmt = (label: string) => within(hero()).getByText(label).nextElementSibling?.textContent
const adjNames = () => within(region('Adjustments')).queryAllByRole('listitem').map((li) => li.querySelector('.nm')!.textContent)
const groupNames = (acct: string) =>
  within(screen.getByRole('group', { name: new RegExp(`^${acct}`) })).queryAllByRole('listitem').map((li) => li.querySelector('.nm')!.textContent)
const typeMoney = (el: HTMLElement, v: string) => { fireEvent.focus(el); fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el) }
const writes = () => calls.filter((c) => c.method !== 'GET')

describe('CmrLedgerClient — statement + read-only roles', () => {
  it('shows the statement, lines, grouped pending with subtotals and total — but no controls', async () => {
    canEdit = false
    mount()
    await screen.findByText('Wires from prior week')
    // $482,300 + $38,000 − $22,000 − $489,520 = $8,780.00
    expect(within(hero()).getByText('Current balance · AM', { exact: false })).toBeTruthy()
    expect(within(hero()).getByText('Today')).toBeTruthy()
    expect(hero().querySelector('.cmr-hero-big')?.textContent).toBe('$8,780.00')
    expect(stmt('Beginning cash')).toBe('$482,300.00')
    expect(stmt('Adjustments')).toBe('+$16,000.00')
    expect(stmt('Pending in bank')).toBe('−$489,520.00')
    expect(stmt('Current balance')).toBe('$8,780.00')

    expect(adjNames()).toEqual(['Wires from prior week', 'Payroll hold'])
    const hold = within(region('Adjustments')).getByText('Payroll hold').closest('li')!
    expect(within(hold).getByText('Cover by 2:00 PM')).toBeTruthy() // visible warn flag
    expect(hold.textContent).toContain('Warning:')
    expect(within(hold).getByText('Per Jordan')).toBeTruthy()
    expect(within(hold).getByText('−$22,000.00')).toBeTruthy()
    // Locked roll-up line.
    const rollup = region('Adjustments').querySelector('.cmr-lg-rollup')!
    expect(rollup.textContent).toContain('Pending in bank today')
    expect(rollup.textContent).toContain('−$489,520.00')
    expect(rollup.querySelector('button, input')).toBeNull()

    expect(groupNames('TCS')).toEqual(['Ferguson Enterprises', 'Sunbelt Rentals'])
    expect(groupNames('INC')).toEqual(['ADP payroll run'])
    expect(screen.getByRole('heading', { name: /^TCS · Checking subtotal \$312,000\.00$/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^INC · Payroll subtotal \$177,520\.00$/ })).toBeTruthy()
    expect(region('Pending in bank').querySelector('.cmr-lg-total')?.textContent).toContain('$489,520.00')

    expect(screen.getByText(/Only a Controller can change it/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Reorder / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull()
    expect(writes()).toHaveLength(0)
  })

  it('a negative balance is flagged Short and shown with a minus sign', async () => {
    snaps.get('2026-09-16:am')!.beginning = 0
    mount()
    await screen.findByText('Wires from prior week')
    expect(hero().querySelector('.cmr-hero-big')?.textContent).toBe('−$473,520.00')
    expect(hero().querySelector('.cmr-hero-big')?.classList.contains('neg')).toBe(true)
    expect(within(hero()).getByText('Short')).toBeTruthy()
  })

  it('AM / PM and the date controls load that snapshot and keep the URL in sync', async () => {
    mount()
    await screen.findByText('Wires from prior week')
    fireEvent.click(screen.getByRole('button', { name: 'PM', pressed: false }))
    await screen.findByText('PM only')
    expect(hero().querySelector('.cmr-hero-big')?.textContent).toBe('$996.00')
    expect(screen.queryByText('Wires from prior week')).toBeNull()
    expect(window.location.search).toBe('?date=2026-09-16&period=pm')

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/cmr/ledger?date=2026-09-17&period=pm'))
    await screen.findByText('Nothing pending in the bank for this snapshot.')
    expect(hero().querySelector('.cmr-hero-meta')?.textContent).toContain('not started')
    expect(within(hero()).queryByText('Today')).toBeNull()
    expect((screen.getByLabelText('Ledger date') as HTMLInputElement).value).toBe('2026-09-17')

    fireEvent.change(screen.getByLabelText('Ledger date'), { target: { value: '2026-02-30' } }) // ignored
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    await screen.findByText('PM only')
    expect(window.location.search).toBe('?date=2026-09-16&period=pm')
    expect((screen.getByRole('button', { name: 'Today' }) as HTMLButtonElement).disabled).toBe(true)
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

describe('CmrLedgerClient — controller', () => {
  it('sets beginning cash (negative allowed) and the balance updates', async () => {
    mount()
    await screen.findByText('Wires from prior week')
    fireEvent.click(screen.getByRole('button', { name: 'Edit AM beginning cash' }))
    const form = screen.getByRole('form', { name: 'Set AM beginning cash' })
    typeMoney(within(form).getByRole('textbox', { name: 'Beginning cash' }), '-1250.5')
    fireEvent.click(within(form).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(writes()[0]).toEqual({ method: 'PUT', url: '/api/cmr/ledger', body: { date: '2026-09-16', period: 'am', beginningCashCents: -125050 } }))
    await waitFor(() => expect(stmt('Beginning cash')).toBe('\u2212$1,250.50'))
    expect(stmt('Current balance')).toBe('\u2212$474,770.50') // −1,250.50 + 16,000 − 489,520
  })

  it('adds a signed line with a warn note: direction + dollars become signed cents', async () => {
    mount()
    await screen.findByText('Wires from prior week')
    fireEvent.click(screen.getByRole('button', { name: 'Add an adjustment line' }))
    const form = screen.getByRole('form', { name: 'New adjustment line' })

    fireEvent.click(within(form).getByRole('button', { name: /Add line/ }))
    expect(await within(form).findByRole('alert')).toBeTruthy()
    expect(writes()).toHaveLength(0)

    fireEvent.change(within(form).getByRole('textbox', { name: 'Description' }), { target: { value: 'Loan payment' } })
    fireEvent.click(within(form).getByRole('button', { name: /Takes away/ }))
    typeMoney(within(form).getByRole('textbox', { name: 'Amount taken away' }), '3200')
    fireEvent.change(within(form).getByRole('combobox', { name: /Warn note/ }), { target: { value: 'Needs to be covered by 2:00 PM' } })
    fireEvent.click(within(form).getByRole('button', { name: /Add line/ }))
    await waitFor(() =>
      expect(writes()[0]).toEqual({
        method: 'POST',
        url: '/api/cmr/ledger/adjustments',
        body: { date: '2026-09-16', period: 'am', description: 'Loan payment', amountCents: -320000, warnNote: 'Needs to be covered by 2:00 PM', note: null },
      }),
    )
    await waitFor(() => expect(adjNames()).toEqual(['Wires from prior week', 'Payroll hold', 'Loan payment']))
    expect(stmt('Adjustments')).toBe('+$12,800.00')
    expect(screen.queryByRole('form', { name: 'New adjustment line' })).toBeNull()
    expect(within(region('Adjustments')).getByText('Needs to be covered by 2:00 PM')).toBeTruthy()
  })

  it('edits a line sending only what changed (flip direction, clear warn note)', async () => {
    mount()
    await screen.findByText('Payroll hold')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Payroll hold' }))
    const form = screen.getByRole('form', { name: 'Edit Payroll hold' })
    expect(within(form).getByRole('button', { name: /Takes away/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(form).getByRole('button', { name: /Adds cash/ }))
    fireEvent.change(within(form).getByRole('combobox', { name: /Warn note/ }), { target: { value: '  ' } })
    fireEvent.click(within(form).getByRole('button', { name: /Save/ }))
    await waitFor(() =>
      expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/cmr/ledger/adjustments', body: { id: 'j2', amountCents: 2_200_000, warnNote: null } }),
    )
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Payroll hold' })).toBeNull())
    expect(stmt('Adjustments')).toBe('+$60,000.00')
  })

  it('deleting a line asks with the in-app dialog (never window.confirm)', async () => {
    mount()
    await screen.findByText('Payroll hold')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Payroll hold' }))
    await screen.findByText('Delete “Payroll hold”?')
    expect(window.confirm).not.toHaveBeenCalled()
    expect(writes()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Delete “Payroll hold”?')).toBeNull())
    expect(writes()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Payroll hold' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete line' }))
    await waitFor(() => expect(writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/cmr/ledger/adjustments?id=j2' }))
    await waitFor(() => expect(adjNames()).toEqual(['Wires from prior week']))
  })

  it('reorders lines with the arrows (full list) and rolls back a failed save', async () => {
    mount()
    await screen.findByText('Payroll hold')
    expect((screen.getByRole('button', { name: 'Move Wires from prior week up' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move Payroll hold up' }))
    await waitFor(() =>
      expect(writes()[0]).toEqual({ method: 'POST', url: '/api/cmr/ledger/adjustments/reorder', body: { date: '2026-09-16', period: 'am', ids: ['j2', 'j1'] } }),
    )
    await waitFor(() => expect(adjNames()).toEqual(['Payroll hold', 'Wires from prior week']))
    expect(document.querySelector('p.cmr-sr-only[role="status"]')?.textContent).toBe('Payroll hold moved to position 1 of 2.')

    reorderFails = true
    fireEvent.click(screen.getByRole('button', { name: 'Move Payroll hold down' }))
    await screen.findByText('Could not save the new order')
    expect(adjNames()).toEqual(['Payroll hold', 'Wires from prior week'])
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('adds a pending item: active accounts only, dollars → cents, lands in its group', async () => {
    mount()
    await screen.findByText('ADP payroll run')
    fireEvent.click(screen.getByRole('button', { name: 'Add a pending item' }))
    const form = screen.getByRole('form', { name: 'New pending item' })
    const picker = within(form).getByRole('combobox', { name: 'Account' }) as HTMLSelectElement
    expect([...picker.options].filter((o) => !o.disabled).map((o) => o.textContent)).toEqual(['TCS · Checking', 'INC · Payroll'])

    fireEvent.change(within(form).getByRole('textbox', { name: 'Payee' }), { target: { value: 'Blue Diamond' } })
    fireEvent.change(picker, { target: { value: 'a2' } })
    typeMoney(within(form).getByRole('textbox', { name: 'Amount' }), '18400')
    fireEvent.change(within(form).getByRole('textbox', { name: /Notes/ }), { target: { value: 'before 3pm' } })
    fireEvent.click(within(form).getByRole('button', { name: /Add item/ }))
    await waitFor(() =>
      expect(writes()[0]).toEqual({
        method: 'POST',
        url: '/api/cmr/ledger/pending',
        body: { date: '2026-09-16', period: 'am', accountId: 'a2', payee: 'Blue Diamond', amountCents: 1_840_000, notes: 'before 3pm' },
      }),
    )
    await waitFor(() => expect(groupNames('INC')).toEqual(['ADP payroll run', 'Blue Diamond']))
    expect(screen.getByRole('heading', { name: /^INC · Payroll subtotal \$195,920\.00$/ })).toBeTruthy()
    expect(stmt('Pending in bank')).toBe('−$507,920.00')
    expect(stmt('Current balance')).toBe('−$9,620.00') // 8,780 − 18,400
  })

  it('pending: a negative amount cannot be typed; the form needs an account', async () => {
    mount()
    await screen.findByText('ADP payroll run')
    fireEvent.click(screen.getByRole('button', { name: 'Add a pending item' }))
    const form = screen.getByRole('form', { name: 'New pending item' })
    const amount = within(form).getByRole('textbox', { name: 'Amount' }) as HTMLInputElement
    fireEvent.focus(amount)
    fireEvent.change(amount, { target: { value: '-5' } })
    expect(amount.value).toBe('')
    fireEvent.change(within(form).getByRole('textbox', { name: 'Payee' }), { target: { value: 'X' } })
    fireEvent.change(amount, { target: { value: '5' } })
    fireEvent.click(within(form).getByRole('button', { name: /Add item/ }))
    expect((await within(form).findByRole('alert')).textContent).toBe('Choose an account.')
    expect(writes()).toHaveLength(0)
  })

  it('edits (moves) and deletes a pending item; reorder is per account group', async () => {
    mount()
    await screen.findByText('Sunbelt Rentals')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Sunbelt Rentals' }))
    const form = screen.getByRole('form', { name: 'Edit Sunbelt Rentals' })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Account' }), { target: { value: 'a2' } })
    fireEvent.click(within(form).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/cmr/ledger/pending', body: { id: 'p2', accountId: 'a2' } }))

    fireEvent.click(await screen.findByRole('button', { name: 'Move ADP payroll run down' }))
    await waitFor(() =>
      expect(writes()[1]).toMatchObject({ url: '/api/cmr/ledger/pending/reorder', body: { date: '2026-09-16', period: 'am', accountId: 'a2' } }),
    )
    expect((writes()[1].body as { ids: string[] }).ids).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Ferguson Enterprises' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete item' }))
    await waitFor(() => expect(writes()[2]).toMatchObject({ method: 'DELETE', url: '/api/cmr/ledger/pending?id=p1' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: /^TCS/ })).toBeNull())
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('first entry on an empty PM snapshot goes to that date + period', async () => {
    mount('2026-09-20', 'pm')
    await screen.findByText(/nothing saved for this snapshot yet/)
    expect(screen.getByText(/Setting it, or adding any line, saves this snapshot/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add an adjustment line' }))
    const form = screen.getByRole('form', { name: 'New adjustment line' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Description' }), { target: { value: 'Wire in' } })
    typeMoney(within(form).getByRole('textbox', { name: 'Amount added' }), '10')
    fireEvent.click(within(form).getByRole('button', { name: /Add line/ }))
    await waitFor(() => expect(writes()[0].body).toMatchObject({ date: '2026-09-20', period: 'pm', amountCents: 1000 }))
    await waitFor(() => expect(stmt('Current balance')).toBe('$10.00'))
    expect(snaps.get('2026-09-20:am')).toBeUndefined()
  })

  it('Escape cancels an edit; an unchanged save sends nothing', async () => {
    mount()
    await screen.findByText('Wires from prior week')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Wires from prior week' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Description' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Wires from prior week' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Wires from prior week' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Edit Wires from prior week' })).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Wires from prior week' })).toBeNull())
    expect(writes()).toHaveLength(0)
  })
})

// ── Phase 6: the paid check-off and push-to-another-day ─────────────────────

describe('CmrLedgerClient — check off and push', () => {
  const rowFor = (payee: string) => screen.getByText(payee).closest('li') as HTMLElement
  const paidBox = (payee: string) => within(rowFor(payee)).getByRole('checkbox') as HTMLInputElement
  const dialog = () => screen.getByRole('dialog')

  it('read-only roles see the history and the stamp, and get no check-off or Push', async () => {
    canEdit = false
    snaps.get('2026-09-16:am')!.items = [
      item('p1', 'a1', 'Ferguson Enterprises', 21_000_000, 0, { status: 'pushed', pushedTo: { date: '2026-09-17', period: 'am' } }),
      item('p2', 'a1', 'Sunbelt Rentals', 10_200_000, 1, { status: 'paid', paidAt: '2026-09-16T18:30:00Z', paidByName: 'Cora Controller' }),
      item('p3', 'a1', 'From yesterday', 500, 2, { pushedFromId: 'old', pushedFrom: { date: '2026-09-15', period: 'pm' } }),
    ]
    mount()
    await screen.findByText('Ferguson Enterprises')

    const pushed = rowFor('Ferguson Enterprises')
    expect(within(pushed).getByText('Pushed')).toBeTruthy()
    expect(pushed.textContent).toContain('Pushed to Thu, Sep 17 AM')
    expect(pushed.className).toContain('pushed')

    expect(rowFor('Sunbelt Rentals').textContent).toContain('Paid')
    expect(rowFor('From yesterday').textContent).toContain('Pushed from Tue, Sep 15 PM')

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Push / })).toBeNull()
  })

  it('a pushed item is off this day’s total and has no controls at all', async () => {
    snaps.get('2026-09-16:am')!.items = [
      item('p1', 'a1', 'Ferguson Enterprises', 21_000_000, 0, { status: 'pushed', pushedTo: { date: '2026-09-17', period: 'am' } }),
      item('p2', 'a1', 'Sunbelt Rentals', 10_200_000, 1),
    ]
    mount()
    await screen.findByText('Ferguson Enterprises')
    // $482,300 + $16,000 − $102,000 (the pushed $210,000 is gone)
    expect(stmt('Pending in bank')).toBe('−$102,000.00')
    const pushed = rowFor('Ferguson Enterprises')
    expect(within(pushed).queryByRole('checkbox')).toBeNull()
    expect(within(pushed).queryByRole('button', { name: /^Push / })).toBeNull()
    expect(within(pushed).queryByRole('button', { name: /^Edit / })).toBeNull()
  })

  it('the check-off, Push and the edit controls share ONE control group on the row', async () => {
    mount()
    await screen.findByText('Sunbelt Rentals')
    const row = rowFor('Sunbelt Rentals')
    expect(row.querySelectorAll('.ctl')).toHaveLength(1)
    const ctl = row.querySelector('.ctl')!
    expect(within(ctl as HTMLElement).getByRole('checkbox')).toBeTruthy()
    expect(within(ctl as HTMLElement).getByRole('button', { name: /^Push / })).toBeTruthy()
    expect(within(ctl as HTMLElement).getByRole('button', { name: /^Edit / })).toBeTruthy()
    expect(within(ctl as HTMLElement).getByRole('button', { name: /^Delete / })).toBeTruthy()
  })

  it('checking the box pays it (stamp shown); unchecking asks first and clears it', async () => {
    mount()
    await screen.findByText('Sunbelt Rentals')
    expect(paidBox('Sunbelt Rentals').checked).toBe(false)

    fireEvent.click(paidBox('Sunbelt Rentals'))
    await waitFor(() => expect(paidBox('Sunbelt Rentals').checked).toBe(true))
    expect(writes().at(-1)).toMatchObject({ method: 'PATCH', body: { id: 'p2', status: 'paid' } })
    expect(rowFor('Sunbelt Rentals').textContent).toContain('Paid')
    // Paid money still left the bank today: the total is unchanged.
    expect(stmt('Pending in bank')).toBe('−$489,520.00')

    fireEvent.click(paidBox('Sunbelt Rentals'))
    // useConfirm renders role="alertdialog" — never window.confirm.
    const ask = await screen.findByRole('alertdialog')
    expect(window.confirm).not.toHaveBeenCalled()
    expect(ask.textContent).toContain('Mark Sunbelt Rentals unpaid?')
    fireEvent.click(within(ask).getByRole('button', { name: 'Mark unpaid' }))
    await waitFor(() => expect(paidBox('Sunbelt Rentals').checked).toBe(false))
    expect(writes().at(-1)).toMatchObject({ method: 'PATCH', body: { id: 'p2', status: 'pending' } })
  })

  it('declining the unpay confirm leaves it paid and writes nothing', async () => {
    snaps.get('2026-09-16:am')!.items = [item('p2', 'a1', 'Sunbelt Rentals', 10_200_000, 0, { status: 'paid', paidAt: '2026-09-16T18:30:00Z' })]
    mount()
    await screen.findByText('Sunbelt Rentals')
    fireEvent.click(paidBox('Sunbelt Rentals'))
    const ask = await screen.findByRole('alertdialog')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(paidBox('Sunbelt Rentals').checked).toBe(true)
    expect(writes()).toHaveLength(0)
  })

  it('Push defaults to the next day and the same snapshot, and says what stays behind', async () => {
    mount()
    await screen.findByText('Ferguson Enterprises')
    fireEvent.click(within(rowFor('Ferguson Enterprises')).getByRole('button', { name: 'Push Ferguson Enterprises to another day' }))

    const d = dialog()
    expect(within(d).getByText('Push Ferguson Enterprises')).toBeTruthy()
    expect((within(d).getByLabelText('Move to') as HTMLInputElement).value).toBe('2026-09-17')
    expect(within(d).getByRole('button', { name: 'AM' }).getAttribute('aria-pressed')).toBe('true')
    expect(d.textContent).toContain('stays on Wed, Sep 16 AM as history')

    fireEvent.click(within(d).getByRole('button', { name: 'Push it forward' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes().at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/cmr/ledger/pending/push',
      body: { id: 'p1', targetDate: '2026-09-17', targetPeriod: 'am' },
    })

    // It stayed here as history, and the balance went up by its amount.
    await waitFor(() => expect(rowFor('Ferguson Enterprises').textContent).toContain('Pushed to Thu, Sep 17 AM'))
    expect(stmt('Pending in bank')).toBe('−$279,520.00')
  })

  it('a different day and snapshot can be chosen, and the copy shows where it came from', async () => {
    mount()
    await screen.findByText('Ferguson Enterprises')
    fireEvent.click(within(rowFor('Ferguson Enterprises')).getByRole('button', { name: 'Push Ferguson Enterprises to another day' }))
    const d = dialog()
    fireEvent.change(within(d).getByLabelText('Move to'), { target: { value: '2026-09-21' } })
    fireEvent.click(within(d).getByRole('button', { name: 'PM' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Push it forward' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes().at(-1)).toMatchObject({ body: { id: 'p1', targetDate: '2026-09-21', targetPeriod: 'pm' } })

    fireEvent.change(screen.getByLabelText('Ledger date'), { target: { value: '2026-09-21' } })
    fireEvent.click(screen.getByRole('button', { name: 'PM' }))
    await screen.findByText('Ferguson Enterprises')
    expect(rowFor('Ferguson Enterprises').textContent).toContain('Pushed from Wed, Sep 16 AM')
  })

  it('the dialog refuses the snapshot it is already on, and Escape closes it without writing', async () => {
    mount()
    await screen.findByText('Ferguson Enterprises')
    fireEvent.click(within(rowFor('Ferguson Enterprises')).getByRole('button', { name: 'Push Ferguson Enterprises to another day' }))
    const d = dialog()
    fireEvent.change(within(d).getByLabelText('Move to'), { target: { value: '2026-09-16' } })
    expect((within(d).getByRole('button', { name: 'Push it forward' }) as HTMLButtonElement).disabled).toBe(true)
    expect(d.textContent).toContain('already on')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes()).toHaveLength(0)
  })

  it('a refused push is reported in-app and nothing changes on screen', async () => {
    pushFails = true
    mount()
    await screen.findByText('Ferguson Enterprises')
    fireEvent.click(within(rowFor('Ferguson Enterprises')).getByRole('button', { name: 'Push Ferguson Enterprises to another day' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Push it forward' }))
    // useAlert renders its own in-app dialog — never window.alert.
    await screen.findByText('Could not push the item')
    expect(screen.getByText('It is no longer pending.')).toBeTruthy()
    expect(window.alert).not.toHaveBeenCalled()
    expect(rowFor('Ferguson Enterprises').textContent).not.toContain('Pushed to')
  })
})

// ── Phase 6: taking a push back ─────────────────────────────────────────────

describe('CmrLedgerClient — un-push', () => {
  const rowFor = (payee: string) => screen.getByText(payee).closest('li') as HTMLElement
  const unpushBtn = (payee: string) => within(rowFor(payee)).getByRole('button', { name: `Take back the push of ${payee}` })

  const pushedItem = (over: Partial<CmrPendingItem> = {}) =>
    item('p1', 'a1', 'Ferguson Enterprises', 21_000_000, 0, {
      status: 'pushed',
      pushedTo: { date: '2026-09-17', period: 'am' },
      canUnpush: true,
      unpushBlockedReason: null,
      ...over,
    })

  it('read-only roles never see Un-push', async () => {
    canEdit = false
    snaps.get('2026-09-16:am')!.items = [pushedItem()]
    mount()
    await screen.findByText('Ferguson Enterprises')
    expect(screen.queryByRole('button', { name: /^Take back the push/ })).toBeNull()
  })

  it('asks in-app, then puts the item back and restores the day’s total', async () => {
    snaps.get('2026-09-16:am')!.items = [pushedItem(), item('p2', 'a1', 'Sunbelt Rentals', 10_200_000, 1)]
    snaps.set('2026-09-17:am', {
      beginning: 0,
      exists: true,
      adjustments: [],
      items: [item('x1', 'a1', 'Ferguson Enterprises', 21_000_000, 0, { pushedFromId: 'p1', pushedFrom: { date: '2026-09-16', period: 'am' } })],
    })
    mount()
    await screen.findByText('Ferguson Enterprises')
    expect(stmt('Pending in bank')).toBe('−$102,000.00') // the pushed one isn't counted

    fireEvent.click(unpushBtn('Ferguson Enterprises'))
    const ask = await screen.findByRole('alertdialog')
    expect(ask.textContent).toContain('Take back the push of Ferguson Enterprises?')
    expect(window.confirm).not.toHaveBeenCalled()
    fireEvent.click(within(ask).getByRole('button', { name: 'Take the push back' }))

    await waitFor(() => expect(stmt('Pending in bank')).toBe('−$312,000.00'))
    expect(writes().at(-1)).toMatchObject({ method: 'POST', url: '/api/cmr/ledger/pending/unpush', body: { id: 'p1' } })
    // Back to an ordinary pending row: no history note, and the usual controls return.
    expect(rowFor('Ferguson Enterprises').textContent).not.toContain('Pushed to')
    expect(within(rowFor('Ferguson Enterprises')).getByRole('checkbox')).toBeTruthy()

    // …and the copy is gone from the day it had been pushed to.
    fireEvent.change(screen.getByLabelText('Ledger date'), { target: { value: '2026-09-17' } })
    await waitFor(() => expect(screen.queryByText('Ferguson Enterprises')).toBeNull())
  })

  it('cancelling the confirm writes nothing', async () => {
    snaps.get('2026-09-16:am')!.items = [pushedItem()]
    mount()
    await screen.findByText('Ferguson Enterprises')
    fireEvent.click(unpushBtn('Ferguson Enterprises'))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(writes()).toHaveLength(0)
    expect(rowFor('Ferguson Enterprises').textContent).toContain('Pushed to')
  })

  it('is disabled with the reason on the row once the copy was paid or moved', async () => {
    snaps.get('2026-09-16:am')!.items = [
      pushedItem({ canUnpush: false, unpushBlockedReason: 'The item it became was already paid — mark that one unpaid first.' }),
    ]
    mount()
    await screen.findByText('Ferguson Enterprises')
    expect((unpushBtn('Ferguson Enterprises') as HTMLButtonElement).disabled).toBe(true)
    expect(rowFor('Ferguson Enterprises').textContent).toContain('Can’t be taken back: The item it became was already paid')
  })

  it('a refusal from the server is reported in-app and the row stays pushed', async () => {
    unpushFails = true
    snaps.get('2026-09-16:am')!.items = [pushedItem()]
    mount()
    await screen.findByText('Ferguson Enterprises')
    fireEvent.click(unpushBtn('Ferguson Enterprises'))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Take the push back' }))
    await screen.findByText('Could not take the push back')
    expect(window.alert).not.toHaveBeenCalled()
    expect(rowFor('Ferguson Enterprises').textContent).toContain('Pushed to')
  })
})
