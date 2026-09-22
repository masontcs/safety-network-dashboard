import { randomUUID } from 'node:crypto'
import { normalizeVendorName } from '@/lib/cmr/vendors'

/**
 * Test stand-ins for the AP Phase 3b database functions, step for step, over a fakeSupabase store
 * (supabase/migrations/*_cmr_vendor_merge.sql):
 *
 *   mergeVendors  ≙ cmr_merge_vendors(p_target, p_source, p_actor)
 *   splitVendor   ≙ cmr_split_vendor(p_source, p_alias_ids, p_new_canonical, p_actor)
 *   renameVendor  ≙ cmr_rename_vendor(p_vendor, p_canonical, p_actor)
 *
 * Deleting a vendor cascades to cmr_vendor_merge_dismissals (on delete cascade), as in the
 * database. The SQL itself was run against a real PostgreSQL 16 with the real A/P exports (see
 * the AP Phase 3b status doc); these mirror it so the route tests exercise the same behaviour.
 */

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
type Out = { message: string } | { data: unknown } | null

const chars = (s: string) => [...s].length

function deleteVendor(t: Tables, id: string) {
  t.cmr_vendors = (t.cmr_vendors ?? []).filter((v) => v.id !== id)
  t.cmr_vendor_merge_dismissals = (t.cmr_vendor_merge_dismissals ?? []).filter((d) => d.vendor_id_a !== id && d.vendor_id_b !== id)
  // aliases cascade too (a merge has already moved them away)
  t.cmr_vendor_aliases = (t.cmr_vendor_aliases ?? []).filter((a) => a.vendor_id !== id)
  for (const l of t.cmr_ap_lines ?? []) if (l.vendor_id === id) l.vendor_id = null
}

export function mergeVendors(a: Row, t: Tables): Out {
  const target = a.p_target as string | null
  const source = a.p_source as string | null
  if (!target || !source) return { message: 'NOT_FOUND' }
  if (target === source) return { message: 'SAME_VENDOR' }
  const vs = t.cmr_vendors ?? []
  if (!vs.some((v) => v.id === target) || !vs.some((v) => v.id === source)) return { message: 'NOT_FOUND' }
  for (const al of t.cmr_vendor_aliases ?? []) if (al.vendor_id === source) al.vendor_id = target
  for (const l of t.cmr_ap_lines ?? []) if (l.vendor_id === source) l.vendor_id = target
  deleteVendor(t, source)
  return null
}

export function splitVendor(a: Row, t: Tables): Out {
  const name = typeof a.p_new_canonical === 'string' ? a.p_new_canonical.replace(/^ +| +$/g, '') : null
  if (name === null || chars(name) < 1 || chars(name) > 200) return { message: 'BAD_NAME' }
  const key = normalizeVendorName(name)
  if (!key) return { message: 'BAD_NAME' }
  const source = a.p_source as string | null
  if (!source) return { message: 'NOT_FOUND' }
  const ids = a.p_alias_ids as (string | null)[] | null
  if (!ids || !ids.length || ids.includes(null)) return { message: 'BAD_ALIAS' }
  if (!(t.cmr_vendors ?? []).some((v) => v.id === source)) return { message: 'NOT_FOUND' }
  const wanted = new Set(ids)
  const owned = (t.cmr_vendor_aliases ?? []).filter((al) => wanted.has(al.id as string) && al.vendor_id === source)
  if (owned.length !== wanted.size) return { message: 'BAD_ALIAS' }
  if (!(t.cmr_vendor_aliases ?? []).some((al) => al.vendor_id === source && !wanted.has(al.id as string))) return { message: 'WOULD_EMPTY' }
  if ((t.cmr_vendors ?? []).some((v) => v.normalized_name === key)) return { message: 'NAME_TAKEN' }
  const id = randomUUID()
  t.cmr_vendors.push({ id, canonical_name: name, normalized_name: key, created_at: new Date().toISOString(), created_by: a.p_actor ?? null })
  const keys = new Set(owned.map((al) => al.normalized_name as string))
  for (const al of owned) al.vendor_id = id
  for (const l of t.cmr_ap_lines ?? []) {
    if (l.vendor_id === source && keys.has(normalizeVendorName(l.vendor_name as string))) l.vendor_id = id
  }
  return { data: id }
}

export function renameVendor(a: Row, t: Tables): Out {
  const name = typeof a.p_canonical === 'string' ? a.p_canonical.replace(/^ +| +$/g, '') : null
  if (name === null || chars(name) < 1 || chars(name) > 200) return { message: 'BAD_NAME' }
  const v = (t.cmr_vendors ?? []).find((x) => x.id === a.p_vendor)
  if (!v) return { message: 'NOT_FOUND' }
  v.canonical_name = name
  return null
}
