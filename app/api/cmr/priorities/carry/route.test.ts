import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * Phase 6, the weekly half: CARRY an open priority into another week.
 *
 *   • defaults to the NEXT week after the one it is in; any date resolves to its Sunday
 *   • the original stays in its week flipped to 'carried' — so it leaves "still needed this
 *     week" without being deleted — and the copy is OPEN in the target week with
 *     carried_from_id back to it, keeping amount, due date, notes and the Top flag
 *   • only an OPEN priority carries: resolved, paid and already-carried are 409
 *   • the same week is refused; a carried row is still not editable by PATCH (Phase 4 rule)
 *   • CONTROLLER ONLY: requester / viewer / no-grant / platform admin → 403, nothing written
 *   • audited as cmr.priority.carry, from → to
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))
// Wednesday Sep 16 2026 (Pacific) → this week starts Sunday Sep 13.
vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

import * as carryRoute from './route'
import * as prioritiesRoute from '../route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const W = { PREV: '2026-09-06', THIS: '2026-09-13', NEXT: '2026-09-20', LATER: '2026-09-27' }
const P = {
  CDTFA: '60000000-0000-4000-8000-000000000001', // open, top, $32,000, due Fri
  LOAN: '60000000-0000-4000-8000-000000000002', // open, no amount
  DONE: '60000000-0000-4000-8000-000000000003', // resolved
  PAID: '60000000-0000-4000-8000-000000000004', // paid
  GONE: '60000000-0000-4000-8000-000000000005', // already carried
}

type Row = Record<string, unknown>

const pr = (over: Row): Row => ({
  week_start: W.THIS,
  amount_cents: 0,
  due_date: null,
  notes: null,
  is_top_priority: false,
  status: 'open',
  carried_from_id: null,
  paid_at: null,
  paid_by: null,
  sort_order: 0,
  created_by: CONTROLLER,
  created_at: '2026-09-14T15:00:00Z',
  ...over,
})

function seed(): Record<string, Row[]> {
  return {
    cmr_weekly_priorities: [
      pr({ id: P.CDTFA, description: 'CDTFA sales tax', amount_cents: 3_200_000, due_date: '2026-09-18', notes: 'Wire by noon', is_top_priority: true, sort_order: 0 }),
      pr({ id: P.LOAN, description: 'Call the lender', sort_order: 1 }),
      pr({ id: P.DONE, description: 'Resolved thing', status: 'resolved', sort_order: 2 }),
      pr({ id: P.PAID, description: 'Paid thing', amount_cents: 5_000, status: 'paid', paid_at: '2026-09-15T18:00:00Z', paid_by: CONTROLLER, sort_order: 3 }),
      pr({ id: P.GONE, description: 'Already carried', status: 'carried', sort_order: 4 }),
    ],
  }
}

function world(userId: string | null, tables: Record<string, Row[]> = seed()) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
        { id: CONTROLLER, role: 'executive', display_name: 'Cora Controller', is_active: true },
        { id: REQUESTER, role: 'admin', display_name: 'Rex Requester', is_active: true },
        { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', is_active: true },
        { id: STRANGER, role: 'executive', display_name: 'Sam Stranger', is_active: true },
      ],
      cmr_access: [
        { user_id: CONTROLLER, role: 'controller' },
        { user_id: REQUESTER, role: 'requester' },
        { user_id: VIEWER, role: 'viewer' },
      ],
      ...tables,
    },
    {
      defaults: { cmr_weekly_priorities: () => ({ id: randomUUID(), carried_from_id: null, paid_at: null, paid_by: null }) },
      unique: {
        cmr_weekly_priorities: (c) => {
          const [y, m, d] = String(c.week_start).split('-').map(Number)
          if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) return 'violates check constraint "cmr_weekly_priorities_week_start_sunday"'
          if ((c.status === 'paid') !== (c.paid_at != null)) return 'violates check constraint "cmr_weekly_priorities_paid_at_chk"'
          return null
        },
      },
      // Mirror cmr_carry_priority: copy + flip, or refuse — one call, nothing half-done.
      rpc: {
        cmr_carry_priority: (args, t) => {
          const src = t.cmr_weekly_priorities.find((r) => r.id === args.p_priority_id)
          if (!src) return { message: 'NOT_FOUND' }
          if (src.status !== 'open') return { message: 'NOT_OPEN' }
          if (src.week_start === args.p_week_start) return { message: 'SAME_WEEK' }
          const id = randomUUID()
          t.cmr_weekly_priorities.push({
            id,
            week_start: args.p_week_start,
            description: src.description,
            amount_cents: src.amount_cents,
            due_date: src.due_date,
            notes: src.notes,
            is_top_priority: src.is_top_priority,
            status: 'open',
            carried_from_id: src.id,
            paid_at: null,
            paid_by: null,
            sort_order: args.p_sort_order,
            created_by: args.p_actor,
            created_at: '2026-09-16T19:00:00Z',
          })
          src.status = 'carried'
          return { data: id }
        },
      },
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

const base = 'https://cmr.safetynetworkteams.com/api/cmr/priorities'
const req = (method: string, path = '', body?: unknown) =>
  new Request(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const api = {
  carry: (body: unknown) => carryRoute.POST(req('POST', '/carry', body)),
  edit: (body: unknown) => prioritiesRoute.PATCH(req('PATCH', '', body)),
  view: (week: string) => prioritiesRoute.GET(req('GET', `?week=${week}`)),
}

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
type AuditArg = { action: string; resourceId?: string; resourceLabel?: string; resourceType?: string; userRole?: string; metadata?: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const rowOf = (fake: ReturnType<typeof world>, id: string) => fake.tables.cmr_weekly_priorities.find((r) => r.id === id)
const copyOf = (fake: ReturnType<typeof world>, srcId: string) => fake.tables.cmr_weekly_priorities.find((r) => r.carried_from_id === srcId)
const viewOf = async (week: string) => (await bodyOf(await api.view(week))).data

beforeEach(() => { audit.logAudit.mockClear() })
afterEach(() => { vi.restoreAllMocks() })

// ── access ──────────────────────────────────────────────────────────────────

describe('carry — access', () => {
  it('route file exports only HTTP handlers + dynamic (BUG-019)', () => {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'dynamic'])
    for (const k of Object.keys(carryRoute)) expect(allowed.has(k), k).toBe(true)
    expect((carryRoute as { dynamic?: string }).dynamic).toBe('force-dynamic')
  })

  for (const [label, uid] of [['platform admin', ADMIN], ['stranger', STRANGER], ['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label}: carry is 403 — nothing written, nothing audited`, async () => {
      const fake = world(uid)
      const rs = await Promise.all([api.carry({ id: P.CDTFA }), api.carry({ id: P.CDTFA, targetWeek: W.LATER })])
      expect(rs.map((r) => r.status)).toEqual([403, 403])
      expect(writes(fake)).toHaveLength(0)
      expect(rowOf(fake, P.CDTFA)).toMatchObject({ status: 'open', week_start: W.THIS })
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session: 401', async () => {
    world(null)
    expect((await api.carry({ id: P.CDTFA })).status).toBe(401)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

// ── carry ───────────────────────────────────────────────────────────────────

describe('POST /api/cmr/priorities/carry', () => {
  it('defaults to next week; original → carried, copy is open with everything it had', async () => {
    const fake = world(CONTROLLER)
    const r = await api.carry({ id: P.CDTFA })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.to).toEqual({ weekStart: W.NEXT })

    expect(rowOf(fake, P.CDTFA)).toMatchObject({ status: 'carried', week_start: W.THIS })
    expect(copyOf(fake, P.CDTFA)).toMatchObject({
      week_start: W.NEXT,
      description: 'CDTFA sales tax',
      amount_cents: 3_200_000,
      due_date: '2026-09-18',
      notes: 'Wire by noon',
      is_top_priority: true,
      status: 'open',
      carried_from_id: P.CDTFA,
      paid_at: null,
      created_by: CONTROLLER,
    })
  })

  it('the week it left stops needing it; the week it landed in starts', async () => {
    world(CONTROLLER)
    const before = await viewOf(W.THIS)
    expect(before.totals.neededCents).toBe(3_200_000)
    expect(before.totals.openTopPriorityCount).toBe(1)

    expect((await api.carry({ id: P.CDTFA })).status).toBe(200)

    const after = await viewOf(W.THIS)
    expect(after.totals.neededCents).toBe(0)
    expect(after.totals.openTopPriorityCount).toBe(0)
    // …and it is still IN the week, as history, saying where it went.
    const left = after.priorities.find((p: any) => p.id === P.CDTFA) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(left).toMatchObject({ status: 'carried', carriedToWeek: W.NEXT })

    const next = await viewOf(W.NEXT)
    expect(next.totals.neededCents).toBe(3_200_000)
    expect(next.priorities[0]).toMatchObject({ description: 'CDTFA sales tax', status: 'open', carriedFromWeek: W.THIS, isTopPriority: true })
  })

  it('a chosen week is honoured, and any day in it resolves to its Sunday', async () => {
    const fake = world(CONTROLLER)
    expect((await api.carry({ id: P.CDTFA, targetWeek: '2026-09-30' })).status).toBe(200) // a Wednesday
    expect(copyOf(fake, P.CDTFA)).toMatchObject({ week_start: W.LATER })
  })

  it('carries backwards too, and the copy goes at the end of that week', async () => {
    const tables = seed()
    tables.cmr_weekly_priorities.push(pr({ id: randomUUID(), description: 'Older item', week_start: W.PREV, sort_order: 0 }))
    const fake = world(CONTROLLER, tables)
    expect((await api.carry({ id: P.LOAN, targetWeek: W.PREV })).status).toBe(200)
    expect(copyOf(fake, P.LOAN)).toMatchObject({ week_start: W.PREV, sort_order: 1 })
  })

  it('carrying twice is impossible: the second attempt is a 409 and writes nothing', async () => {
    const fake = world(CONTROLLER)
    expect((await api.carry({ id: P.CDTFA })).status).toBe(200)
    audit.logAudit.mockClear()
    const again = await api.carry({ id: P.CDTFA })
    expect(again.status).toBe(409)
    expect((await bodyOf(again)).code).toBe('NOT_OPEN')
    expect(fake.tables.cmr_weekly_priorities.filter((r) => r.carried_from_id === P.CDTFA)).toHaveLength(1)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('refuses a resolved / paid / already-carried priority, the same week, and anything unknown', async () => {
    const fake = world(CONTROLLER)
    for (const id of [P.DONE, P.PAID, P.GONE]) {
      const r = await api.carry({ id })
      expect(r.status).toBe(409)
      expect((await bodyOf(r)).code).toBe('NOT_OPEN')
    }
    const same = await api.carry({ id: P.CDTFA, targetWeek: W.THIS })
    expect(same.status).toBe(409)
    expect((await bodyOf(same)).code).toBe('SAME_WEEK')

    expect((await api.carry({ id: '60000000-0000-4000-8000-0000000000ff' })).status).toBe(404)
    expect((await api.carry({ id: 'not-a-uuid' })).status).toBe(400)
    expect((await api.carry({ id: P.CDTFA, targetWeek: '2026-02-31' })).status).toBe(400)

    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('the carried original stays read-only: PATCH and DELETE still refuse it', async () => {
    const fake = world(CONTROLLER)
    expect((await api.carry({ id: P.LOAN })).status).toBe(200)
    const edit = await api.edit({ id: P.LOAN, description: 'Renamed' })
    expect(edit.status).toBe(409)
    expect((await bodyOf(edit)).code).toBe('NOT_EDITABLE')
    expect(rowOf(fake, P.LOAN)).toMatchObject({ description: 'Call the lender', status: 'carried' })
  })

  it('PATCH still refuses status carried — carrying only happens here', async () => {
    const fake = world(CONTROLLER)
    const r = await api.edit({ id: P.CDTFA, status: 'carried' })
    expect(r.status).toBe(400)
    expect((await bodyOf(r)).code).toBe('USE_CARRY')
    expect(rowOf(fake, P.CDTFA)).toMatchObject({ status: 'open' })
  })

  it('a status change compare-and-swaps on the status it read, so a racing carry can’t be paid over', async () => {
    // cmr_carry_priority writes this same column from another connection (under a row lock).
    // Without the predicate an in-flight "Mark paid" could land on a priority already carried
    // into another week — and the amount would then count in both weeks.
    const fake = world(CONTROLLER)
    expect((await api.edit({ id: P.CDTFA, status: 'paid' })).status).toBe(200)
    const update = fake.calls.filter((c) => c.table === 'cmr_weekly_priorities' && c.op === 'update').at(-1)!
    expect(update.filters).toEqual(expect.arrayContaining([['id', P.CDTFA], ['status', 'open']]))
  })

  it('audits the carry from → to', async () => {
    world(CONTROLLER)
    await api.carry({ id: P.CDTFA, targetWeek: W.LATER })
    const a = auditCalls().find((x) => x.action === 'cmr.priority.carry')!
    expect(a).toMatchObject({ resourceType: 'cmr_weekly_priorities', resourceId: P.CDTFA, resourceLabel: 'CDTFA sales tax', userRole: 'cmr:controller' })
    expect(a.metadata).toMatchObject({
      from: { weekStart: W.THIS },
      to: { weekStart: W.LATER },
      amountCents: 3_200_000,
      isTopPriority: true,
      before: { status: 'open' },
      after: { status: 'carried' },
    })
  })
})
