import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped cmr_vendor_request_invoices migration (AP Phase 2). The file in this
 * repo IS the SQL applied to the live database with the sanctioned flow
 * (`supabase migration new cmr_vendor_request_invoices` + `supabase db push`, via
 * apply-cmr-ap-phase2-migration.command). Editing an applied migration is what caused the
 * 2026-09-10 drift, so this pins its md5 and re-asserts the rules the app depends on. To change
 * the schema, add a NEW migration.
 *
 * The compose function's behaviour (amount = Σ lines, credits subtract, stale / other-vendor /
 * non-payable / inactive / not-positive refused with nothing written, edit replaces the
 * snapshot, a re-import leaves snapshot + amount intact with ap_line_id → NULL, a compose waits
 * for an in-flight re-import, anon/authenticated refused) was run against a real PostgreSQL 16
 * with this exact file and the real "STS AP 92226.xlsx" lines — see the AP Phase 2 status doc.
 * The route tests mirror the function in the fake client.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = '8949df1ab35ea8397aefae412d774cca'
const NAME = 'cmr_vendor_request_invoices'

const files = readdirSync(DIR).filter((f) => f.endsWith(`_${NAME}.sql`))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''
const FN = 'public.cmr_compose_vendor_request(uuid, uuid, uuid, uuid, text, text, uuid[], date, text)'

describe('cmr_vendor_request_invoices migration', () => {
  it('is exactly one file, at a single applied version, byte-identical to what was verified', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(new RegExp(`^\\d{14}_${NAME}\\.sql$`))
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('sorts after AP Phase 1 (cmr_ap), and only later CMR migrations sort after it', () => {
    const ap = readdirSync(DIR).filter((f) => f.endsWith('_cmr_ap.sql'))
    expect(ap).toHaveLength(1)
    expect(files[0] > ap[0]).toBe(true)
    // Only later CMR migrations (AP Phase 3a's cmr_vendors, …) may sort after it.
    const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    for (const f of all.slice(all.indexOf(files[0]) + 1)) expect(f).toMatch(/^\d{14}_cmr_[a-z0-9_]+\.sql$/)
  })

  it('keeps the service-role-only posture: RLS on, no policies, grants revoked', () => {
    expect(sql).toContain(`alter table public.${NAME} enable row level security;`)
    expect(sql).toContain(`revoke all on table public.${NAME} from anon, authenticated;`)
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).toContain(`revoke all on function ${FN} from public, anon, authenticated;`)
    expect(sql).toContain(`grant execute on function ${FN} to service_role;`)
    expect(sql.match(/security invoker\s+set search_path = ''/g)).toHaveLength(1)
    expect(sql).not.toMatch(/security definer/i)
  })

  it('has exactly the columns the phase specified, money in signed bigint cents', () => {
    for (const col of [
      'id                 uuid primary key default gen_random_uuid()',
      'request_id         uuid not null references public.cmr_vendor_requests(id) on delete cascade',
      'ap_line_id         uuid references public.cmr_ap_lines(id) on delete set null',
      'vendor_name        text not null',
      'invoice_num        text',
      'doc_type           text not null',
      'bill_date          date',
      'due_date           date',
      'open_balance_cents bigint not null',
      'created_at         timestamptz not null default now()',
    ]) {
      expect(sql).toContain(col)
    }
    expect(sql).toContain("check (doc_type in ('Bill', 'Credit'))")
  })

  it('indexes request_id and ap_line_id', () => {
    expect(sql).toContain(`create index cmr_vendor_request_invoices_request_idx on public.${NAME} (request_id);`)
    expect(sql).toContain(`create index cmr_vendor_request_invoices_ap_line_idx on public.${NAME} (ap_line_id);`)
  })

  it('does NOT alter cmr_vendor_requests (account_id already exists) and seeds nothing', () => {
    expect(sql).not.toMatch(/alter table public\.cmr_vendor_requests/i)
    expect(sql).not.toMatch(/add column/i)
    expect(sql).not.toMatch(/\bdrop\b/i)
    expect(sql).not.toMatch(/^\s*insert\s+into\s+public\.(?!cmr_vendor_request)/im)
    const phase5 = readdirSync(DIR).find((f) => f.endsWith('_cmr_vendor_requests.sql'))!
    expect(readFileSync(path.join(DIR, phase5), 'utf8')).toContain(
      'account_id    uuid not null references public.cmr_accounts(id) on delete restrict',
    )
  })

  it('composes in ONE transaction from the CURRENT payable lines — never a caller amount', () => {
    // locks the account against a concurrent re-import (which takes FOR UPDATE)
    expect(sql).toMatch(/from public\.cmr_accounts\n\s+where id = p_account_id\n\s+for share;/)
    // only the current import's payable lines of that vendor in that account count
    expect(sql).toContain('join public.cmr_ap_imports i on i.id = l.import_id and i.is_current')
    expect(sql).toContain('and l.vendor_name = p_vendor_name')
    expect(sql).toContain('and l.payable;')
    // every submitted id must match, or nothing is written
    expect(sql).toContain('if v_found <> v_wanted then')
    for (const r of ['NOT_FOUND', 'INACTIVE', 'NO_LINES', 'STALE_LINES', 'NOT_POSITIVE', 'TOO_LARGE', 'NOT_QUEUED', 'FORBIDDEN']) {
      expect(sql).toContain(`raise exception '${r}'`)
    }
    // amount_cents is the sum it computed; there is no amount parameter at all
    expect(sql).toContain('amount_cents = v_total')
    expect(sql).not.toMatch(/p_amount/)
    // an edit checks queued/owner (row locked) BEFORE the selection, so a placed request says so
    expect(sql.indexOf("raise exception 'NOT_QUEUED'")).toBeLessThan(sql.indexOf("raise exception 'STALE_LINES'"))
    // an edit replaces the snapshot
    expect(sql).toContain('delete from public.cmr_vendor_request_invoices\n     where request_id = p_request_id;')
  })
})
