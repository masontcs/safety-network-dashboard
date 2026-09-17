import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped cmr_weekly_priorities migration — the file in this repo IS the SQL that
 * was applied to the live database (`supabase migration new` + `db push`, version
 * 20260916233006). Editing an applied migration is what caused the 2026-09-10 drift, so this
 * test pins its md5 and re-asserts the rules the app depends on. If you must change the schema,
 * add a NEW migration; don't touch this file.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const VERSION = '20260916233006'
const MD5 = 'b01d869d06e94b470cb012dac115e4d0'

const files = readdirSync(DIR).filter((f) => f.endsWith('_cmr_weekly_priorities.sql'))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''

describe('cmr_weekly_priorities migration', () => {
  it('is exactly one file, at the version applied to the live DB, byte-identical to what was applied', () => {
    expect(files).toEqual([`${VERSION}_cmr_weekly_priorities.sql`])
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('keeps the service-role-only posture: RLS on, no policies, grants revoked', () => {
    expect(sql).toContain('alter table public.cmr_weekly_priorities enable row level security;')
    expect(sql).toContain('revoke all on table public.cmr_weekly_priorities from anon, authenticated;')
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).toContain('revoke all on function public.cmr_reorder_weekly_priorities(date, uuid[]) from public, anon, authenticated;')
    expect(sql).toContain('grant execute on function public.cmr_reorder_weekly_priorities(date, uuid[]) to service_role;')
    expect(sql).toMatch(/security invoker\s+set search_path = ''/)
  })

  it('keeps the checks the API and UI rely on', () => {
    expect(sql).toContain("check (extract(dow from week_start) = 0)") // week_start is a Sunday
    expect(sql).toContain("check (status in ('open', 'resolved', 'paid', 'carried'))")
    expect(sql).toContain("check ((status = 'paid') = (paid_at is not null))")
    expect(sql).toContain("check (status = 'paid' or paid_by is null)")
    expect(sql).toContain('check (amount_cents >= 0 and amount_cents <= 99999999999)')
    expect(sql).toContain('check (carried_from_id is null or carried_from_id <> id)')
  })

  it('reorders are scoped to one week', () => {
    expect(sql).toContain('and w.week_start = p_week_start')
  })

  it('seeds nothing', () => {
    expect(sql).not.toMatch(/^\s*insert\s+into/im)
  })
})
