import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped cmr_push_carry migration — the file in this repo IS the SQL that was
 * applied to the live database (`supabase migration new` + `db push`). Editing an applied
 * migration is what caused the 2026-09-10 drift, so this test pins its md5 and re-asserts the
 * rules the app depends on. If you must change the schema, add a NEW migration; don't touch
 * this file.
 *
 * The version lives in the filename and is asserted to be the single 14-digit stamp `db push`
 * recorded; the md5 is what makes the CONTENT immutable.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = '845e43843b882f7e0e3b9feabcd7ae68'

const files = readdirSync(DIR).filter((f) => f.endsWith('_cmr_push_carry.sql'))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''

const PUSH_FN = 'public.cmr_push_pending_item(uuid, uuid, uuid, date, int)'
const CARRY_FN = 'public.cmr_carry_priority(uuid, uuid, date, int)'
const UNPLACE_FN = 'public.cmr_unplace_request(uuid)'

describe('cmr_push_carry migration', () => {
  it('is exactly one file, at a single applied version, byte-identical to what was applied', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d{14}_cmr_push_carry\.sql$/)
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('sorts after the vendor-requests migration it builds on', () => {
    const requests = readdirSync(DIR).filter((f) => f.endsWith('_cmr_vendor_requests.sql'))
    expect(requests).toHaveLength(1)
    expect(files[0] > requests[0]).toBe(true)
  })

  it('adds ONE column and its index, and creates or drops no table', () => {
    expect(sql).toContain(
      'alter table public.cmr_pending_items\n  add column pushed_from_id uuid references public.cmr_pending_items(id) on delete set null;',
    )
    expect(sql).toContain('create index cmr_pending_items_pushed_from_idx on public.cmr_pending_items (pushed_from_id);')
    // One ALTER, and nothing else touches the shape of an existing table.
    expect(sql.match(/^alter table/gm)).toHaveLength(1)
    expect(sql).not.toMatch(/create table/i)
    expect(sql).not.toMatch(/drop table|drop column|drop function/i)
  })

  it('keeps the service-role-only posture: no policies, grants revoked, invoker + empty search_path', () => {
    for (const fn of [PUSH_FN, CARRY_FN, UNPLACE_FN]) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon, authenticated;`)
      expect(sql).toContain(`grant execute on function ${fn} to service_role;`)
    }
    expect(sql.match(/security invoker\s+set search_path = ''/g)).toHaveLength(3)
    expect(sql).not.toMatch(/security definer/i)
    expect(sql).not.toMatch(/create policy/i)
  })

  it('every function locks its source row and re-checks the state before writing', () => {
    // Three functions, three FOR UPDATE locks on the row being moved (plus the placed row the
    // undo deletes), and a refusal for every state that must not move.
    expect(sql.match(/for update;/g)).toHaveLength(5)
    expect(sql).toContain("raise exception 'NOT_PENDING'")
    expect(sql).toContain("raise exception 'NOT_OPEN'")
    expect(sql).toContain("raise exception 'NOT_PLACED'")
    expect(sql).toContain("raise exception 'SAME_LEDGER'")
    expect(sql).toContain("raise exception 'SAME_WEEK'")
    expect(sql.match(/raise exception 'NOT_FOUND'/g)).toHaveLength(3)
  })

  it('the pushed copy keeps the original date, drops the source ref, and points back', () => {
    expect(sql).toContain("coalesce(v_item.original_date, v_item.effective_date), p_date,\n     'manual', null, v_item.notes, p_sort_order, p_actor, v_item.id)")
    expect(sql).toContain("update public.cmr_pending_items\n     set status = 'pushed'")
  })

  it('the carried copy keeps everything the Controller wrote, and the original becomes carried', () => {
    expect(sql).toContain("v_priority.notes, v_priority.is_top_priority, 'open',\n     v_priority.id, p_sort_order, p_actor)")
    expect(sql).toContain("update public.cmr_weekly_priorities\n     set status = 'carried'")
  })

  it('the undo refuses a paid or moved-on row, and re-queues the request', () => {
    expect(sql.match(/raise exception 'ROW_PAID'/g)).toHaveLength(2)
    expect(sql.match(/raise exception 'ROW_MOVED'/g)).toHaveLength(2)
    expect(sql).toContain("raise exception 'ROW_SETTLED'")
    expect(sql).toContain('where pushed_from_id = v_pending.id')
    expect(sql).toContain('where carried_from_id = v_priority.id')
    expect(sql).toContain("set status = 'queued',\n         placed_kind = null,\n         placed_ref_id = null,\n         placed_at = null,\n         placed_by = null")
  })

  it('seeds nothing and changes no existing row — every DML statement is inside a function body', () => {
    // A top-level statement starts at column 0; everything inside a function body is indented.
    expect(sql).not.toMatch(/^insert\s+into\s+public\./im)
    expect(sql).not.toMatch(/^update\s+public\./im)
    expect(sql).not.toMatch(/^delete\s+from\s+public\./im)
    // The inserts/updates that DO exist are the copy-and-flip inside the three functions.
    expect(sql.match(/^ {2}insert into public\./gm)).toHaveLength(2)
    expect(sql.match(/^ {2}update public\./gm)).toHaveLength(3)
    expect(sql.match(/^ +delete from public\./gm)).toHaveLength(2)
  })
})
