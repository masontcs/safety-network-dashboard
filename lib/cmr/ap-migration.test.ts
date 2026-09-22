import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped cmr_ap migration (AP Phase 1). The file in this repo IS the SQL that
 * is applied to the live database with the sanctioned flow (`supabase migration new cmr_ap` +
 * `supabase db push`, via apply-cmr-ap-migration.command). Editing an applied migration is what
 * caused the 2026-09-10 drift, so this test pins its md5 and re-asserts the rules the app
 * depends on. To change the schema, add a NEW migration — don't touch this file.
 *
 * The version lives in the filename (the single 14-digit stamp `migration new` gave it); the
 * md5 is what makes the CONTENT immutable.
 *
 * The replace semantics themselves (a second import leaves exactly one current import with its
 * lines; refusals change nothing; payable is derived from doc_type; anon/authenticated are
 * refused) were run against a real PostgreSQL 16 with this exact file before shipping — see
 * the AP Phase 1 status doc. The route tests mirror the function in the fake client.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = '105317447be1971e25159b65180bf64f'

const files = readdirSync(DIR).filter((f) => f.endsWith('_cmr_ap.sql'))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''

const FN = 'public.cmr_ap_replace_import(uuid, uuid, text, bigint, jsonb)'

describe('cmr_ap migration', () => {
  it('is exactly one file, at a single applied version, byte-identical to what was verified', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d{14}_cmr_ap\.sql$/)
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('sorts after every earlier CMR migration (Phase 7 is the last one it builds on)', () => {
    const phase7 = readdirSync(DIR).filter((f) => f.endsWith('_cmr_recurring_schedule.sql'))
    expect(phase7).toHaveLength(1)
    expect(files[0] > phase7[0]).toBe(true)
    // Only later CMR migrations (AP Phase 2's cmr_vendor_request_invoices, …) may sort after it.
    const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(all.filter((f) => f > files[0]).every((f) => /^\d{14}_cmr_/.test(f))).toBe(true)
  })

  it('keeps the service-role-only posture: RLS on, no policies, grants revoked', () => {
    for (const t of ['cmr_ap_imports', 'cmr_ap_lines']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`)
      expect(sql).toContain(`revoke all on table public.${t} from anon, authenticated;`)
    }
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).toContain(`revoke all on function ${FN} from public, anon, authenticated;`)
    expect(sql).toContain(`grant execute on function ${FN} to service_role;`)
    expect(sql.match(/security invoker\s+set search_path = ''/g)).toHaveLength(1)
    expect(sql).not.toMatch(/security definer/i)
  })

  it('has the columns the phase specified, money in bigint cents', () => {
    expect(sql).toContain('account_id          uuid not null references public.cmr_accounts(id) on delete restrict')
    expect(sql).toContain('imported_by         uuid references public.user_profiles(id) on delete set null')
    expect(sql).toContain('report_total_cents  bigint')
    expect(sql).toContain('payable_total_cents bigint')
    expect(sql).toContain('line_count          int not null default 0')
    expect(sql).toContain('is_current          boolean not null default true')
    expect(sql).toContain('import_id          uuid not null references public.cmr_ap_imports(id) on delete cascade')
    expect(sql).toContain('account_id         uuid not null references public.cmr_accounts(id) on delete restrict')
    expect(sql).toContain('open_balance_cents bigint not null')
    expect(sql).toContain('payable            boolean not null default false')
    for (const col of ['vendor_name        text not null', 'invoice_num        text', 'doc_type           text not null',
      'bill_date          date', 'due_date           date', 'aging_days         int', 'aging_bucket       text']) {
      expect(sql).toContain(col)
    }
  })

  it('allows only one current import per account', () => {
    expect(sql).toContain('create unique index cmr_ap_imports_one_current_idx\n  on public.cmr_ap_imports (account_id) where is_current;')
  })

  it('only a Bill or a Credit can ever be payable — enforced by the database', () => {
    expect(sql).toContain("check (payable = (doc_type in ('Bill', 'Credit')))")
    // … and the function derives payable itself rather than trusting the caller
    expect(sql).toContain("l.doc_type in ('Bill', 'Credit')")
    const recordset = /jsonb_to_recordset\(p_lines\) as l\(([\s\S]*?)\);/.exec(sql)?.[1] ?? ''
    expect(recordset).toContain('open_balance_cents bigint')
    expect(recordset).not.toContain('payable') // the caller's JSON cannot set it
  })

  it('replacing is one transaction: lock the account, refuse unknown/inactive, delete the old, insert the new', () => {
    expect(sql).toMatch(/from public\.cmr_accounts\n\s+where id = p_account_id\n\s+for update;/)
    expect(sql).toContain("raise exception 'NOT_FOUND'")
    expect(sql).toContain("raise exception 'INACTIVE'")
    expect(sql).toContain("raise exception 'BAD_LINES'")
    const del = sql.indexOf('delete from public.cmr_ap_imports')
    const ins = sql.indexOf('insert into public.cmr_ap_imports')
    expect(del).toBeGreaterThan(0)
    expect(ins).toBeGreaterThan(del) // old snapshot out before the new one lands
    expect(sql).toContain('where account_id = p_account_id\n     and is_current;')
    // the payable total is summed from the lines, never taken from a parameter
    expect(sql).not.toMatch(/p_payable_total/)
  })

  it('indexes what the phase asked for, plus the imported_by foreign key', () => {
    expect(sql).toContain('create index cmr_ap_imports_account_idx on public.cmr_ap_imports (account_id);')
    expect(sql).toContain('create index cmr_ap_imports_imported_by_idx on public.cmr_ap_imports (imported_by);')
    expect(sql).toContain('create index cmr_ap_lines_import_idx on public.cmr_ap_lines (import_id);')
    expect(sql).toContain('create index cmr_ap_lines_account_payable_idx on public.cmr_ap_lines (account_id, payable);')
    expect(sql).toContain('create index cmr_ap_lines_vendor_idx on public.cmr_ap_lines (vendor_name);')
  })

  it('seeds nothing and touches no other table', () => {
    expect(sql).not.toMatch(/^\s*insert\s+into\s+public\.(?!cmr_ap_)/im)
    expect(sql).not.toMatch(/alter table public\.(?!cmr_ap_)/i)
    expect(sql).not.toMatch(/\bdrop\b/i)
  })
})
