import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped cmr_vendor_requests migration — the file in this repo IS the SQL that
 * was applied to the live database (`supabase migration new` + `db push`). Editing an applied
 * migration is what caused the 2026-09-10 drift, so this test pins its md5 and re-asserts the
 * rules the app depends on. If you must change the schema, add a NEW migration; don't touch
 * this file.
 *
 * The version lives in the filename and is asserted to be the single 14-digit stamp `db push`
 * recorded; the md5 is what makes the CONTENT immutable.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = '93f928503550cc5e72bd47cb4f296141'

const files = readdirSync(DIR).filter((f) => f.endsWith('_cmr_vendor_requests.sql'))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''

const PENDING_FN = 'public.cmr_place_request_pending(uuid, uuid, uuid, uuid, text, bigint, text, date, int)'
const PRIORITY_FN = 'public.cmr_place_request_priority(uuid, uuid, date, text, bigint, date, text, int)'

describe('cmr_vendor_requests migration', () => {
  it('is exactly one file, at a single applied version, byte-identical to what was applied', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d{14}_cmr_vendor_requests\.sql$/)
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('sorts after the weekly-priorities migration it builds on', () => {
    const priorities = readdirSync(DIR).filter((f) => f.endsWith('_cmr_weekly_priorities.sql'))
    expect(priorities).toHaveLength(1)
    expect(files[0] > priorities[0]).toBe(true)
  })

  it('keeps the service-role-only posture: RLS on, no policies, grants revoked', () => {
    expect(sql).toContain('alter table public.cmr_vendor_requests enable row level security;')
    expect(sql).toContain('revoke all on table public.cmr_vendor_requests from anon, authenticated;')
    expect(sql).not.toMatch(/create policy/i)
    for (const fn of [PENDING_FN, PRIORITY_FN]) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon, authenticated;`)
      expect(sql).toContain(`grant execute on function ${fn} to service_role;`)
    }
    expect(sql.match(/security invoker\s+set search_path = ''/g)).toHaveLength(2)
    expect(sql).not.toMatch(/security definer/i)
  })

  it('keeps the checks the API and UI rely on', () => {
    expect(sql).toContain('check (char_length(btrim(vendor)) between 1 and 80)')
    expect(sql).toContain('check (notes is null or char_length(btrim(notes)) between 1 and 500)')
    expect(sql).toContain('check (amount_cents >= 0 and amount_cents <= 99999999999)')
    expect(sql).toContain("check (status in ('queued', 'placed', 'paid', 'declined'))")
    expect(sql).toContain("check (placed_kind is null or placed_kind in ('pending', 'priority'))")
    // queued / declined carry NO placement …
    expect(sql).toContain("status in ('placed', 'paid')\n      or (placed_kind is null and placed_ref_id is null and placed_at is null)")
    // … and a placed one carries all of it.
    expect(sql).toContain("status <> 'placed'\n      or (placed_kind is not null and placed_ref_id is not null and placed_at is not null)")
  })

  it('keeps the submitter and the account attached (ON DELETE RESTRICT)', () => {
    expect(sql).toContain('requested_by  uuid not null references public.user_profiles(id) on delete restrict')
    expect(sql).toContain('account_id    uuid not null references public.cmr_accounts(id) on delete restrict')
    expect(sql).toContain('placed_by     uuid references public.user_profiles(id) on delete set null')
  })

  it('placing is atomic and re-checks the queue while holding the row', () => {
    // Both functions lock the request, refuse anything that has already left the queue, insert
    // the row and flip the request in the same statement — so a request is never marked placed
    // without its row, and never placed twice.
    expect(sql.match(/for update;/g)).toHaveLength(2)
    expect(sql.match(/raise exception 'NOT_QUEUED'/g)).toHaveLength(2)
    expect(sql.match(/raise exception 'NOT_FOUND'/g)).toHaveLength(2)
    expect(sql.match(/update public\.cmr_vendor_requests\n {5}set status = 'placed',/g)).toHaveLength(2)
    expect(sql).toContain("'request', p_request_id, p_notes, p_sort_order, p_placed_by")
  })

  it('indexes the queue and every foreign key', () => {
    for (const idx of ['status_idx', 'requested_by_idx', 'account_idx', 'placed_by_idx']) {
      expect(sql).toContain(`create index cmr_vendor_requests_${idx}`)
    }
  })

  it('seeds nothing, and the queue has no order of its own (created_at is the order)', () => {
    expect(sql).not.toMatch(/^\s*insert\s+into\s+public\.cmr_vendor_requests/im)
    // No sort_order COLUMN on the table and no reorder function — the only sort_order in this
    // file is the parameter each placement function passes to the table it writes into.
    expect(sql).not.toMatch(/^\s+sort_order\s+int/m)
    expect(sql).not.toMatch(/cmr_reorder_vendor_requests/i)
    expect(sql).toContain('create index cmr_vendor_requests_status_idx on public.cmr_vendor_requests (status, created_at);')
  })
})
