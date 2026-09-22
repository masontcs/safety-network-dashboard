import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'
import { replaceApImport } from '@/lib/cmr/__testing__/vendorResolver'
import { mergeVendors, renameVendor, splitVendor } from '@/lib/cmr/__testing__/vendorMerge'
import { normalizeVendorName, vendorRollup, type CmrVendorCatalogEntry, type CmrVendorSuggestionsView, type CmrVendorsView } from '@/lib/cmr/vendors'

/**
 * AP Phase 3b — the Controller's vendor cleanup, end to end through the real routes:
 *
 *   • MERGE (POST /api/cmr/vendors/merge → cmr_merge_vendors): the source's spellings (aliases)
 *     and lines move to the target, the source is deleted, the rollup shows ONE vendor spanning
 *     both accounts with the summed total — and a RE-IMPORT keeps it merged (the moved spellings
 *     now resolve to the target).
 *   • SPLIT (…/split → cmr_split_vendor) reverses a merge; RENAME (…/rename) changes the display
 *     name only — the next import still links the same lines.
 *   • DISMISS (…/dismiss) removes a suggested pair from GET …/suggestions; the dismissal goes away
 *     with the vendor when one side is merged away.
 *   • Refusals: SAME_VENDOR, NOT_FOUND, WOULD_EMPTY, BAD_ALIAS, BAD_NAME, NAME_TAKEN.
 *   • ACCESS: every 3b route is Controller-only — Viewer and Requester get 403 (and nothing is
 *     written), a platform admin without a grant 403, no session 401. The rollup stays readable by
 *     every role, and tells the page whether to show the tools (canManage).
 *   • Suggestions never write; the AI review is optional and its failure falls back to the rules.
 *   • With the real exports present: the six known near-duplicates are suggested, and TRAFFIX
 *     DEVICES (STS) + TRAFFIX DEVICES INC (Holdings) merge → survive re-imports → split back.
 *
 * The database functions are mirrored in lib/cmr/__testing__/vendorMerge.ts (and 3a's resolver in
 * vendorResolver.ts); the SQL itself ran on PostgreSQL 16 with the real data (status doc).
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))
const ai = vi.hoisted(() => ({ review: vi.fn() }))
vi.mock('@/lib/ai/vendors', () => ({ reviewVendorDuplicates: ai.review }))
vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-22',
}))

import * as vendorsRoute from './route'
import * as catalogRoute from './catalog/route'
import * as suggestionsRoute from './suggestions/route'
import * as mergeRoute from './merge/route'
import * as splitRoute from './split/route'
import * as renameRoute from './rename/route'
import * as dismissRoute from './dismiss/route'
import * as commitRoute from '@/app/api/cmr/ap/import/commit/route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const ACC = {
  TCS: '70000000-0000-4000-8000-000000000001',
  STS: '70000000-0000-4000-8000-000000000002',
  HLD: '70000000-0000-4000-8000-000000000003',
  INC: '70000000-0000-4000-8000-000000000004',
}

type Row = Record<string, unknown>

// ── synthetic QuickBooks A/P Aging Detail reports ────────────────────────────

const HEADER = ['', '', '', 'Type', '', 'Date', '', 'Num', '', 'Name', '', 'Due Date', '', 'Aging', '', 'Open Balance']
const line = (type: string, num: string, name: string, bal: number) => ['', '', '', type, '', 46265, '', num, '', name, '', 46295, '', 30, '', bal]
const label = (col0: string, bal: number | '' = '') => [col0, '', '', '', '', '', '', '', '', '', '', '', '', '', '', bal]
function report(lines: [string, string, string, number][]): Uint8Array {
  const total = Math.round(lines.reduce((s, l) => s + l[3], 0) * 100) / 100
  const rows = [HEADER, label('Current'), ...lines.map((l) => line(...l)), label('Total Current', total), label('TOTAL', total)]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

// TRAFFIX DEVICES (STS) / TRAFFIX DEVICES INC (Holdings) are the same company spelled two ways.
// WANCO INC / WANCO, INC likewise. CITY OF FRESNO / CITY OF SELMA are NOT.
const STS_REPORT = report([
  ['Bill', '4092103', 'TRAFFIX DEVICES', 2930.8],
  ['Credit', 'CM', 'TRAFFIX DEVICES', -600.14],
  ['Bill', 'Z1', 'ZUMAR INDUSTRIES', 400],
])
const HLD_REPORT = report([
  ['Bill', 'H1', 'TRAFFIX DEVICES INC', 1000],
  ['Bill', 'H2', 'TRAFFIX DEVICES INC', 388.55],
  ['Bill', 'W1', 'WANCO INC', 75],
])
const TCS_REPORT = report([
  ['Bill', 'W2', 'WANCO, INC', 25],
  ['Bill', 'C1', 'CITY OF FRESNO', 10],
  ['Bill', 'C2', 'CITY OF SELMA', 20],
])

function world(userId: string | null) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
        { id: CONTROLLER, role: 'executive', display_name: 'Mason Doty', is_active: true },
        { id: REQUESTER, role: 'sales', display_name: 'Jordan Requester', is_active: true },
        { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', is_active: true },
        { id: STRANGER, role: 'executive', display_name: 'Sam Stranger', is_active: true },
      ],
      cmr_access: [
        { user_id: CONTROLLER, role: 'controller' },
        { user_id: REQUESTER, role: 'requester' },
        { user_id: VIEWER, role: 'viewer' },
      ],
      cmr_accounts: [
        { id: ACC.TCS, name: 'TCS', account_type: null, active: true, sort_order: 0 },
        { id: ACC.STS, name: 'STS', account_type: null, active: true, sort_order: 1 },
        { id: ACC.HLD, name: 'Holdings', account_type: null, active: true, sort_order: 2 },
        { id: ACC.INC, name: 'INC', account_type: null, active: true, sort_order: 3 },
      ],
      cmr_ap_imports: [],
      cmr_ap_lines: [],
      cmr_vendors: [],
      cmr_vendor_aliases: [],
      cmr_vendor_merge_dismissals: [],
    },
    {
      defaults: { cmr_vendor_merge_dismissals: () => ({ id: crypto.randomUUID(), dismissed_at: '2026-09-22T20:00:00Z' }) },
      rpc: {
        cmr_ap_replace_import: replaceApImport,
        cmr_merge_vendors: mergeVendors,
        cmr_split_vendor: splitVendor,
        cmr_rename_vendor: renameVendor,
      },
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}
type World = ReturnType<typeof world>

const as = (fake: World, userId: string | null) => { server.routeClient = fakeRouteClient(userId); return fake }

const base = 'https://cmr.safetynetworkteams.com/api/cmr'
function importForm(accountId: string, bytes: Uint8Array, name: string) {
  const f = new FormData()
  f.append('accountId', accountId)
  f.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  return f
}
const commit = (accountId: string, bytes: Uint8Array, name = 'AP.xlsx') =>
  commitRoute.POST(new Request(`${base}/ap/import/commit`, { method: 'POST', body: importForm(accountId, bytes, name) }))
const post = (route: { POST: (r: Request) => Promise<Response> }, url: string, body: unknown) =>
  route.POST(new Request(`${base}/vendors/${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const merge = (targetId: string, sourceId: string) => post(mergeRoute, 'merge', { targetId, sourceId })
const split = (vendorId: string, aliasIds: string[], name: string) => post(splitRoute, 'split', { vendorId, aliasIds, name })
const rename = (vendorId: string, name: string) => post(renameRoute, 'rename', { vendorId, name })
const dismiss = (vendorIdA: string, vendorIdB: string) => post(dismissRoute, 'dismiss', { vendorIdA, vendorIdB })
const suggestions = (q = '') => suggestionsRoute.GET(new Request(`${base}/vendors/suggestions${q}`))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string }

async function importAll(fake: World) {
  as(fake, CONTROLLER)
  expect((await commit(ACC.STS, STS_REPORT, 'STS AP.xlsx')).status).toBe(201)
  expect((await commit(ACC.HLD, HLD_REPORT, 'HLD AP.xlsx')).status).toBe(201)
  expect((await commit(ACC.TCS, TCS_REPORT, 'TCS AP.xlsx')).status).toBe(201)
  audit.logAudit.mockClear() // the imports' own cmr.ap.import entries
}
const vid = (fake: World, name: string) => fake.tables.cmr_vendors.find((v) => v.canonical_name === name)!.id as string
const aliasId = (fake: World, raw: string) => fake.tables.cmr_vendor_aliases.find((a) => a.raw_name === raw)!.id as string
async function rollup(fake: World) {
  as(fake, CONTROLLER)
  return vendorRollup((await bodyOf(await vendorsRoute.GET())).data as CmrVendorsView, null)
}
const pairsOf = (v: CmrVendorSuggestionsView) => v.pairs.map((p) => [p.a.canonicalName, p.b.canonicalName].sort().join(' ↔ '))

beforeEach(() => {
  audit.logAudit.mockClear()
  ai.review.mockReset()
})

// ── route shape ─────────────────────────────────────────────────────────────

describe('route shape (BUG-019: only HTTP handlers + route config)', () => {
  it('each 3b route exports exactly its handler + dynamic (suggestions also maxDuration)', () => {
    expect(Object.keys(catalogRoute).sort()).toEqual(['GET', 'dynamic'])
    expect(Object.keys(suggestionsRoute).sort()).toEqual(['GET', 'dynamic', 'maxDuration'])
    for (const r of [mergeRoute, splitRoute, renameRoute, dismissRoute]) expect(Object.keys(r).sort()).toEqual(['POST', 'dynamic'])
    for (const r of [catalogRoute, suggestionsRoute, mergeRoute, splitRoute, renameRoute, dismissRoute]) expect(r.dynamic).toBe('force-dynamic')
  })
})

// ── merge ───────────────────────────────────────────────────────────────────

describe('merge', () => {
  it('moves the aliases and lines, deletes the source; one vendor spanning both accounts with the summed total', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const before = await rollup(fake)
    const t = before.find((r) => r.name === 'TRAFFIX DEVICES')!
    const s = before.find((r) => r.name === 'TRAFFIX DEVICES INC')!
    expect(t.owedCents).toBe(2_330_66)
    expect(s.owedCents).toBe(1_388_55)
    const T = vid(fake, 'TRAFFIX DEVICES')
    const S = vid(fake, 'TRAFFIX DEVICES INC')

    as(fake, CONTROLLER)
    const r = await merge(T, S)
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data).toMatchObject({ vendorId: T, name: 'TRAFFIX DEVICES', aliasesMoved: 1, linesRepointed: 2 })

    expect(fake.tables.cmr_vendors.some((v) => v.id === S)).toBe(false)
    expect(fake.tables.cmr_vendor_aliases.filter((a) => a.vendor_id === T).map((a) => a.raw_name).sort()).toEqual(['TRAFFIX DEVICES', 'TRAFFIX DEVICES INC'])
    expect(fake.tables.cmr_ap_lines.filter((l) => String(l.vendor_name).startsWith('TRAFFIX')).every((l) => l.vendor_id === T)).toBe(true)

    const after = (await rollup(fake)).find((x) => x.name === 'TRAFFIX DEVICES')!
    expect(after.owedCents).toBe(2_330_66 + 1_388_55)
    expect(after.accounts.map((a) => a.accountName)).toEqual(['STS', 'Holdings'])
    expect(after.rawNames).toEqual(['TRAFFIX DEVICES', 'TRAFFIX DEVICES INC'])
    expect((await rollup(fake)).some((x) => x.name === 'TRAFFIX DEVICES INC')).toBe(false)

    expect(audit.logAudit).toHaveBeenCalledTimes(1)
    expect(audit.logAudit.mock.calls[0][0]).toMatchObject({
      action: 'cmr.vendor.merge',
      userRole: 'cmr:controller',
      resourceId: T,
      metadata: { target: { id: T, name: 'TRAFFIX DEVICES' }, source: { id: S, name: 'TRAFFIX DEVICES INC' }, aliasesMoved: 1, spellingsMoved: ['TRAFFIX DEVICES INC'], linesRepointed: 2 },
    })
  })

  it('SURVIVES A RE-IMPORT: the moved spelling now resolves to the target — no new vendor, still one row', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const T = vid(fake, 'TRAFFIX DEVICES')
    as(fake, CONTROLLER)
    expect((await merge(T, vid(fake, 'TRAFFIX DEVICES INC'))).status).toBe(200)
    const count = fake.tables.cmr_vendors.length

    expect((await commit(ACC.HLD, HLD_REPORT, 'HLD AP again.xlsx')).status).toBe(201)
    expect((await commit(ACC.STS, STS_REPORT, 'STS AP again.xlsx')).status).toBe(201)
    expect(fake.tables.cmr_vendors).toHaveLength(count)
    expect(fake.tables.cmr_ap_lines.filter((l) => String(l.vendor_name).startsWith('TRAFFIX')).every((l) => l.vendor_id === T)).toBe(true)
    const rows = (await rollup(fake)).filter((x) => x.name.startsWith('TRAFFIX'))
    expect(rows).toHaveLength(1)
    expect(rows[0].owedCents).toBe(3_719_21)
  })

  it('the target keeps its name — the Controller picks it by choosing which vendor is the target', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    as(fake, CONTROLLER)
    expect((await merge(vid(fake, 'WANCO, INC'), vid(fake, 'WANCO INC'))).status).toBe(200)
    const w = (await rollup(fake)).filter((x) => x.name.startsWith('WANCO'))
    expect(w.map((x) => [x.name, x.owedCents, x.accounts.map((a) => a.accountName)])).toEqual([['WANCO, INC', 100_00, ['TCS', 'Holdings']]])
  })

  it('refuses SAME_VENDOR (400) and NOT_FOUND (404) without writing', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const T = vid(fake, 'TRAFFIX DEVICES')
    as(fake, CONTROLLER)
    const same = await merge(T, T)
    expect(same.status).toBe(400)
    expect((await bodyOf(same)).code).toBe('SAME_VENDOR')
    const gone = await merge(T, '99999999-9999-4999-8999-999999999999')
    expect(gone.status).toBe(404)
    expect((await bodyOf(gone)).code).toBe('NOT_FOUND')
    expect((await merge('not-a-uuid', T)).status).toBe(400)
    expect(fake.calls.some((c) => c.op === 'rpc' && c.table === 'cmr_merge_vendors')).toBe(false)
    // …and the database's own refusal maps the same way (the source vanished between the read and the call)
    const S = vid(fake, 'TRAFFIX DEVICES INC')
    const opts = fake.client as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> }
    const rpc = opts.rpc
    opts.rpc = async (n, a) => { fake.tables.cmr_vendors = fake.tables.cmr_vendors.filter((v) => v.id !== S); return rpc(n, a) }
    const raced = await merge(T, S)
    opts.rpc = rpc
    expect(raced.status).toBe(404)
    expect((await bodyOf(raced)).code).toBe('NOT_FOUND')
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

// ── split ───────────────────────────────────────────────────────────────────

describe('split', () => {
  it('reverses a merge: the chosen spelling and its lines go to a new vendor; amounts and accounts restored', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const T = vid(fake, 'TRAFFIX DEVICES')
    as(fake, CONTROLLER)
    await merge(T, vid(fake, 'TRAFFIX DEVICES INC'))

    const r = await split(T, [aliasId(fake, 'TRAFFIX DEVICES INC')], '  TRAFFIX DEVICES INC  ')
    expect(r.status).toBe(201)
    const created = (await bodyOf(r)).data
    expect(created).toMatchObject({ name: 'TRAFFIX DEVICES INC', aliasesMoved: 1, linesRepointed: 2 })

    const rows = (await rollup(fake)).filter((x) => x.name.startsWith('TRAFFIX'))
    expect(rows.map((x) => [x.name, x.owedCents, x.accounts.map((a) => a.accountName)]).sort((p, q) => String(p[0]).length - String(q[0]).length)).toEqual([
      ['TRAFFIX DEVICES', 2_330_66, ['STS']],
      ['TRAFFIX DEVICES INC', 1_388_55, ['Holdings']],
    ])
    // and it stays split across a re-import
    expect((await commit(ACC.HLD, HLD_REPORT)).status).toBe(201)
    expect(fake.tables.cmr_ap_lines.filter((l) => l.vendor_name === 'TRAFFIX DEVICES INC').every((l) => l.vendor_id === created.vendorId)).toBe(true)

    expect(audit.logAudit.mock.calls.at(-2)![0]).toMatchObject({
      action: 'cmr.vendor.split',
      resourceId: created.vendorId,
      metadata: { source: { id: T, name: 'TRAFFIX DEVICES' }, created: { name: 'TRAFFIX DEVICES INC' }, spellingsMoved: ['TRAFFIX DEVICES INC'], linesRepointed: 2 },
    })
  })

  it('refuses WOULD_EMPTY (409), BAD_ALIAS (400), BAD_NAME (400), NAME_TAKEN (409), NOT_FOUND (404)', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const T = vid(fake, 'TRAFFIX DEVICES')
    as(fake, CONTROLLER)
    await merge(T, vid(fake, 'TRAFFIX DEVICES INC'))
    const both = [aliasId(fake, 'TRAFFIX DEVICES'), aliasId(fake, 'TRAFFIX DEVICES INC')]
    const cases: [Response, number, string][] = [
      [await split(T, both, 'X'), 409, 'WOULD_EMPTY'],
      [await split(T, [aliasId(fake, 'WANCO INC')], 'X'), 400, 'BAD_ALIAS'],
      [await split(T, [], 'X'), 400, 'BAD_ALIAS'],
      [await split(T, ['nope'], 'X'), 400, 'BAD_ALIAS'],
      [await split(T, [both[1]], '   '), 400, 'BAD_NAME'],
      [await split(T, [both[1]], 'x'.repeat(201)), 400, 'BAD_NAME'],
      [await split(T, [both[1]], 'traffix devices.'), 409, 'NAME_TAKEN'],
      [await split('99999999-9999-4999-8999-999999999999', [both[1]], 'X'), 404, 'NOT_FOUND'],
    ]
    for (const [res, status, code] of cases) {
      expect(res.status, code).toBe(status)
      expect((await bodyOf(res)).code).toBe(code)
    }
    expect(fake.tables.cmr_vendor_aliases.filter((a) => a.vendor_id === T)).toHaveLength(2)
    expect(audit.logAudit.mock.calls.filter((c) => (c[0] as Row).action === 'cmr.vendor.split')).toHaveLength(0)
  })
})

// ── rename ──────────────────────────────────────────────────────────────────

describe('rename', () => {
  it('changes the display name only — the match key and spellings stay, and the next import links the same lines', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const S = vid(fake, 'TRAFFIX DEVICES INC')
    const key = fake.tables.cmr_vendors.find((v) => v.id === S)!.normalized_name
    as(fake, CONTROLLER)
    const r = await rename(S, '  Traffix Devices, Inc.  ')
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data).toMatchObject({ vendorId: S, name: 'Traffix Devices, Inc.', changed: true })
    const v = fake.tables.cmr_vendors.find((x) => x.id === S)!
    expect(v.canonical_name).toBe('Traffix Devices, Inc.')
    expect(v.normalized_name).toBe(key)
    expect(fake.tables.cmr_vendor_aliases.find((a) => a.vendor_id === S)!.normalized_name).toBe('TRAFFIX DEVICES INC')

    const count = fake.tables.cmr_vendors.length
    expect((await commit(ACC.HLD, HLD_REPORT)).status).toBe(201)
    expect(fake.tables.cmr_vendors).toHaveLength(count)
    expect(fake.tables.cmr_ap_lines.filter((l) => l.vendor_name === 'TRAFFIX DEVICES INC').every((l) => l.vendor_id === S)).toBe(true)
    expect((await rollup(fake)).find((x) => x.vendorId === S)!.name).toBe('Traffix Devices, Inc.')
    expect(audit.logAudit.mock.calls.find((c) => (c[0] as Row).action === 'cmr.vendor.rename')![0]).toMatchObject({
      metadata: { before: { name: 'TRAFFIX DEVICES INC' }, after: { name: 'Traffix Devices, Inc.' } },
    })
  })

  it('refuses BAD_NAME and NOT_FOUND; the same name is a no-op (no audit)', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const S = vid(fake, 'TRAFFIX DEVICES INC')
    as(fake, CONTROLLER)
    expect((await bodyOf(await rename(S, ' '))).code).toBe('BAD_NAME')
    expect((await rename(S, 'y'.repeat(201))).status).toBe(400)
    expect((await rename(S, 'é'.repeat(200))).status).toBe(200) // 200 characters is fine
    const nf = await rename('99999999-9999-4999-8999-999999999999', 'X')
    expect(nf.status).toBe(404)
    audit.logAudit.mockClear()
    const same = await rename(S, 'é'.repeat(200))
    expect((await bodyOf(same)).data.changed).toBe(false)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

// ── suggestions + dismissals ────────────────────────────────────────────────

describe('suggestions (advisory — never writes) and dismissals', () => {
  it('lists the near-duplicates with both sides (accounts, owed, spellings) and a reason — not CITY OF FRESNO / SELMA', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const writesBefore = fake.calls.filter((c) => c.op !== 'select').length
    as(fake, CONTROLLER)
    const r = await suggestions()
    expect(r.status).toBe(200)
    const v = (await bodyOf(r)).data as CmrVendorSuggestionsView
    expect(pairsOf(v)).toEqual(expect.arrayContaining(['TRAFFIX DEVICES ↔ TRAFFIX DEVICES INC', 'WANCO INC ↔ WANCO, INC']))
    expect(pairsOf(v)).not.toContain('CITY OF FRESNO ↔ CITY OF SELMA')
    const tr = v.pairs.find((p) => p.a.canonicalName.startsWith('TRAFFIX'))!
    const sides = [tr.a, tr.b].sort((x, y) => x.canonicalName.localeCompare(y.canonicalName))
    expect(sides.map((s) => [s.canonicalName, s.accounts.map((a) => a.name), s.owedCents])).toEqual([
      ['TRAFFIX DEVICES', ['STS'], 2_330_66],
      ['TRAFFIX DEVICES INC', ['Holdings'], 1_388_55],
    ])
    expect(tr.kind).toBe('suffix')
    expect(tr.reason).toMatch(/INC/)
    expect(tr.a.id < tr.b.id).toBe(true)
    expect(v.engine).toEqual({ heuristic: true, ai: 'off', aiMessage: null })
    expect(ai.review).not.toHaveBeenCalled()
    expect(fake.calls.filter((c) => c.op !== 'select').length).toBe(writesBefore)
  })

  it('a dismissed pair is not suggested again; the dismissal is stored ordered and audited; idempotent', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const A = vid(fake, 'WANCO INC')
    const B = vid(fake, 'WANCO, INC')
    as(fake, CONTROLLER)
    expect((await dismiss(B, A)).status).toBe(200)
    expect((await dismiss(A, B)).status).toBe(200)
    expect(fake.tables.cmr_vendor_merge_dismissals).toHaveLength(1)
    const d = fake.tables.cmr_vendor_merge_dismissals[0]
    expect(d.vendor_id_a! < d.vendor_id_b!).toBe(true)
    expect(d.dismissed_by).toBe(CONTROLLER)
    const v = (await bodyOf(await suggestions())).data as CmrVendorSuggestionsView
    expect(pairsOf(v)).not.toContain('WANCO INC ↔ WANCO, INC')
    expect(pairsOf(v)).toContain('TRAFFIX DEVICES ↔ TRAFFIX DEVICES INC')
    expect(audit.logAudit.mock.calls[0][0]).toMatchObject({ action: 'cmr.vendor.dismiss', resourceType: 'cmr_vendor_merge_dismissals' })
    expect((await dismiss(A, A)).status).toBe(400)
    expect((await dismiss(A, '99999999-9999-4999-8999-999999999999')).status).toBe(404)
  })

  it('the dismissal cascades away when one of its vendors is merged into another', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const A = vid(fake, 'TRAFFIX DEVICES')
    const B = vid(fake, 'TRAFFIX DEVICES INC')
    as(fake, CONTROLLER)
    await dismiss(A, B)
    expect(fake.tables.cmr_vendor_merge_dismissals).toHaveLength(1)
    // the Controller later decides they ARE the same after all
    expect((await merge(A, B)).status).toBe(200)
    expect(fake.tables.cmr_vendor_merge_dismissals).toHaveLength(0)
  })

  it('?ai=1 annotates the pairs and may add one; an unavailable AI falls back to the rule-based list', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    as(fake, CONTROLLER)
    ai.review.mockImplementation(async (input: { vendors: { id: string; name: string }[]; pairs: { a: string; b: string }[] }) => {
      const id = (n: string) => input.vendors.find((v) => v.name === n)!.id
      return {
        status: 'used',
        reviews: new Map(input.pairs.map((_, i) => [i, { verdict: 'same', note: 'Same supplier.' }])),
        additional: [{ a: id('ZUMAR INDUSTRIES'), b: id('CITY OF SELMA'), note: 'Test pair.' }],
      }
    })
    const used = (await bodyOf(await suggestions('?ai=1'))).data as CmrVendorSuggestionsView
    expect(used.engine.ai).toBe('used')
    expect(used.pairs.find((p) => p.kind === 'suffix')!.ai).toEqual({ verdict: 'same', note: 'Same supplier.' })
    expect(used.pairs.find((p) => p.kind === 'ai')).toMatchObject({ reason: 'Test pair.' })

    ai.review.mockResolvedValue({ status: 'unavailable', message: 'The AI review is unavailable right now.' })
    const down = (await bodyOf(await suggestions('?ai=1'))).data as CmrVendorSuggestionsView
    expect(down.engine).toEqual({ heuristic: true, ai: 'unavailable', aiMessage: 'The AI review is unavailable right now.' })
    expect(pairsOf(down)).toContain('TRAFFIX DEVICES ↔ TRAFFIX DEVICES INC')
    expect(fake.tables.cmr_vendor_merge_dismissals).toHaveLength(0)
  })

  it('the catalog lists every vendor with its spellings (alias ids for Split), accounts and owed', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    as(fake, CONTROLLER)
    await merge(vid(fake, 'TRAFFIX DEVICES'), vid(fake, 'TRAFFIX DEVICES INC'))
    const c = (await bodyOf(await catalogRoute.GET())).data.vendors as CmrVendorCatalogEntry[]
    const tr = c.find((v) => v.canonicalName === 'TRAFFIX DEVICES')!
    expect(tr.aliases.map((a) => [a.rawName, a.lineCount, a.accountNames])).toEqual([
      ['TRAFFIX DEVICES', 2, ['STS']],
      ['TRAFFIX DEVICES INC', 2, ['Holdings']],
    ])
    expect(tr.accounts.map((a) => a.name)).toEqual(['STS', 'Holdings'])
    expect(tr.owedCents).toBe(3_719_21)
    expect(c.map((v) => v.canonicalName)).toEqual([...c.map((v) => v.canonicalName)].sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' })))
  })
})

// ── access: Controller only, explicit grant, no admin inheritance ───────────

describe('access', () => {
  const mutations = (fake: World) => {
    const T = vid(fake, 'TRAFFIX DEVICES')
    const S = vid(fake, 'TRAFFIX DEVICES INC')
    return [
      ['merge', () => merge(T, S)],
      ['split', () => split(T, [aliasId(fake, 'TRAFFIX DEVICES')], 'X')],
      ['rename', () => rename(T, 'X')],
      ['dismiss', () => dismiss(T, S)],
      ['catalog', () => catalogRoute.GET()],
      ['suggestions', () => suggestions('?ai=1')],
    ] as const
  }

  it('the Controller gets 200 on every route', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    as(fake, CONTROLLER)
    ai.review.mockResolvedValue({ status: 'unavailable', message: 'x' })
    const m = mutations(fake)
    for (const [label, call] of [m[4], m[5], m[2], m[3], m[0]]) expect((await call()).status, label).toBe(200)
  })

  for (const [label, uid, status] of [
    ['viewer', VIEWER, 403],
    ['requester', REQUESTER, 403],
    ['platform admin with no grant', ADMIN, 403],
    ['stranger', STRANGER, 403],
    ['no session', null, 401],
  ] as const) {
    it(`${label}: ${status} on every 3b route, and nothing is written or read from vendors`, async () => {
      const fake = world(CONTROLLER)
      await importAll(fake)
      const snapshot = JSON.stringify([fake.tables.cmr_vendors, fake.tables.cmr_vendor_aliases, fake.tables.cmr_ap_lines, fake.tables.cmr_vendor_merge_dismissals])
      const callsBefore = fake.calls.length
      as(fake, uid)
      for (const [name, call] of mutations(fake)) {
        const r = await call()
        expect(r.status, name).toBe(status)
      }
      const after = fake.calls.slice(callsBefore)
      expect(after.some((c) => c.op === 'rpc')).toBe(false)
      expect(after.some((c) => c.table.startsWith('cmr_vendor') || c.table === 'cmr_ap_lines')).toBe(false)
      expect(JSON.stringify([fake.tables.cmr_vendors, fake.tables.cmr_vendor_aliases, fake.tables.cmr_ap_lines, fake.tables.cmr_vendor_merge_dismissals])).toBe(snapshot)
      expect(ai.review).not.toHaveBeenCalled()
      expect(audit.logAudit).toHaveBeenCalledTimes(0)
    })
  }

  it('every role still reads the rollup; only the Controller is told to show the tools (canManage)', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    for (const [uid, can] of [[CONTROLLER, true], [REQUESTER, false], [VIEWER, false]] as const) {
      as(fake, uid)
      const r = await vendorsRoute.GET()
      expect(r.status).toBe(200)
      expect((await bodyOf(r)).data.canManage).toBe(can)
    }
    as(fake, ADMIN)
    expect((await vendorsRoute.GET()).status).toBe(403)
  })
})

// ── the real exports (gitignored; run where they are present) ────────────────

const REAL: [keyof typeof ACC, string][] = [['STS', 'STS AP 92226.xlsx'], ['TCS', 'TCS AP 092226.xlsx'], ['HLD', 'HLD AP 092226.xlsx'], ['INC', 'INC AP 092226.xlsx']]
const HAS_REAL = REAL.every(([, f]) => existsSync(path.join(process.cwd(), f)))
const realFile = (acc: keyof typeof ACC) => {
  const f = REAL.find(([a]) => a === acc)![1]
  return [readFileSync(path.join(process.cwd(), f)), f] as const
}

describe.runIf(HAS_REAL)('the real A/P exports (STS, TCS, Holdings, INC)', () => {
  it('suggests the six known near-duplicates, and not obviously different vendors', async () => {
    const fake = world(CONTROLLER)
    as(fake, CONTROLLER)
    for (const [acc] of REAL) expect((await commit(ACC[acc], ...realFile(acc))).status).toBe(201)
    const v = (await bodyOf(await suggestions())).data as CmrVendorSuggestionsView
    expect(v.vendorCount).toBe(250)
    const got = pairsOf(v)
    for (const p of [
      'TRAFFIX DEVICES ↔ TRAFFIX DEVICES INC',
      'SAFETY NETWORK TRAFFIC SIGNS ↔ SAFETY NETWORK TRAFFIC SIGNS, INC',
      'WANCO INC ↔ WANCO, INC',
      'OSCAR J GARCIA C P A ↔ OSCAR J. GARCIA, CPA',
      'BIZ2CREDIT/ITRIA VEN ↔ ITRIA VENTURE/BIZ2CREDIT',
      'R G MOORE & ASSOCIATES ↔ RG MOORE & ASSOCIATES',
    ]) expect(got, p).toContain(p)
    for (const p of [
      '405 EXPRESS LANES ↔ 91 EXPRESS LANES',
      'CITY OF FRESNO TRAFFIC ENGINEERING ↔ CITY OF FRESNO UTILITIES (AUTO)',
      'SAFETY NETWORK HOLDINGS, INC ↔ SAFETY NETWORK, INC.',
      'SAFETY NETWORK TCS, INC ↔ SAFETY NETWORK, INC.',
      'SAMSARA - A - 005 (LEASE SERVICES) ↔ SAMSARA - B - 006 (LEASE SERVICES)',
      'COMCAST/FRESNO/AUTOPAY ↔ COMCAST/MODESTO/AUTOPAY',
    ]) expect(got, p).not.toContain(p)
    expect(v.pairs.length).toBeLessThan(40)
  })

  it('TRAFFIX DEVICES (STS) + TRAFFIX DEVICES INC (Holdings) → one vendor → survives re-imports → splits back', async () => {
    const fake = world(CONTROLLER)
    as(fake, CONTROLLER)
    for (const [acc] of REAL) await commit(ACC[acc], ...realFile(acc))
    const byName = async () => new Map((await rollup(fake)).map((r) => [r.name, r]))
    const b0 = await byName()
    const sts = b0.get('TRAFFIX DEVICES')!.owedCents
    const hld = b0.get('TRAFFIX DEVICES INC')!.owedCents
    expect(sts + hld).toBe(3_499_546)

    const T = vid(fake, 'TRAFFIX DEVICES')
    as(fake, CONTROLLER)
    expect((await merge(T, vid(fake, 'TRAFFIX DEVICES INC'))).status).toBe(200)
    const b1 = await byName()
    expect(b1.get('TRAFFIX DEVICES')!.owedCents).toBe(3_499_546)
    expect(b1.get('TRAFFIX DEVICES')!.accounts.map((a) => a.accountName)).toEqual(['STS', 'Holdings'])
    expect(b1.has('TRAFFIX DEVICES INC')).toBe(false)
    expect(fake.tables.cmr_vendors).toHaveLength(249)

    await commit(ACC.HLD, ...realFile('HLD'))
    await commit(ACC.STS, ...realFile('STS'))
    expect(fake.tables.cmr_vendors).toHaveLength(249)
    expect((await byName()).get('TRAFFIX DEVICES')!.owedCents).toBe(3_499_546)

    as(fake, CONTROLLER)
    expect((await split(T, [aliasId(fake, 'TRAFFIX DEVICES INC')], 'TRAFFIX DEVICES INC')).status).toBe(201)
    const b2 = await byName()
    expect([b2.get('TRAFFIX DEVICES')!.owedCents, b2.get('TRAFFIX DEVICES INC')!.owedCents]).toEqual([sts, hld])
    expect(fake.tables.cmr_vendors).toHaveLength(250)
    // every line still linked, and each linked through its own spelling
    for (const l of fake.tables.cmr_ap_lines) {
      if (!normalizeVendorName(l.vendor_name as string)) continue
      const a = fake.tables.cmr_vendor_aliases.find((x) => x.normalized_name === normalizeVendorName(l.vendor_name as string))!
      expect(l.vendor_id).toBe(a.vendor_id)
    }
  })
})
