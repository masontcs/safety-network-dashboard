// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import CmrAccountsClient from './CmrAccountsClient'
import { DialogProvider } from '@/components/ui/DialogProvider'

/**
 * Accounts screen behaviour: lists accounts (inactive badged), deactivation goes through the
 * in-app confirm (never window.confirm), reactivation doesn't, arrows reorder with the full id
 * list, edits PATCH only what changed, and a failed reorder rolls back.
 */

type Acc = { id: string; name: string; accountType: string | null; active: boolean; sortOrder: number; createdAt: string }
let accounts: Acc[]
let calls: { method: string; url: string; body: unknown }[]
let reorderFails = false

const mk = (id: string, name: string, sortOrder: number, active = true, accountType: string | null = null): Acc =>
  ({ id, name, accountType, active, sortOrder, createdAt: '2026-09-15T10:00:00Z' })

const json = (data: unknown) => Promise.resolve({ status: 200, json: () => Promise.resolve(data) })

beforeEach(() => {
  accounts = [mk('a', 'TCS', 0, true, 'Checking'), mk('b', 'Signs', 1), mk('c', 'Old', 2, false)]
  calls = []
  reorderFails = false
  window.confirm = vi.fn(() => true)
  window.alert = vi.fn()
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0 }) as typeof requestAnimationFrame
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (url === '/api/cmr/accounts' && method === 'GET') return json({ success: true, data: { accounts, canEdit: true } })
    if (url === '/api/cmr/accounts' && method === 'PATCH') {
      const b = body as Partial<Acc> & { id: string }
      accounts = accounts.map((a) => (a.id === b.id ? { ...a, ...b } : a))
      return json({ success: true, data: { account: accounts.find((a) => a.id === b.id), changed: true } })
    }
    if (url === '/api/cmr/accounts' && method === 'POST') {
      const b = body as { name: string; accountType: string | null }
      const acc = mk('n', b.name, accounts.length, true, b.accountType)
      accounts = [...accounts, acc]
      return json({ success: true, data: { account: acc } })
    }
    if (url === '/api/cmr/accounts/reorder') {
      if (reorderFails) return json({ success: false, error: 'Boom', code: 'INTERNAL_ERROR' })
      return json({ success: true, data: { changed: true } })
    }
    return json({ success: false, error: 'unexpected' })
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

const mount = () => render(<DialogProvider><CmrAccountsClient /></DialogProvider>)
const rows = () =>
  screen.getAllByRole('listitem').map((li) => within(li).getByRole('button', { name: /^Edit / }).getAttribute('aria-label')!.slice(5))

describe('CmrAccountsClient', () => {
  it('lists accounts in order with inactive badged', async () => {
    mount()
    await screen.findByText('TCS')
    expect(rows()).toEqual(['TCS', 'Signs', 'Old'])
    expect(screen.getByText('Inactive', { selector: '.cmr-pill' })).toBeTruthy()
    expect(screen.getByText('3 accounts · 1 inactive')).toBeTruthy()
  })

  it('deactivating asks with the in-app dialog, then PATCHes active=false', async () => {
    mount()
    await screen.findByText('TCS')
    fireEvent.click(screen.getByRole('switch', { name: 'TCS active' }))
    const dialog = await screen.findByText('Deactivate TCS?')
    expect(dialog).toBeTruthy()
    expect(window.confirm).not.toHaveBeenCalled()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ id: 'a', active: false }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'TCS active' }).getAttribute('aria-checked')).toBe('false'))
  })

  it('cancelling the dialog changes nothing', async () => {
    mount()
    await screen.findByText('TCS')
    fireEvent.click(screen.getByRole('switch', { name: 'TCS active' }))
    await screen.findByText('Deactivate TCS?')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Deactivate TCS?')).toBeNull())
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('reactivating needs no confirmation', async () => {
    mount()
    await screen.findByText('Old')
    fireEvent.click(screen.getByRole('switch', { name: 'Old active' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ id: 'c', active: true }))
  })

  it('move-down sends the full new order', async () => {
    mount()
    await screen.findByText('TCS')
    expect((screen.getByRole('button', { name: 'Move TCS up' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move TCS down' }))
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/reorder'))?.body).toEqual({ ids: ['b', 'a', 'c'] }))
    await waitFor(() => expect(rows()).toEqual(['Signs', 'TCS', 'Old']))
    expect(document.querySelector('p.cmr-sr-only[role="status"]')?.textContent).toBe('TCS moved to position 2 of 3.')
  })

  it('a failed reorder rolls back and shows the error', async () => {
    reorderFails = true
    mount()
    await screen.findByText('TCS')
    fireEvent.click(screen.getByRole('button', { name: 'Move Signs up' }))
    await screen.findByText('Could not save the new order')
    expect(rows()).toEqual(['TCS', 'Signs', 'Old'])
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('edit saves only the changed fields; Escape cancels', async () => {
    mount()
    await screen.findByText('TCS')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Signs' }))
    const nameInput = screen.getByRole('textbox', { name: 'Name for Signs' })
    fireEvent.change(nameInput, { target: { value: 'SN Signs' } })
    fireEvent.submit(nameInput.closest('form')!)
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ id: 'b', name: 'SN Signs' }))
    await screen.findByText('SN Signs')

    fireEvent.click(screen.getByRole('button', { name: 'Edit TCS' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name for TCS' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name for TCS' })).toBeNull())
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
  })

  it('adds an account with an optional type', async () => {
    mount()
    await screen.findByText('TCS')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'INC' } })
    fireEvent.click(screen.getByRole('button', { name: /Add account/ }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'INC', accountType: null }))
    await screen.findByText('INC')
  })
})
