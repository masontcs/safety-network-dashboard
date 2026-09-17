import { describe, it, expect } from 'vitest'
import {
  CMR_REQUEST_PLACED_KIND_LABEL,
  CMR_REQUEST_STATUS_LABEL,
  CMR_REQUEST_VENDOR_MAX,
  canModifyRequest,
  compareHistory,
  compareQueued,
  computeRequestTotals,
  isPlacedKind,
  isQueued,
  isRequestStatus,
  modifyRefusal,
  parsePlaceTarget,
  parseRequestAmount,
  parseRequestDueDate,
  parseRequestNotes,
  parseVendor,
  toCmrRequest,
  type CmrRequest,
  type CmrRequestRow,
} from '@/lib/cmr/requests'

const ME = '00000000-0000-4000-8000-0000000000aa'
const THEM = '00000000-0000-4000-8000-0000000000bb'
const ACC = '00000000-0000-4000-8000-0000000000cc'

const row = (over: Partial<CmrRequestRow> = {}): CmrRequestRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  requested_by: ME,
  account_id: ACC,
  vendor: 'Sunbelt Rentals',
  amount_cents: 125_000,
  due_date: null,
  notes: null,
  status: 'queued',
  placed_kind: null,
  placed_ref_id: null,
  placed_at: null,
  placed_by: null,
  created_at: '2026-09-15T15:00:00Z',
  ...over,
})

const req = (over: Partial<CmrRequest> = {}): CmrRequest => ({ ...toCmrRequest(row()), ...over })

describe('canModifyRequest / modifyRefusal — own row, still queued', () => {
  const controller = { userId: THEM, role: 'controller' as const }
  const meRequester = { userId: ME, role: 'requester' as const }
  const themRequester = { userId: THEM, role: 'requester' as const }
  const viewer = { userId: ME, role: 'viewer' as const }

  it('a requester may change their OWN queued request', () => {
    expect(canModifyRequest(row(), meRequester)).toBe(true)
    expect(modifyRefusal(row(), meRequester)).toBeNull()
  })

  it('a requester may NOT change someone else’s — 403', () => {
    expect(canModifyRequest(row(), themRequester)).toBe(false)
    expect(modifyRefusal(row(), themRequester)).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('nobody may change a request that has left the queue — 409, Controller included', () => {
    for (const status of ['placed', 'paid', 'declined'] as const) {
      const r = row({ status })
      for (const actor of [meRequester, controller]) {
        expect(canModifyRequest(r, actor)).toBe(false)
        expect(modifyRefusal(r, actor)).toMatchObject({ status: 409, code: 'NOT_EDITABLE' })
      }
    }
  })

  it('a controller may change ANY queued request', () => {
    expect(canModifyRequest(row(), controller)).toBe(true)
    expect(canModifyRequest(row({ requested_by: THEM }), controller)).toBe(true)
  })

  it('a viewer may never change anything, even their own', () => {
    expect(canModifyRequest(row(), viewer)).toBe(false)
    expect(modifyRefusal(row(), viewer)).toMatchObject({ status: 403 })
  })

  it('isQueued is the gate', () => {
    expect(isQueued(row())).toBe(true)
    expect(isQueued(row({ status: 'placed' }))).toBe(false)
  })
})

describe('totals and ordering', () => {
  it('counts the queue, what it asks for, and the caller’s own share', () => {
    const queued = [
      req({ id: 'a', requestedBy: ME, amountCents: 100 }),
      req({ id: 'b', requestedBy: THEM, amountCents: 250 }),
      req({ id: 'c', requestedBy: ME, amountCents: 0 }),
    ]
    const history = [
      req({ id: 'd', status: 'placed', amountCents: 900 }),
      req({ id: 'e', status: 'paid', amountCents: 50 }),
      req({ id: 'f', status: 'declined', amountCents: 10 }),
    ]
    expect(computeRequestTotals(queued, history, ME)).toEqual({
      queuedCount: 3,
      queuedCents: 350,
      historyCount: 3,
      placedCount: 2, // placed + paid
      declinedCount: 1,
      mineQueuedCount: 2,
    })
  })

  it('the queue is oldest first, the history newest first', () => {
    const older = { createdAt: '2026-09-15T10:00:00Z', id: 'a' }
    const newer = { createdAt: '2026-09-15T12:00:00Z', id: 'b' }
    expect([newer, older].sort(compareQueued).map((x) => x.id)).toEqual(['a', 'b'])
    expect([older, newer].sort(compareHistory).map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('same-instant rows still have a total order', () => {
    const a = { createdAt: '2026-09-15T10:00:00Z', id: 'a' }
    const b = { createdAt: '2026-09-15T10:00:00Z', id: 'b' }
    expect([b, a].sort(compareQueued).map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('toCmrRequest', () => {
  const accounts = new Map([[ACC, { id: ACC, name: 'TCS', accountType: 'Checking', active: true, sortOrder: 0 }]])
  const names = new Map([
    [ME, 'Jordan Requester'],
    [THEM, 'Mason Doty'],
  ])

  it('joins the account and both display names', () => {
    const r = toCmrRequest(row({ status: 'placed', placed_kind: 'priority', placed_by: THEM, placed_at: '2026-09-16T00:00:00Z', placed_ref_id: 'x' }), accounts, names)
    expect(r).toMatchObject({
      accountName: 'TCS',
      accountActive: true,
      requestedByName: 'Jordan Requester',
      placedByName: 'Mason Doty',
      placedKind: 'priority',
    })
  })

  it('survives an unknown account or a removed profile', () => {
    const r = toCmrRequest(row())
    expect(r).toMatchObject({ accountName: 'Unknown account', accountActive: false, requestedByName: null, placedByName: null })
  })

  it('normalises bigint cents that arrive as a string', () => {
    expect(toCmrRequest(row({ amount_cents: '125000' as unknown as number })).amountCents).toBe(125_000)
  })
})

describe('validation', () => {
  it('vendor: required, squashed, ≤ 80 (the pending-item payee limit)', () => {
    expect(CMR_REQUEST_VENDOR_MAX).toBe(80)
    expect(parseVendor('  Sunbelt   Rentals ')).toEqual({ ok: true, value: 'Sunbelt Rentals' })
    expect(parseVendor('   ').ok).toBe(false)
    expect(parseVendor(42).ok).toBe(false)
    expect(parseVendor('x'.repeat(80)).ok).toBe(true)
    expect(parseVendor('x'.repeat(81)).ok).toBe(false)
  })

  it('amount: optional (→ 0), whole cents, never negative', () => {
    expect(parseRequestAmount(undefined)).toEqual({ ok: true, value: 0 })
    expect(parseRequestAmount(null)).toEqual({ ok: true, value: 0 })
    expect(parseRequestAmount(125_000)).toEqual({ ok: true, value: 125_000 })
    expect(parseRequestAmount(-1).ok).toBe(false)
    expect(parseRequestAmount(12.5).ok).toBe(false)
    expect(parseRequestAmount('100').ok).toBe(false)
    expect(parseRequestAmount(99_999_999_999).ok).toBe(true)
    expect(parseRequestAmount(100_000_000_000).ok).toBe(false)
  })

  it('notes: optional, ≤ 500, blank → null', () => {
    expect(parseRequestNotes(undefined)).toEqual({ ok: true, value: null })
    expect(parseRequestNotes('   ')).toEqual({ ok: true, value: null })
    expect(parseRequestNotes('y'.repeat(500)).ok).toBe(true)
    expect(parseRequestNotes('y'.repeat(501)).ok).toBe(false)
  })

  it('due date: optional, a real calendar day', () => {
    expect(parseRequestDueDate('')).toEqual({ ok: true, value: null })
    expect(parseRequestDueDate('2026-09-19')).toEqual({ ok: true, value: '2026-09-19' })
    expect(parseRequestDueDate('2026-02-30').ok).toBe(false)
    expect(parseRequestDueDate('19/09/2026').ok).toBe(false)
  })

  it('place target: pending or priority, nothing else', () => {
    expect(parsePlaceTarget('pending')).toEqual({ ok: true, value: 'pending' })
    expect(parsePlaceTarget('priority')).toEqual({ ok: true, value: 'priority' })
    for (const v of ['ledger', '', null, undefined, 1]) expect(parsePlaceTarget(v).ok).toBe(false)
    expect(isPlacedKind('pending')).toBe(true)
    expect(isPlacedKind('elsewhere')).toBe(false)
  })

  it('status guard matches the DB CHECK', () => {
    for (const s of ['queued', 'placed', 'paid', 'declined']) expect(isRequestStatus(s)).toBe(true)
    for (const s of ['open', 'pending', '', null]) expect(isRequestStatus(s)).toBe(false)
    expect(Object.keys(CMR_REQUEST_STATUS_LABEL).sort()).toEqual(['declined', 'paid', 'placed', 'queued'])
    expect(Object.keys(CMR_REQUEST_PLACED_KIND_LABEL).sort()).toEqual(['pending', 'priority'])
  })
})
