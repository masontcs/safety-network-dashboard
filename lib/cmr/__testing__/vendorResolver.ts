import { randomUUID } from 'node:crypto'
import { normalizeVendorName } from '@/lib/cmr/vendors'

/**
 * Test stand-ins for the AP Phase 3a database functions, step for step, over a fakeSupabase
 * store (supabase/migrations/*_cmr_vendors.sql):
 *
 *   resolveApVendors  ≙ cmr_resolve_ap_vendors(p_account_id, p_actor)
 *   replaceApImport   ≙ cmr_ap_replace_import(...) — AP Phase 1's replace, then the resolver
 *
 * The SQL itself was run against a real PostgreSQL 16 with the real A/P exports (see the AP
 * Phase 3a status doc); these mirror it so the route tests exercise the same behaviour.
 */

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

/** cmr_resolve_ap_vendors: register unseen spellings, then link every current line. */
export function resolveApVendors(t: Tables, accountId: string, actor: string | null): { message: string } | { data: number } {
  const acc = (t.cmr_accounts ?? []).find((a) => a.id === accountId)
  if (!acc) return { message: 'NOT_FOUND' }
  const imp = (t.cmr_ap_imports ?? []).find((i) => i.account_id === accountId && i.is_current)
  if (!imp) return { data: 0 }
  t.cmr_vendors ??= []
  t.cmr_vendor_aliases ??= []
  const lines = (t.cmr_ap_lines ?? []).filter((l) => l.import_id === imp.id)

  // distinct on (k) … order by k, raw
  const first = new Map<string, string>()
  for (const l of lines) {
    const raw = l.vendor_name as string
    const k = normalizeVendorName(raw)
    if (!k) continue
    const cur = first.get(k)
    if (cur === undefined || raw < cur) first.set(k, raw)
  }
  const keys = [...first.keys()].sort()
  const aliasKeys = () => new Set(t.cmr_vendor_aliases.map((a) => a.normalized_name))

  // a. vendors (on conflict (normalized_name) do nothing)
  let created = 0
  const known = aliasKeys()
  for (const k of keys) {
    if (known.has(k)) continue
    if (t.cmr_vendors.some((v) => v.normalized_name === k)) continue
    t.cmr_vendors.push({ id: randomUUID(), canonical_name: first.get(k), normalized_name: k, created_at: new Date().toISOString(), created_by: actor })
    created++
  }
  // b. aliases
  const known2 = aliasKeys()
  for (const k of keys) {
    if (known2.has(k)) continue
    const v = t.cmr_vendors.find((x) => x.normalized_name === k)
    if (!v) continue
    t.cmr_vendor_aliases.push({ id: randomUUID(), vendor_id: v.id, raw_name: first.get(k), normalized_name: k, created_at: new Date().toISOString() })
  }
  // c. link
  const byKey = new Map(t.cmr_vendor_aliases.map((a) => [a.normalized_name as string, a.vendor_id as string]))
  for (const l of lines) {
    const k = normalizeVendorName(l.vendor_name as string)
    if (k) l.vendor_id = byKey.get(k) ?? null
  }
  if (lines.some((l) => !l.vendor_id && normalizeVendorName(l.vendor_name as string))) return { message: 'UNRESOLVED' }
  return { data: created }
}

let seq = 0

/** cmr_ap_replace_import (AP Phase 1 steps) + the AP Phase 3a resolver as its last step. */
export function replaceApImport(args: Record<string, unknown>, t: Tables): { message: string } | { data: unknown } {
  const acc = (t.cmr_accounts ?? []).find((a) => a.id === args.p_account_id)
  if (!acc) return { message: 'NOT_FOUND' }
  if (!acc.active) return { message: 'INACTIVE' }
  if (!Array.isArray(args.p_lines)) return { message: 'BAD_LINES' }
  t.cmr_ap_imports ??= []
  t.cmr_ap_lines ??= []
  const old = t.cmr_ap_imports.filter((i) => i.account_id === args.p_account_id && i.is_current).map((i) => i.id)
  t.cmr_ap_imports = t.cmr_ap_imports.filter((i) => !old.includes(i.id))
  t.cmr_ap_lines = t.cmr_ap_lines.filter((l) => !old.includes(l.import_id))
  const importId = randomUUID()
  const lines: Row[] = (args.p_lines as Row[]).map((l) => ({
    id: randomUUID(),
    import_id: importId,
    account_id: args.p_account_id,
    invoice_num: null,
    bill_date: null,
    due_date: null,
    aging_days: null,
    aging_bucket: null,
    ...l,
    payable: l.doc_type === 'Bill' || l.doc_type === 'Credit',
    vendor_id: null,
    created_at: '2026-09-22T18:00:00Z',
  }))
  t.cmr_ap_lines.push(...lines)
  t.cmr_ap_imports.push({
    id: importId,
    account_id: args.p_account_id,
    source_filename: args.p_source_filename ?? null,
    report_total_cents: args.p_report_total_cents ?? 0,
    payable_total_cents: lines.filter((l) => l.payable).reduce((s, l) => s + Number(l.open_balance_cents), 0),
    line_count: lines.length,
    imported_by: args.p_actor ?? null,
    imported_at: `2026-09-22T18:${String(++seq % 60).padStart(2, '0')}:00Z`,
    is_current: true,
  })
  const r = resolveApVendors(t, args.p_account_id as string, (args.p_actor as string) ?? null)
  if ('message' in r) return r
  return { data: importId }
}
