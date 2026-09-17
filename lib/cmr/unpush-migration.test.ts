import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped cmr_unpush migration — the file in this repo IS the SQL that was
 * applied to the live database (`supabase migration new` + `db push`). Editing an applied
 * migration is what caused the 2026-09-10 drift, so this test pins its md5 and re-asserts the
 * rules the app depends on. If you must change the schema, add a NEW migration.
 *
 * What it is guarding: the two things that make a push impossible to lose — the deliberate
 * reverse (cmr_unpush_pending_item) and the structural safety net (the AFTER DELETE trigger).
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = '7a15223617c4046376699dda5beaee05'

const files = readdirSync(DIR).filter((f) => f.endsWith('_cmr_unpush.sql'))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''

const UNPUSH_FN = 'public.cmr_unpush_pending_item(uuid)'

describe('cmr_unpush migration', () => {
  it('is exactly one file, at a single applied version, byte-identical to what was applied', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d{14}_cmr_unpush\.sql$/)
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('sorts after the push_carry migration whose column and statuses it works on', () => {
    const pushCarry = readdirSync(DIR).filter((f) => f.endsWith('_cmr_push_carry.sql'))
    expect(pushCarry).toHaveLength(1)
    expect(files[0] > pushCarry[0]).toBe(true)
  })

  it('changes no table shape at all — two functions and one trigger', () => {
    expect(sql).not.toMatch(/create table|alter table|drop table|drop column|add column/i)
    expect(sql.match(/^create function public\./gm)).toHaveLength(2)
    expect(sql).toContain('create trigger cmr_pending_items_revive_source\nafter delete on public.cmr_pending_items\nfor each row\nexecute function public.cmr_revive_pushed_source();')
  })

  it('keeps the service-role-only posture on the callable function', () => {
    expect(sql).toContain(`revoke all on function ${UNPUSH_FN} from public, anon, authenticated;`)
    expect(sql).toContain(`grant execute on function ${UNPUSH_FN} to service_role;`)
    expect(sql.match(/security invoker\s+set search_path = ''/g)).toHaveLength(2)
    expect(sql).not.toMatch(/security definer/i)
    expect(sql).not.toMatch(/create policy/i)
    // The trigger function takes no grants of its own, and the file says why (a `returns
    // trigger` function can't be called from SQL, and triggers skip the EXECUTE check).
    expect(sql).not.toMatch(/revoke all on function public\.cmr_revive_pushed_source/)
    expect(sql).toContain('cannot be called from SQL directly')
  })

  it('un-push locks both rows and refuses a copy that was paid or moved on', () => {
    expect(sql.match(/for update;/g)).toHaveLength(2) // the source, then its copy
    expect(sql).toContain("raise exception 'NOT_PUSHED'")
    expect(sql).toContain("raise exception 'ROW_PAID'")
    expect(sql).toContain("raise exception 'ROW_MOVED'")
    expect(sql).toContain("raise exception 'NOT_FOUND'")
    expect(sql).toContain('where pushed_from_id = v_copy.id')
    expect(sql).toContain('delete from public.cmr_pending_items where id = v_copy.id;')
  })

  it('the safety net revives the source only while it is still pushed, and only when no copy is left', () => {
    expect(sql).toContain('if old.pushed_from_id is not null then')
    expect(sql).toContain("set status = 'pending'")
    expect(sql).toContain("and status = 'pushed'")
    expect(sql).toContain('and c.id <> old.id')
  })

  it('seeds nothing and changes no existing row at the top level', () => {
    expect(sql).not.toMatch(/^insert\s+into\s+public\./im)
    expect(sql).not.toMatch(/^update\s+public\./im)
    expect(sql).not.toMatch(/^delete\s+from\s+public\./im)
  })
})
