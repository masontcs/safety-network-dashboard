import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/cmr/recurring (+ /reorder) access rules and behaviour.
 *   • no grant (platform admin included) → 403 on EVERY method, incl. GET
 *   • requester / viewer → GET 200 (read everything); POST / PATCH / reorder 403, no writes/audit
 *   • no session → 401 everywhere
 *   • controller → create in each section, edit, move section, last amount sent, hold/release,
 *     deactivate / reactivate, reorder — each audited with before → after
 *   • validation: section, urgent-only plan fields, integer cents, active-account-only
 *   • there is no DELETE handler at all (vendors are deactivated, never deleted)
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))

import * as recurringRoute from './route'
import * as reorderRoute from './reorder/route'
const { GET, POST, PATCH } = recurringRoute
const REORDER = reorderRoute.POST

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const ACC = {
  TCS: '10000000-0000-4000-8000-000000000001',
  STS: '10000000-0000-4000-8000-000000000002',
  OLD: '10000000-0000-4000-8000-000000000003',
}
const V = {
  RENT: '20000000-0000-4000-8000-000000000001',
  FUEL: '20000000-0000-4000-8000-000000000002',
  TIRES: '20000000-0000-4000-8000-000000000003',
  IRS: '20000000-0000-4000-8000-000000000004',
  GONE: '20000000-0000-4000-8000-000000000005',
  ORPHAN: '20000000-0000-4000-8000-000000000006',
}

type Row = Record<string, unknown>

const vendor = (over: Row): Row => ({
  account_id: ACC.TCS,
  amount_cents: 0,
  recurrence_detail: null,
  last_amount_sent_cents: null,
  plan_terms: null,
  plan_due_date: null,
  notes: null,
  on_hold: false,
  active: true,
  sort_order: 0,
  created_by: CONTROLLER,
  created_at: '2026-09-16T10:00:00Z',
  ...over,
})

const seedVendors = (): Row[] => [
  vendor({ id: V.RENT, vendor_name: 'Yard rent', section: 'monthly', amount_cents: 250000, recurrence_detail: '1st of the month' }),
  vendor({ id: V.TIRES, vendor_name: 'Tire shop', section: 'weekly', amount_cents: 45050, sort_order: 1, account_id: ACC.STS }),
  vendor({ id: V.FUEL, vendor_name: 'Fuel card', section: 'weekly', amount_cents: 120000, sort_order: 0, recurrence_detail: 'Every Thursday' }),
  vendor({ id: V.IRS, vendor_name: 'IRS plan', section: 'urgent', amount_cents: 150000, plan_terms: '$1,500/wk until paid', plan_due_date: '2026-12-31' }),
  vendor({ id: V.GONE, vendor_name: 'Old uniforms', section: 'weekly', amount_cents: 9900, sort_order: 2, active: false }),
  vendor({ id: V.ORPHAN, vendor_name: 'Retired acct vendor', section: 'monthly', amount_cents: 100, sort_order: 1, active: false, account_id: ACC.OLD }),
]

function world(userId: string | null, vendors: Row[] = seedVendors(), opts: { failTables?: string[] } = {}) {
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
      cmr_accounts: [
        { id: ACC.TCS, name: 'TCS', active: true, sort_order: 0 },
        { id: ACC.STS, name: 'STS', active: true, sort_order: 1 },
        { id: ACC.OLD, name: 'Old Payroll', active: false, sort_order: 2 },
      ],
      cmr_recurring_vendors: vendors,
    },
    {
      failTables: opts.failTables,
      defaults: { cmr_recurring_vendors: () => ({ id: randomUUID() }) },
      // Mirrors cmr_reorder_recurring_vendors(p_ids): sort_order = 0-based position.
      rpc: {
        cmr_reorder_recurring_vendors: (args, tables) => {
          const ids = args.p_ids as string[]
          ids.forEach((id, i) => {
            const r = tables.cmr_recurring_vendors.find((x) => x.id === id)
            if (r) r.sort_order = i
          })
          return null
        },
      },
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

const url = 'https://cmr.safetynetworkteams.com/api/cmr/recurring'
const req = (method: string, body?: unknown, path = '') =>
  new Request(url + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
const reorder = (body: unknown) => REORDER(req('POST', body, '/reorder'))

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
const rowOf = (fake: ReturnType<typeof world>, id: string) => fake.tables.cmr_recurring_vendors.find((r) => r.id === id)!
const orderOf = (fake: ReturnType<typeof world>, section: string) =>
  fake.tables.cmr_recurring_vendors
    .filter((r) => r.section === section)
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
    .map((r) => r.vendor_name)
type AuditArg = { action: string; resourceId?: string; resourceType?: string; userRole?: string; metadata?: Record<string, unknown> }
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)

const newVendor = (over: Row = {}) => ({
  accountId: ACC.TCS,
  vendorName: 'Porta-potty rental',
  section: 'weekly',
  amountCents: 32500,
  recurrenceDetail: 'Every Friday',
  ...over,
})

beforeEach(() => { audit.logAudit.mockClear() })

describe('/api/cmr/recurring — access', () => {
  it('has no DELETE handler (deactivate only)', () => {
    expect('DELETE' in recurringRoute).toBe(false)
    expect('DELETE' in reorderRoute).toBe(false)
  })

  it('platform admin with NO grant: 403 on GET, POST, PATCH and reorder — nothing read or written', async () => {
    for (const uid of [ADMIN, STRANGER]) {
      const fake = world(uid)
      const statuses = [
        (await GET()).status,
        (await POST(req('POST', newVendor()))).status,
        (await PATCH(req('PATCH', { id: V.RENT, active: false }))).status,
        (await reorder({ section: 'weekly', ids: [V.TIRES, V.FUEL, V.GONE] })).status,
      ]
      expect(statuses).toEqual([403, 403, 403, 403])
      expect(writes(fake)).toHaveLength(0)
      expect(fake.calls.some((c) => c.table === 'cmr_recurring_vendors' || c.table === 'cmr_accounts')).toBe(false)
    }
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  for (const [label, uid] of [['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label}: GET 200 read-only; create / edit / hold / deactivate / reorder all 403 with no writes`, async () => {
      const fake = world(uid)
      const g = await GET()
      expect(g.status).toBe(200)
      const { data } = await g.json()
      expect(data.canEdit).toBe(false)
      expect(data.vendors).toHaveLength(6)
      expect(data.accounts).toHaveLength(3)

      const results = [
        await POST(req('POST', newVendor())),
        await PATCH(req('PATCH', { id: V.RENT, vendorName: 'Hacked', amountCents: 1 })),
        await PATCH(req('PATCH', { id: V.RENT, onHold: true })),
        await PATCH(req('PATCH', { id: V.RENT, active: false })),
        await PATCH(req('PATCH', { id: V.RENT, lastAmountSentCents: 5 })),
        await reorder({ section: 'weekly', ids: [V.TIRES, V.FUEL, V.GONE] }),
      ]
      expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403])
      for (const r of results) expect((await r.json()).code).toBe('FORBIDDEN')
      expect(writes(fake)).toHaveLength(0)
      expect(rowOf(fake, V.RENT)).toMatchObject({ vendor_name: 'Yard rent', on_hold: false, active: true, amount_cents: 250000 })
      expect(orderOf(fake, 'weekly')).toEqual(['Fuel card', 'Tire shop', 'Old uniforms'])
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session: 401 on every method', async () => {
    const fake = world(null)
    const statuses = [
      (await GET()).status,
      (await POST(req('POST', newVendor()))).status,
      (await PATCH(req('PATCH', { id: V.RENT, active: false }))).status,
      (await reorder({ section: 'weekly', ids: [V.FUEL] })).status,
    ]
    expect(statuses).toEqual([401, 401, 401, 401])
    expect(fake.calls).toHaveLength(0)
  })

  it('fails closed (500, no data) when the grant lookup errors', async () => {
    world(CONTROLLER, seedVendors(), { failTables: ['cmr_access'] })
    const r = await GET()
    expect(r.status).toBe(500)
    expect((await r.json()).data).toBeUndefined()
  })
})

describe('/api/cmr/recurring — GET', () => {
  it('controller gets canEdit, every vendor (inactive too) in section order, with account names', async () => {
    world(CONTROLLER)
    const { data } = await (await GET()).json()
    expect(data.canEdit).toBe(true)
    expect(data.vendors.map((v: { vendorName: string }) => v.vendorName)).toEqual([
      'Fuel card', 'Tire shop', 'Old uniforms', // weekly
      'Yard rent', 'Retired acct vendor', // monthly
      'IRS plan', // urgent
    ])
    const tires = data.vendors.find((v: { id: string }) => v.id === V.TIRES)
    expect(tires).toMatchObject({ accountName: 'STS', accountActive: true, amountCents: 45050, section: 'weekly', onHold: false, active: true })
    const orphan = data.vendors.find((v: { id: string }) => v.id === V.ORPHAN)
    expect(orphan).toMatchObject({ accountName: 'Old Payroll', accountActive: false, active: false })
    const irs = data.vendors.find((v: { id: string }) => v.id === V.IRS)
    expect(irs).toMatchObject({ planTerms: '$1,500/wk until paid', planDueDate: '2026-12-31' })
  })

  it('a read error is a 500, not an empty list', async () => {
    world(VIEWER, seedVendors(), { failTables: ['cmr_recurring_vendors'] })
    expect((await GET()).status).toBe(500)
  })
})

describe('/api/cmr/recurring — create (controller)', () => {
  it('creates in each section, appended at the end of that section, and audits the full after', async () => {
    const fake = world(CONTROLLER)
    const w = await POST(req('POST', newVendor({ vendorName: '  Porta   potty ', notes: '  Call Tue\n\n ' })))
    expect(w.status).toBe(201)
    const created = (await w.json()).data.vendor
    expect(created).toMatchObject({ vendorName: 'Porta potty', section: 'weekly', amountCents: 32500, accountName: 'TCS', notes: 'Call Tue', onHold: false, active: true, sortOrder: 3 })

    const m = await POST(req('POST', newVendor({ vendorName: 'Insurance', section: 'monthly', amountCents: 0, recurrenceDetail: '' })))
    expect(m.status).toBe(201)
    expect((await m.json()).data.vendor).toMatchObject({ section: 'monthly', sortOrder: 2, amountCents: 0, recurrenceDetail: null })

    const u = await POST(req('POST', newVendor({ vendorName: 'EDD', section: 'urgent', planTerms: '$500/mo', planDueDate: '2027-01-15', accountId: ACC.STS })))
    expect(u.status).toBe(201)
    expect((await u.json()).data.vendor).toMatchObject({ section: 'urgent', planTerms: '$500/mo', planDueDate: '2027-01-15', sortOrder: 1, accountName: 'STS' })

    expect(orderOf(fake, 'weekly')).toEqual(['Fuel card', 'Tire shop', 'Old uniforms', 'Porta potty'])
    const inserted = fake.calls.filter((c) => c.op === 'insert' && c.table === 'cmr_recurring_vendors')
    expect(inserted).toHaveLength(3)
    expect(inserted[0].payload).toMatchObject({ created_by: CONTROLLER, last_amount_sent_cents: null, on_hold: false, active: true })

    const calls = auditCalls()
    expect(calls.map((c) => c.action)).toEqual(['cmr.recurring.create', 'cmr.recurring.create', 'cmr.recurring.create'])
    expect(calls[0]).toMatchObject({ resourceType: 'cmr_recurring_vendors', resourceId: created.id, userRole: 'cmr:controller' })
    expect(calls[0].metadata).toEqual({
      before: null,
      after: {
        vendorName: 'Porta potty', accountId: ACC.TCS, accountName: 'TCS', section: 'weekly', amountCents: 32500,
        recurrenceDetail: 'Every Friday', notes: 'Call Tue', planTerms: null, planDueDate: null,
        lastAmountSentCents: null, onHold: false, active: true, sortOrder: 3,
      },
    })
  })

  it('validates section, name and required fields', async () => {
    const fake = world(CONTROLLER)
    const cases: [Row, RegExp][] = [
      [newVendor({ section: 'daily' }), /Choose a section/],
      [newVendor({ section: undefined }), /Choose a section/],
      [newVendor({ vendorName: '   ' }), /Enter a vendor name/],
      [newVendor({ vendorName: 'x'.repeat(81) }), /at most 80/],
      [newVendor({ accountId: 'nope' }), /Choose an account/],
      [newVendor({ recurrenceDetail: 'r'.repeat(81) }), /Recurrence can be at most 80/],
      [newVendor({ notes: 'n'.repeat(501) }), /Notes can be at most 500/],
      [newVendor({ notes: 12 }), /Notes must be text/],
    ]
    for (const [body, msg] of cases) {
      const r = await POST(req('POST', body))
      expect(r.status, JSON.stringify(body)).toBe(400)
      expect((await r.json()).error).toMatch(msg)
    }
    expect((await POST(req('POST', 'not json'))).status).toBe(400)
    expect((await POST(req('POST', [1, 2]))).status).toBe(400)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('money must be whole, non-negative cents (no strings, floats or overflow)', async () => {
    const fake = world(CONTROLLER)
    for (const amountCents of [-1, 12.5, '1000', null, undefined, 100_000_000_000, Number.MAX_SAFE_INTEGER + 2, NaN]) {
      const r = await POST(req('POST', newVendor({ amountCents })))
      expect(r.status, String(amountCents)).toBe(400)
      expect((await r.json()).error).toMatch(/Amount/)
    }
    expect(writes(fake)).toHaveLength(0)
    const ok = await POST(req('POST', newVendor({ amountCents: 99_999_999_999 })))
    expect(ok.status).toBe(201)
    expect((await ok.json()).data.vendor.amountCents).toBe(99_999_999_999)
  })

  it('plan terms / due date are accepted ONLY for urgent vendors, and the date must be real', async () => {
    const fake = world(CONTROLLER)
    for (const section of ['weekly', 'monthly']) {
      for (const extra of [{ planTerms: '$100/wk' }, { planDueDate: '2026-12-01' }]) {
        const r = await POST(req('POST', newVendor({ section, ...extra })))
        expect(r.status).toBe(400)
        expect((await r.json()).error).toMatch(/only apply to Urgent Payment Plans/)
      }
      // Blank plan fields are fine (they're simply null).
      expect((await POST(req('POST', newVendor({ section, planTerms: '  ', planDueDate: '' })))).status).toBe(201)
    }
    for (const planDueDate of ['2026-02-30', '12/01/2026', '2026-13-01', 20261201]) {
      const r = await POST(req('POST', newVendor({ section: 'urgent', planDueDate })))
      expect(r.status, String(planDueDate)).toBe(400)
    }
    const r = await POST(req('POST', newVendor({ section: 'urgent', planTerms: 'p'.repeat(201) })))
    expect((await r.json()).error).toMatch(/Plan terms can be at most 200/)
    expect(fake.calls.filter((c) => c.op === 'insert')).toHaveLength(2)
  })

  it('only an ACTIVE account can be chosen: inactive → 409, unknown → 404', async () => {
    const fake = world(CONTROLLER)
    const inactive = await POST(req('POST', newVendor({ accountId: ACC.OLD })))
    expect(inactive.status).toBe(409)
    expect(await inactive.json()).toMatchObject({ code: 'ACCOUNT_INACTIVE' })
    const unknown = await POST(req('POST', newVendor({ accountId: randomUUID() })))
    expect(unknown.status).toBe(404)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a DB check violation is a 400, not a 500', async () => {
    const fake = world(CONTROLLER)
    const insert = fake.client.from
    fake.client.from = ((t: string) => {
      const q = insert(t)
      if (t !== 'cmr_recurring_vendors') return q
      const origInsert = q.insert.bind(q)
      q.insert = ((p: Row) => {
        origInsert(p)
        return { select: () => ({ single: async () => ({ data: null, error: { code: '23514', message: 'violates check constraint' } }) }) }
      }) as unknown as typeof q.insert
      return q
    }) as typeof fake.client.from
    const r = await POST(req('POST', newVendor()))
    expect(r.status).toBe(400)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

describe('/api/cmr/recurring — edit (controller)', () => {
  it('edits fields and audits ONE update entry with before → after of only the changed fields', async () => {
    const fake = world(CONTROLLER)
    const r = await PATCH(req('PATCH', {
      id: V.FUEL,
      vendorName: 'Fuel card (WEX)',
      amountCents: 130000,
      accountId: ACC.STS,
      recurrenceDetail: 'Every Thursday', // unchanged → not written / not audited
      notes: 'Limit raised',
    }))
    expect(r.status).toBe(200)
    const { data } = await r.json()
    expect(data.changed).toBe(true)
    expect(data.vendor).toMatchObject({ vendorName: 'Fuel card (WEX)', amountCents: 130000, accountName: 'STS', notes: 'Limit raised' })
    const upd = fake.calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ vendor_name: 'Fuel card (WEX)', amount_cents: 130000, account_id: ACC.STS, notes: 'Limit raised' })
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.recurring.update',
        resourceId: V.FUEL,
        metadata: {
          before: { vendorName: 'Fuel card', accountId: ACC.TCS, accountName: 'TCS', amountCents: 120000, notes: null },
          after: { vendorName: 'Fuel card (WEX)', accountId: ACC.STS, accountName: 'STS', amountCents: 130000, notes: 'Limit raised' },
        },
      }),
    ])
  })

  it('a PATCH that changes nothing writes nothing and audits nothing', async () => {
    const fake = world(CONTROLLER)
    const r = await PATCH(req('PATCH', { id: V.RENT, vendorName: ' Yard  rent ', amountCents: 250000, onHold: false }))
    expect(r.status).toBe(200)
    expect((await r.json()).data.changed).toBe(false)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('rejects bad input: unknown vendor 404, bad id, empty patch, bad cents/booleans', async () => {
    const fake = world(CONTROLLER)
    expect((await PATCH(req('PATCH', { id: randomUUID(), active: false }))).status).toBe(404)
    const cases: Row[] = [
      { id: 'x', active: false },
      { id: V.RENT },
      { id: V.RENT, amountCents: -5 },
      { id: V.RENT, amountCents: 10.01 },
      { id: V.RENT, amountCents: null },
      { id: V.RENT, lastAmountSentCents: -1 },
      { id: V.RENT, lastAmountSentCents: '50' },
      { id: V.RENT, onHold: 'yes' },
      { id: V.RENT, active: 1 },
      { id: V.RENT, section: 'yearly' },
      { id: V.RENT, vendorName: '' },
      { id: V.RENT, accountId: '' },
    ]
    for (const body of cases) expect((await PATCH(req('PATCH', body))).status, JSON.stringify(body)).toBe(400)
    expect(writes(fake)).toHaveLength(0)
  })

  it('cannot move a vendor onto an inactive (409) or unknown (404) account', async () => {
    const fake = world(CONTROLLER)
    const r = await PATCH(req('PATCH', { id: V.RENT, accountId: ACC.OLD }))
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('ACCOUNT_INACTIVE')
    expect((await PATCH(req('PATCH', { id: V.RENT, accountId: randomUUID() }))).status).toBe(404)
    expect(writes(fake)).toHaveLength(0)
  })

  it('plan fields: editable on urgent vendors; refused on weekly/monthly', async () => {
    const fake = world(CONTROLLER)
    const ok = await PATCH(req('PATCH', { id: V.IRS, planTerms: '$2,000/wk', planDueDate: null }))
    expect(ok.status).toBe(200)
    expect(rowOf(fake, V.IRS)).toMatchObject({ plan_terms: '$2,000/wk', plan_due_date: null })
    expect(auditCalls()[0]).toMatchObject({
      action: 'cmr.recurring.update',
      metadata: { before: { planTerms: '$1,500/wk until paid', planDueDate: '2026-12-31' }, after: { planTerms: '$2,000/wk', planDueDate: null } },
    })

    for (const body of [{ planTerms: 'x' }, { planDueDate: '2026-11-01' }]) {
      const r = await PATCH(req('PATCH', { id: V.RENT, ...body }))
      expect(r.status).toBe(400)
      expect((await r.json()).error).toMatch(/only apply to Urgent/)
    }
    // Moving INTO urgent with plan fields in the same request is fine.
    const into = await PATCH(req('PATCH', { id: V.RENT, section: 'urgent', planTerms: 'Catch up by Dec' }))
    expect(into.status).toBe(200)
    expect(rowOf(fake, V.RENT)).toMatchObject({ section: 'urgent', plan_terms: 'Catch up by Dec', sort_order: 1 })
  })

  it('moving out of urgent clears plan fields, appends to the new section, and audits a move', async () => {
    const fake = world(CONTROLLER)
    const r = await PATCH(req('PATCH', { id: V.IRS, section: 'weekly' }))
    expect(r.status).toBe(200)
    expect((await r.json()).data.vendor).toMatchObject({ section: 'weekly', planTerms: null, planDueDate: null, sortOrder: 3 })
    expect(rowOf(fake, V.IRS)).toMatchObject({ section: 'weekly', plan_terms: null, plan_due_date: null, sort_order: 3 })
    expect(orderOf(fake, 'weekly')).toEqual(['Fuel card', 'Tire shop', 'Old uniforms', 'IRS plan'])
    expect(orderOf(fake, 'urgent')).toEqual([])
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.recurring.move',
        metadata: {
          before: { section: 'urgent', sortOrder: 0, planTerms: '$1,500/wk until paid', planDueDate: '2026-12-31' },
          after: { section: 'weekly', sortOrder: 3, planTerms: null, planDueDate: null },
        },
      }),
    ])
    // ...but plan values can't ride along into a non-urgent section.
    const bad = await PATCH(req('PATCH', { id: V.FUEL, section: 'monthly', planTerms: 'nope' }))
    expect(bad.status).toBe(400)
  })

  it('sets and clears the last amount sent (audited as last_sent)', async () => {
    const fake = world(CONTROLLER)
    expect((await PATCH(req('PATCH', { id: V.RENT, lastAmountSentCents: 249999 }))).status).toBe(200)
    expect(rowOf(fake, V.RENT).last_amount_sent_cents).toBe(249999)
    expect((await PATCH(req('PATCH', { id: V.RENT, lastAmountSentCents: null }))).status).toBe(200)
    expect(rowOf(fake, V.RENT).last_amount_sent_cents).toBeNull()
    expect(auditCalls().map((c) => [c.action, c.metadata])).toEqual([
      ['cmr.recurring.last_sent', { before: { lastAmountSentCents: null }, after: { lastAmountSentCents: 249999 } }],
      ['cmr.recurring.last_sent', { before: { lastAmountSentCents: 249999 }, after: { lastAmountSentCents: null } }],
    ])
  })

  it('on hold is separate from active: hold / release keep the vendor active', async () => {
    const fake = world(CONTROLLER)
    const h = await PATCH(req('PATCH', { id: V.FUEL, onHold: true }))
    expect((await h.json()).data.vendor).toMatchObject({ onHold: true, active: true })
    expect(rowOf(fake, V.FUEL)).toMatchObject({ on_hold: true, active: true })
    await PATCH(req('PATCH', { id: V.FUEL, onHold: false }))
    expect(rowOf(fake, V.FUEL)).toMatchObject({ on_hold: false, active: true })
    expect(auditCalls().map((c) => [c.action, c.metadata])).toEqual([
      ['cmr.recurring.hold', { before: { onHold: false }, after: { onHold: true } }],
      ['cmr.recurring.release', { before: { onHold: true }, after: { onHold: false } }],
    ])
  })

  it('no hard delete: deactivate keeps the row (listed, flagged), reactivate brings it back', async () => {
    const fake = world(CONTROLLER)
    expect((await PATCH(req('PATCH', { id: V.RENT, active: false }))).status).toBe(200)
    expect(fake.tables.cmr_recurring_vendors).toHaveLength(6)
    expect(fake.calls.some((c) => c.op === 'delete')).toBe(false)
    const listed = (await (await GET()).json()).data.vendors.find((v: { id: string }) => v.id === V.RENT)
    expect(listed).toMatchObject({ active: false, vendorName: 'Yard rent' })

    expect((await PATCH(req('PATCH', { id: V.RENT, active: true }))).status).toBe(200)
    expect(rowOf(fake, V.RENT).active).toBe(true)
    expect(auditCalls().map((c) => [c.action, c.metadata])).toEqual([
      ['cmr.recurring.deactivate', { before: { active: true }, after: { active: false } }],
      ['cmr.recurring.activate', { before: { active: false }, after: { active: true } }],
    ])
  })

  it("can't reactivate a vendor whose account is inactive — unless it moves to an active account in the same edit", async () => {
    const fake = world(CONTROLLER)
    const r = await PATCH(req('PATCH', { id: V.ORPHAN, active: true }))
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('ACCOUNT_INACTIVE')
    expect(writes(fake)).toHaveLength(0)

    const ok = await PATCH(req('PATCH', { id: V.ORPHAN, active: true, accountId: ACC.TCS }))
    expect(ok.status).toBe(200)
    expect(rowOf(fake, V.ORPHAN)).toMatchObject({ active: true, account_id: ACC.TCS })
    expect(auditCalls().map((c) => c.action)).toEqual(['cmr.recurring.update', 'cmr.recurring.activate'])
  })

  it('a combined edit writes once and audits each kind of change separately', async () => {
    const fake = world(CONTROLLER)
    await PATCH(req('PATCH', { id: V.TIRES, amountCents: 50000, section: 'monthly', lastAmountSentCents: 45050, onHold: true, active: false }))
    expect(fake.calls.filter((c) => c.op === 'update')).toHaveLength(1)
    expect(auditCalls().map((c) => c.action)).toEqual([
      'cmr.recurring.update',
      'cmr.recurring.move',
      'cmr.recurring.last_sent',
      'cmr.recurring.hold',
      'cmr.recurring.deactivate',
    ])
    expect(auditCalls().every((c) => c.resourceId === V.TIRES && c.metadata?.before && c.metadata?.after)).toBe(true)
  })
})

describe('/api/cmr/recurring/reorder (controller)', () => {
  it('reorders one section atomically via the RPC and audits before → after', async () => {
    const fake = world(CONTROLLER)
    const r = await reorder({ section: 'weekly', ids: [V.GONE, V.TIRES, V.FUEL] })
    expect(r.status).toBe(200)
    expect((await r.json()).data.changed).toBe(true)
    expect(orderOf(fake, 'weekly')).toEqual(['Old uniforms', 'Tire shop', 'Fuel card'])
    expect(orderOf(fake, 'monthly')).toEqual(['Yard rent', 'Retired acct vendor'])
    const rpc = fake.calls.filter((c) => c.op === 'rpc')
    expect(rpc).toEqual([expect.objectContaining({ table: 'cmr_reorder_recurring_vendors', payload: { p_ids: [V.GONE, V.TIRES, V.FUEL] } })])
    expect(fake.calls.filter((c) => c.op === 'update')).toHaveLength(0)
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.recurring.reorder',
        metadata: {
          section: 'weekly',
          before: ['Fuel card', 'Tire shop', 'Old uniforms'],
          after: ['Old uniforms', 'Tire shop', 'Fuel card'],
          ids: [V.GONE, V.TIRES, V.FUEL],
        },
      }),
    ])
  })

  it('the same order is a no-op (no RPC, no audit)', async () => {
    const fake = world(CONTROLLER)
    const r = await reorder({ section: 'weekly', ids: [V.FUEL, V.TIRES, V.GONE] })
    expect((await r.json()).data.changed).toBe(false)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('refuses a stale or mixed list (409) and bad input (400)', async () => {
    const fake = world(CONTROLLER)
    const stale = [
      { section: 'weekly', ids: [V.FUEL, V.TIRES] }, // missing one
      { section: 'weekly', ids: [V.FUEL, V.TIRES, V.RENT] }, // a monthly vendor
      { section: 'monthly', ids: [V.RENT, V.ORPHAN, randomUUID()] },
    ]
    for (const body of stale) {
      const r = await reorder(body)
      expect(r.status).toBe(409)
      expect((await r.json()).code).toBe('STALE')
    }
    const bad = [
      { section: 'weekly' },
      { section: 'weekly', ids: [] },
      { section: 'weekly', ids: ['nope'] },
      { section: 'weekly', ids: [V.FUEL, V.FUEL, V.TIRES] },
      { section: 'fortnightly', ids: [V.FUEL, V.TIRES, V.GONE] },
      { ids: [V.FUEL, V.TIRES, V.GONE] },
    ]
    for (const body of bad) expect((await reorder(body)).status, JSON.stringify(body)).toBe(400)
    expect((await REORDER(req('POST', '{', '/reorder'))).status).toBe(400)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('an RPC failure is a 500 and is not audited', async () => {
    const fake = world(CONTROLLER)
    fake.client.rpc = async () => ({ data: null, error: { message: 'boom' } })
    const r = await reorder({ section: 'weekly', ids: [V.TIRES, V.FUEL, V.GONE] })
    expect(r.status).toBe(500)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})
