import { NextResponse } from 'next/server'
import { reviewVendorDuplicates } from '@/lib/ai/vendors'
import { apAccounts, bad, currentApLines, currentImports, type Supabase } from '@/lib/cmr/ap-server'
import { pairKey, suggestVendorMerges } from '@/lib/cmr/vendor-suggest'
import {
  normalizeVendorName,
  type CmrVendorCatalogEntry,
  type CmrVendorSuggestion,
  type CmrVendorSuggestionsView,
  type CmrVendorSummary,
} from '@/lib/cmr/vendors'

/**
 * Server-only helpers for the AP Phase 3b vendor tools — /api/cmr/vendors/{catalog, suggestions,
 * merge, split, rename, dismiss}. They live here because a route.ts may export only HTTP handlers
 * + route config (BUG-019). Nothing here checks access: every handler calls getCmrContext() and
 * guardCmrController() first.
 *
 * The merge / split / rename themselves are database functions (cmr_merge_vendors,
 * cmr_split_vendor, cmr_rename_vendor — one transaction each, race-safe, service-role only). The
 * suggestions are read-only: they never write, and a suggestion can only become a merge when a
 * Controller confirms it.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

const PAGE = 1000

export type VendorRow = { id: string; canonical_name: string; normalized_name: string }
export type AliasRow = { id: string; vendor_id: string; raw_name: string; normalized_name: string }
export type DismissalRow = { vendor_id_a: string; vendor_id_b: string }

/** Every row of a (small, service-role-only) table, paged past PostgREST's 1,000-row cap. */
async function readAll<T>(
  supabase: Supabase,
  table: 'cmr_vendors' | 'cmr_vendor_aliases' | 'cmr_vendor_merge_dismissals',
  cols: string,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(cols).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export const allVendors = (s: Supabase) => readAll<VendorRow>(s, 'cmr_vendors', 'id, canonical_name, normalized_name')
export const allAliases = (s: Supabase) => readAll<AliasRow>(s, 'cmr_vendor_aliases', 'id, vendor_id, raw_name, normalized_name')
export const allDismissals = (s: Supabase) => readAll<DismissalRow>(s, 'cmr_vendor_merge_dismissals', 'id, vendor_id_a, vendor_id_b')

// ── the catalog: every canonical vendor, its spellings, accounts and amount owed ─

/**
 * Every canonical vendor (including ones with nothing open right now), each with its QuickBooks
 * spellings and the current A/P behind it. Sorted A–Z.
 */
export async function vendorCatalog(supabase: Supabase): Promise<CmrVendorCatalogEntry[]> {
  const [vendors, aliases, accounts, imports] = await Promise.all([
    allVendors(supabase),
    allAliases(supabase),
    apAccounts(supabase),
    currentImports(supabase),
  ])
  const lines = await currentApLines(supabase, imports.map((i) => i.account_id), { payableOnly: false })
  const accName = new Map(accounts.map((a) => [a.id, a.name]))
  const accOrder = new Map(accounts.map((a) => [a.id, a.sortOrder]))

  const byVendor = new Map<string, CmrVendorCatalogEntry>(
    vendors.map((v) => [v.id, { id: v.id, canonicalName: v.canonical_name, aliases: [], accounts: [], owedCents: 0, lineCount: 0 }]),
  )
  const aliasByKey = new Map<string, { entry: CmrVendorCatalogEntry['aliases'][number]; accs: Set<string> }>()
  for (const a of aliases) {
    const e = byVendor.get(a.vendor_id)
    if (!e) continue
    const info = { id: a.id, rawName: a.raw_name, lineCount: 0, accountNames: [] as string[] }
    e.aliases.push(info)
    aliasByKey.set(`${a.vendor_id}\u0000${a.normalized_name}`, { entry: info, accs: new Set() })
  }

  const accsOf = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.vendorId) continue
    const e = byVendor.get(l.vendorId)
    if (!e) continue
    e.lineCount++
    if (l.payable) e.owedCents += l.openBalanceCents
    let s = accsOf.get(e.id)
    if (!s) { s = new Set(); accsOf.set(e.id, s) }
    s.add(l.accountId)
    const al = aliasByKey.get(`${l.vendorId}\u0000${normalizeVendorName(l.vendorName)}`)
    if (al) { al.entry.lineCount++; al.accs.add(l.accountId) }
  }

  const byOrder = (a: string, b: string) => (accOrder.get(a) ?? 0) - (accOrder.get(b) ?? 0)
  for (const { entry, accs } of aliasByKey.values()) entry.accountNames = [...accs].sort(byOrder).map((id) => accName.get(id) ?? 'Unknown account')
  for (const e of byVendor.values()) {
    e.accounts = [...(accsOf.get(e.id) ?? [])].sort(byOrder).map((id) => ({ id, name: accName.get(id) ?? 'Unknown account' }))
    e.aliases.sort((x, y) => x.rawName.localeCompare(y.rawName, 'en-US', { sensitivity: 'base' }))
  }
  return [...byVendor.values()].sort(
    (x, y) => x.canonicalName.localeCompare(y.canonicalName, 'en-US', { sensitivity: 'base' }) || (x.id < y.id ? -1 : 1),
  )
}

const summaryOf = (e: CmrVendorCatalogEntry): CmrVendorSummary => ({
  id: e.id,
  canonicalName: e.canonicalName,
  accounts: e.accounts,
  owedCents: e.owedCents,
  spellings: e.aliases.map((a) => a.rawName),
})

// ── suggestions (advisory; never writes) ────────────────────────────────────

/**
 * Possible duplicate pairs over the current canonical vendors: the deterministic matcher always;
 * with `ai`, also the AI review (lib/ai/vendors), which annotates those pairs and may add a few
 * it missed. Dismissed pairs are never returned. Reads only.
 */
export async function buildVendorSuggestions(supabase: Supabase, opts: { ai: boolean }): Promise<CmrVendorSuggestionsView> {
  const [catalog, dismissals] = await Promise.all([vendorCatalog(supabase), allDismissals(supabase)])
  const dismissed = new Set(dismissals.map((d) => pairKey(d.vendor_id_a, d.vendor_id_b)))
  const byId = new Map(catalog.map((e) => [e.id, e]))

  const matches = suggestVendorMerges(
    catalog.map((e) => ({ id: e.id, canonicalName: e.canonicalName, spellings: e.aliases.map((a) => a.rawName) })),
    { dismissed },
  )
  let pairs: CmrVendorSuggestion[] = matches.map((m) => ({
    a: summaryOf(byId.get(m.a)!),
    b: summaryOf(byId.get(m.b)!),
    kind: m.kind,
    score: m.score,
    reason: m.reason,
    ai: null,
  }))

  let ai: CmrVendorSuggestionsView['engine']['ai'] = 'off'
  let aiMessage: string | null = null
  if (opts.ai && catalog.length > 1) {
    const r = await reviewVendorDuplicates({
      vendors: catalog.map((e) => ({ id: e.id, name: e.canonicalName, spellings: e.aliases.map((a) => a.rawName), accounts: e.accounts.map((a) => a.name) })),
      pairs: matches.map((m) => ({ a: m.a, b: m.b, reason: m.reason })),
    })
    if (r.status === 'used') {
      ai = 'used'
      pairs = pairs.map((p, i) => {
        const rv = r.reviews.get(i)
        if (!rv) return p
        const score = rv.verdict === 'same' ? Math.min(1, p.score + 0.05) : rv.verdict === 'different' ? Math.max(0, p.score - 0.3) : p.score
        return { ...p, ai: rv, score: Math.round(score * 100) / 100 }
      })
      for (const x of r.additional) {
        const a = byId.get(x.a)
        const b = byId.get(x.b)
        if (!a || !b || dismissed.has(pairKey(a.id, b.id))) continue
        const [first, second] = a.id < b.id ? [a, b] : [b, a]
        pairs.push({ a: summaryOf(first), b: summaryOf(second), kind: 'ai', score: 0.6, reason: x.note, ai: { verdict: 'same', note: x.note } })
      }
      pairs.sort((p, q) => q.score - p.score)
    } else {
      ai = 'unavailable'
      aiMessage = r.message
    }
  }
  return { pairs, vendorCount: catalog.length, engine: { heuristic: true, ai, aiMessage } }
}

// ── the database functions ──────────────────────────────────────────────────

export type VendorRefusalCode = 'NOT_FOUND' | 'SAME_VENDOR' | 'WOULD_EMPTY' | 'BAD_ALIAS' | 'BAD_NAME' | 'NAME_TAKEN'

const REFUSAL: Record<VendorRefusalCode, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: 'That vendor no longer exists — it may have just been merged. Refresh and try again.' },
  SAME_VENDOR: { status: 400, message: 'Choose two different vendors to merge.' },
  WOULD_EMPTY: { status: 409, message: 'Leave at least one QuickBooks spelling with the original vendor.' },
  BAD_ALIAS: { status: 400, message: 'Choose spellings that belong to this vendor.' },
  BAD_NAME: { status: 400, message: 'Enter a vendor name of 1–200 characters.' },
  NAME_TAKEN: {
    status: 409,
    message: 'That name is already another vendor’s matching name (it may show under a different name since a rename). Choose a different name for the new vendor.',
  },
}

export class VendorRefused extends Error {
  constructor(public code: VendorRefusalCode) {
    super(REFUSAL[code].message)
  }
  response(): NextResponse {
    return bad(REFUSAL[this.code].message, this.code, REFUSAL[this.code].status)
  }
}

async function callRpc(supabase: Supabase, fn: string, args: Record<string, unknown>): Promise<unknown> {
  // supabase-js rpc() needs `this`; cast because the Database `Functions` type is deliberately empty.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc(fn, args)) as { data: unknown; error: { message: string } | null }
  if (error) {
    const code = (Object.keys(REFUSAL) as VendorRefusalCode[]).find((c) => new RegExp(`\\b${c}\\b`).test(error.message))
    if (code) throw new VendorRefused(code)
    throw new Error(error.message)
  }
  return data
}

/** cmr_merge_vendors: source's spellings and lines move to target; source is deleted. */
export async function mergeVendors(supabase: Supabase, args: { targetId: string; sourceId: string; actor: string }): Promise<void> {
  await callRpc(supabase, 'cmr_merge_vendors', { p_target: args.targetId, p_source: args.sourceId, p_actor: args.actor })
}

/** cmr_split_vendor: the given spellings (and their lines) move to a new vendor; returns its id. */
export async function splitVendor(
  supabase: Supabase,
  args: { sourceId: string; aliasIds: string[]; name: string; actor: string },
): Promise<string> {
  const data = await callRpc(supabase, 'cmr_split_vendor', {
    p_source: args.sourceId,
    p_alias_ids: args.aliasIds,
    p_new_canonical: args.name,
    p_actor: args.actor,
  })
  if (!isUuid(data)) throw new Error('The split did not return the new vendor.')
  return data
}

/** cmr_rename_vendor: display name only. */
export async function renameVendor(supabase: Supabase, args: { vendorId: string; name: string; actor: string }): Promise<void> {
  await callRpc(supabase, 'cmr_rename_vendor', { p_vendor: args.vendorId, p_canonical: args.name, p_actor: args.actor })
}

// ── small reads for validation and the audit trail ──────────────────────────

/** The given vendors that exist, with their spellings (for checks and audit entries). */
export async function vendorsWithAliases(supabase: Supabase, ids: string[]): Promise<Map<string, { name: string; aliases: AliasRow[] }>> {
  const unique = [...new Set(ids)]
  const out = new Map<string, { name: string; aliases: AliasRow[] }>()
  if (!unique.length) return out
  const [{ data: vs, error: ve }, { data: as, error: ae }] = await Promise.all([
    supabase.from('cmr_vendors').select('id, canonical_name').in('id', unique),
    supabase.from('cmr_vendor_aliases').select('id, vendor_id, raw_name, normalized_name').in('vendor_id', unique),
  ])
  if (ve) throw new Error(ve.message)
  if (ae) throw new Error(ae.message)
  for (const v of (vs ?? []) as { id: string; canonical_name: string }[]) out.set(v.id, { name: v.canonical_name, aliases: [] })
  for (const a of (as ?? []) as AliasRow[]) out.get(a.vendor_id)?.aliases.push(a)
  return out
}

/** How many current A/P lines point at a vendor (informational — for the audit entry). */
export async function vendorLineCount(supabase: Supabase, vendorId: string): Promise<number> {
  const { count, error } = await supabase.from('cmr_ap_lines').select('id', { count: 'exact', head: true }).eq('vendor_id', vendorId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Record a dismissed suggestion (ordered a < b, as the table requires). Idempotent: dismissing a
 * pair twice keeps the first row. Returns false when either vendor no longer exists.
 */
export async function dismissPair(supabase: Supabase, x: string, y: string, actor: string): Promise<boolean> {
  const [a, b] = x < y ? [x, y] : [y, x]
  const { error } = await supabase
    .from('cmr_vendor_merge_dismissals')
    .upsert({ vendor_id_a: a, vendor_id_b: b, dismissed_by: actor }, { onConflict: 'vendor_id_a,vendor_id_b', ignoreDuplicates: true })
  if (error) {
    if ((error as { code?: string }).code === '23503' || /foreign key/i.test(error.message)) return false
    throw new Error(error.message)
  }
  return true
}

/** A JSON object body, or null. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A vendor / alias id from a body: a UUID, lower-cased (the database orders uuids as lower-case hex). */
export const idOf = (v: unknown): string | null => (isUuid(v) ? v.toLowerCase() : null)
