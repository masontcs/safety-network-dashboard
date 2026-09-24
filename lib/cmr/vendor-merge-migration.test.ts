import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped cmr_vendor_merge migration (AP Phase 3b). The file in this repo IS the
 * SQL applied to the live database with the sanctioned flow (`supabase migration new
 * cmr_vendor_merge` + `supabase db push`, via apply-cmr-ap-phase3b-migration.command). Editing an
 * applied migration is what caused the 2026-09-10 drift, so this pins its md5 and re-asserts the
 * rules the app depends on. To change the schema, add a NEW migration.
 *
 * Its behaviour was run against a real PostgreSQL 16 on top of every earlier cmr_* migration with
 * the real STS / TCS / HLD / INC exports imported (see the AP Phase 3b status doc): TRAFFIX DEVICES
 * + TRAFFIX DEVICES INC merge to one vendor ($34,995.46, STS + Holdings) and stay merged across
 * re-imports; a split restores both; every refusal fires; a dismissal cascades with a merged-away
 * vendor; an import held open makes a merge wait (and vice versa); crossing merges never deadlock;
 * anon/authenticated are refused on the table and every function; the normalization recompute is
 * a no-op on the real data and stops the migration on a collision.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = '3b6011ded7dfe284552e3552fe9daf2d'
const NAME = 'cmr_vendor_merge'

const files = readdirSync(DIR).filter((f) => f.endsWith(`_${NAME}.sql`))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''
const code = sql.replace(/--[^\n]*/g, '')

const FNS = [
  'public.cmr_vendor_normalize(text)',
  'public.cmr_merge_vendors(uuid, uuid, uuid)',
  'public.cmr_split_vendor(uuid, uuid[], text, uuid)',
  'public.cmr_rename_vendor(uuid, text, uuid)',
]

const bodyOf = (name: string) => {
  const start = code.search(new RegExp(`create (or replace )?function public\\.${name}\\(`))
  expect(start, name).toBeGreaterThanOrEqual(0)
  const open = code.indexOf('$$', start)
  return code.slice(open + 2, code.indexOf('$$;', open + 2))
}

describe('cmr_vendor_merge migration', () => {
  it('is exactly one file, at a single applied version, byte-identical to what was verified', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(new RegExp(`^\\d{14}_${NAME}\\.sql$`))
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('sorts after AP Phase 3a (cmr_vendors), and only later CMR migrations sort after it', () => {
    const p3a = readdirSync(DIR).filter((f) => f.endsWith('_cmr_vendors.sql'))
    expect(p3a).toHaveLength(1)
    expect(files[0] > p3a[0]).toBe(true)
    const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    // Only a later subsystem may sort after it — another CMR migration, or a Western Highways
    // one (wh_*, built on CMR's patterns and touching no cmr_* object).
    for (const f of all.slice(all.indexOf(files[0]) + 1)) expect(f).toMatch(/^\d{14}_(cmr|wh)_[a-z0-9_]+\.sql$/)
  })

  it('keeps the service-role-only posture: RLS on, no policies, grants revoked, invoker + empty search_path', () => {
    expect(code).toContain('alter table public.cmr_vendor_merge_dismissals enable row level security;')
    expect(code).toContain('revoke all on table public.cmr_vendor_merge_dismissals from anon, authenticated;')
    expect(code).not.toMatch(/create policy/i)
    expect(code).not.toMatch(/security definer/i)
    expect(code).not.toMatch(/grant [^;]* to (anon|authenticated|public)/i)
    for (const fn of FNS) {
      expect(code).toContain(`revoke all on function ${fn} from public, anon, authenticated;`)
      expect(code).toContain(`grant execute on function ${fn} to service_role;`)
    }
    expect(code.match(/security invoker/g)).toHaveLength(4)
    expect(code.match(/set search_path = ''/g)).toHaveLength(4)
  })

  it('the dismissal table: ordered pair, unique, both sides cascade with their vendor, indexed', () => {
    const t = code.slice(code.indexOf('create table public.cmr_vendor_merge_dismissals'), code.indexOf(');', code.indexOf('create table public.cmr_vendor_merge_dismissals')))
    expect(t).toMatch(/vendor_id_a\s+uuid not null references public\.cmr_vendors\(id\) on delete cascade/)
    expect(t).toMatch(/vendor_id_b\s+uuid not null references public\.cmr_vendors\(id\) on delete cascade/)
    expect(t).toMatch(/dismissed_by uuid references public\.user_profiles\(id\) on delete set null/)
    expect(t).toMatch(/dismissed_at timestamptz not null default now\(\)/)
    expect(t).toContain('check (vendor_id_a < vendor_id_b)')
    expect(t).toContain('unique (vendor_id_a, vendor_id_b)')
    expect(code).toContain('on public.cmr_vendor_merge_dismissals (vendor_id_b)')
    expect(code).toContain('on public.cmr_vendor_merge_dismissals (dismissed_by)')
  })

  it('merge: refuses NOT_FOUND / SAME_VENDOR; locks accounts then both vendors in id order; moves aliases, then lines, then deletes', () => {
    const b = bodyOf('cmr_merge_vendors')
    expect(b).toContain("raise exception 'SAME_VENDOR'")
    expect(b).toContain("raise exception 'NOT_FOUND'")
    const accLock = b.search(/from public\.cmr_accounts\s+order by id\s+for no key update/)
    const venLock = b.search(/from public\.cmr_vendors\s+where id in \(p_target, p_source\)\s+order by id\s+for update/)
    const aliases = b.indexOf('update public.cmr_vendor_aliases')
    const lines = b.indexOf('update public.cmr_ap_lines')
    const del = b.indexOf('delete from public.cmr_vendors')
    expect(accLock).toBeGreaterThan(0)
    expect([accLock < venLock, venLock < aliases, aliases < lines, lines < del]).toEqual([true, true, true, true])
    expect(code).toMatch(/cmr_merge_vendors\(p_target uuid, p_source uuid, p_actor uuid\)\s+returns void/)
  })

  it('split: refuses BAD_NAME / NOT_FOUND / BAD_ALIAS / WOULD_EMPTY / NAME_TAKEN; moves only the chosen aliases and their lines', () => {
    const b = bodyOf('cmr_split_vendor')
    for (const c of ['BAD_NAME', 'NOT_FOUND', 'BAD_ALIAS', 'WOULD_EMPTY', 'NAME_TAKEN']) expect(b).toContain(`raise exception '${c}'`)
    expect(code).toMatch(/cmr_split_vendor\(p_source uuid, p_alias_ids uuid\[\], p_new_canonical text, p_actor uuid\)\s+returns uuid/)
    expect(b).toMatch(/where l\.vendor_id = p_source\s+and public\.cmr_vendor_normalize\(l\.vendor_name\) in/)
    expect(b).toMatch(/v_key := public\.cmr_vendor_normalize\(v_name\)/)
  })

  it('rename: display name only — never touches normalized_name or aliases', () => {
    const b = bodyOf('cmr_rename_vendor')
    expect(b).toMatch(/set canonical_name = v_name/)
    expect(b).not.toMatch(/normalized_name|cmr_vendor_aliases/)
    expect(b).toContain("raise exception 'BAD_NAME'")
    expect(b).toContain("raise exception 'NOT_FOUND'")
  })

  it('normalization: strip one trailing "." THEN trim (trim is the last step); recompute only without collisions', () => {
    const b = bodyOf('cmr_vendor_normalize')
    const strip = b.indexOf("right(t, 1) = '.'")
    const lastTrim = b.indexOf('btrim(')
    expect(lastTrim).toBeGreaterThanOrEqual(0)
    expect(lastTrim).toBeLessThan(strip) // the outer btrim wraps the strip
    expect(b).toContain("translate(p_name, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')")
    expect(b).toContain('[ \\t\\n\\r\\f\\v\\u00a0]+')
    expect(code).toContain("raise exception 'NORMALIZE_COLLISION'")
  })

  it('does not touch payments, requests, the import path or the parser; seeds nothing', () => {
    expect(code).not.toMatch(/cmr_vendor_requests|cmr_vendor_request_invoices|cmr_compose_vendor_request/)
    expect(code).not.toMatch(/cmr_ap_replace_import|cmr_resolve_ap_vendors/)
    expect(code).not.toMatch(/insert into public\.cmr_(accounts|access|vendor_aliases|vendor_merge_dismissals)/)
    expect(code).not.toMatch(/drop (table|function|column)/i)
  })
})
