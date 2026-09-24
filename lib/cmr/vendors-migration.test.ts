import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped cmr_vendors migration (AP Phase 3a). The file in this repo IS the SQL
 * applied to the live database with the sanctioned flow (`supabase migration new cmr_vendors` +
 * `supabase db push`, via apply-cmr-ap-phase3a-migration.command). Editing an applied migration
 * is what caused the 2026-09-10 drift, so this pins its md5 and re-asserts the rules the app
 * depends on. To change the schema, add a NEW migration.
 *
 * Its behaviour was run against a real PostgreSQL 16 with every earlier cmr_* migration and the
 * real STS / TCS / HLD / INC A/P exports (see the AP Phase 3a status doc): the backfill links all
 * 147 STS lines (33 payable vendors, $107,577.75); the four accounts give 250 vendors, 12 in more
 * than one account; re-imports and re-runs create nothing; two imports of different accounts with
 * the same new names at once serialise with no duplicate and no deadlock; anon/authenticated get
 * "permission denied" on both tables and every function; a Phase 2 compose still sums correctly.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = 'bc37fe6a35b4e4ad3a85cb1c5cb902a2'
const NAME = 'cmr_vendors'

const files = readdirSync(DIR).filter((f) => f.endsWith(`_${NAME}.sql`))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''
const phase1 = readFileSync(path.join(DIR, readdirSync(DIR).find((f) => f.endsWith('_cmr_ap.sql'))!), 'utf8')

const FNS = [
  'public.cmr_vendor_normalize(text)',
  'public.cmr_resolve_ap_vendors(uuid, uuid)',
  'public.cmr_ap_replace_import(uuid, uuid, text, bigint, jsonb)',
]

/** The body of `create [or replace] function public.<name>(` … `$$;` */
const bodyOf = (src: string, name: string) => {
  const start = src.search(new RegExp(`create (or replace )?function public\\.${name}\\(`))
  const open = src.indexOf('$$', start)
  return src.slice(open + 2, src.indexOf('$$;', open + 2))
}

describe('cmr_vendors migration', () => {
  it('is exactly one file, at a single applied version, byte-identical to what was verified', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(new RegExp(`^\\d{14}_${NAME}\\.sql$`))
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('sorts after AP Phase 2 (cmr_vendor_request_invoices), and only later CMR migrations sort after it', () => {
    const p2 = readdirSync(DIR).filter((f) => f.endsWith('_cmr_vendor_request_invoices.sql'))
    expect(p2).toHaveLength(1)
    expect(files[0] > p2[0]).toBe(true)
    const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    // Only a later subsystem may sort after it — another CMR migration, or a Western Highways
    // one (wh_*, built on CMR's patterns and touching no cmr_* object).
    for (const f of all.slice(all.indexOf(files[0]) + 1)) expect(f).toMatch(/^\d{14}_(cmr|wh)_[a-z0-9_]+\.sql$/)
  })

  it('keeps the service-role-only posture: RLS on, no policies, grants revoked, invoker + empty search_path', () => {
    for (const t of ['cmr_vendors', 'cmr_vendor_aliases']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`)
      expect(sql).toContain(`revoke all on table public.${t} from anon, authenticated;`)
    }
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).not.toMatch(/security definer/i)
    for (const fn of FNS) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon, authenticated;`)
      expect(sql).toContain(`grant execute on function ${fn} to service_role;`)
    }
    expect(sql.match(/security invoker\s+set search_path = ''/g)).toHaveLength(3)
  })

  it('has exactly the columns the phase specified', () => {
    for (const col of [
      'id              uuid primary key default gen_random_uuid()',
      'canonical_name  text not null',
      'normalized_name text not null unique',
      'created_at      timestamptz not null default now()',
      'created_by      uuid references public.user_profiles(id) on delete set null',
      'vendor_id       uuid not null references public.cmr_vendors(id) on delete cascade',
      'raw_name        text not null',
      'check (char_length(canonical_name) between 1 and 200)',
      'check (char_length(raw_name) between 1 and 200)',
    ]) {
      expect(sql).toContain(col)
    }
    expect(sql).toContain(
      'alter table public.cmr_ap_lines\n  add column vendor_id uuid references public.cmr_vendors(id) on delete set null;',
    )
    expect(sql).toContain('create index cmr_ap_lines_vendor_id_idx on public.cmr_ap_lines (vendor_id);')
    expect(sql).toContain('create index cmr_vendor_aliases_vendor_idx on public.cmr_vendor_aliases (vendor_id);')
  })

  it('normalizes conservatively: ASCII upper, whitespace collapse, trim, one trailing dot — nothing else', () => {
    const fn = bodyOf(sql, 'cmr_vendor_normalize')
    expect(fn).toContain("translate(p_name, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')")
    expect(fn).toContain("'[ \\t\\n\\r\\f\\v\\u00a0]+', ' ', 'g'")
    expect(fn).toContain("when char_length(t) > 1 and right(t, 1) = '.' then left(t, -1)")
    expect(fn).not.toMatch(/\b(INC|LLC|CORP)\b/)
    expect(sql).toMatch(/create function public\.cmr_vendor_normalize\(p_name text\)\nreturns text\nlanguage sql\nimmutable/)
  })

  it('resolves idempotently and race-safely: account FOR UPDATE, ON CONFLICT DO NOTHING, sorted inserts, never unlinked', () => {
    const fn = bodyOf(sql, 'cmr_resolve_ap_vendors')
    expect(fn).toMatch(/from public\.cmr_accounts\n\s+where id = p_account_id\n\s+for update;/)
    expect(fn.match(/on conflict \(normalized_name\) do nothing/g)).toHaveLength(2)
    expect(fn.match(/order by n\.k\n/g)).toHaveLength(2)
    expect(fn).toContain('and l.vendor_id is distinct from a.vendor_id;')
    expect(fn).toContain("raise exception 'UNRESOLVED'")
    expect(fn).toContain("raise exception 'NOT_FOUND'")
    // the raw vendor_name is never written
    expect(fn).not.toMatch(/set\s+vendor_name/i)
  })

  it('redefines cmr_ap_replace_import as AP Phase 1’s body plus ONE last step — the resolver, same transaction', () => {
    const before = bodyOf(phase1, 'cmr_ap_replace_import')
    const after = bodyOf(sql, 'cmr_ap_replace_import')
    const added = '\n  -- AP Phase 3a: link the new lines to canonical vendors before this transaction commits.\n  perform public.cmr_resolve_ap_vendors(p_account_id, p_actor);\n'
    expect(after).toContain(added)
    expect(after.replace(added, '')).toBe(before)
    expect(sql).toMatch(/create or replace function public\.cmr_ap_replace_import\(\n\s+p_account_id\s+uuid,\n\s+p_actor\s+uuid,\n\s+p_source_filename\s+text,\n\s+p_report_total_cents bigint,\n\s+p_lines\s+jsonb\n\)\nreturns uuid/)
  })

  it('backfills every current import and refuses to commit if anything named is still unlinked', () => {
    expect(sql).toMatch(/for r in\n\s+select account_id, imported_by\n\s+from public\.cmr_ap_imports\n\s+where is_current/)
    expect(sql).toContain('perform public.cmr_resolve_ap_vendors(r.account_id, r.imported_by);')
    expect(sql).toContain("raise exception 'BACKFILL_INCOMPLETE';")
  })

  it('does not touch payments: requests, their invoices and the compose function are left alone; nothing seeded or dropped', () => {
    // (the header comment names them to say so — only the SQL itself is checked)
    const code = sql.replace(/--[^\n]*/g, '')
    expect(code).not.toMatch(/cmr_vendor_requests\b/)
    expect(code).not.toMatch(/cmr_vendor_request_invoices/)
    expect(code).not.toMatch(/cmr_compose_vendor_request/)
    expect(code).not.toMatch(/\bdrop\b/i)
    expect(sql).not.toMatch(/^\s*insert\s+into\s+public\.(?!cmr_vendors|cmr_vendor_aliases|cmr_ap_imports|cmr_ap_lines)/im)
    expect(sql).not.toMatch(/^\s*(insert|update|delete)\b[^;]*\bvalues\b[^;]*'[A-Z ]{3,}'/im)
  })
})
