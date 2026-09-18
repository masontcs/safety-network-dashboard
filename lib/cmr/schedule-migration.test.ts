import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped cmr_recurring_schedule migration — the file in this repo IS the SQL
 * that was applied to the live database (`supabase migration new` + `db push`). Editing an
 * applied migration is what caused the 2026-09-10 drift, so this test pins its md5 and
 * re-asserts the rules the engine and the API depend on. If the schema must change again, add a
 * NEW migration; don't touch this file.
 *
 * The version is read from the filename rather than hard-coded: `supabase migration new` stamps
 * it at the moment it runs, and there must be exactly one such file.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = '43c0a619f1ed8155abd9381afeddd759'

const files = readdirSync(DIR).filter((f) => f.endsWith('_cmr_recurring_schedule.sql'))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''

describe('cmr_recurring_schedule migration', () => {
  it('is exactly one file, byte-identical to what was applied, stamped after Phase 6', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d{14}_cmr_recurring_schedule\.sql$/)
    // It must sort AFTER the last Phase 6 migration, or db push would apply it out of order.
    expect(files[0].slice(0, 14) > '20260917223153').toBe(true)
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('widens the section check to the four frequencies plus urgent', () => {
    expect(sql).toContain("check (section in ('weekly', 'monthly', 'quarterly', 'annually', 'urgent'))")
    expect(sql).toContain('drop constraint cmr_recurring_vendors_section_chk')
  })

  it('adds the three schedule columns with their ranges', () => {
    expect(sql).toContain('add column schedule_weekday      smallint')
    expect(sql).toContain('add column schedule_day_of_month smallint')
    expect(sql).toContain('add column schedule_anchor_month smallint')
    expect(sql).toContain('check (schedule_weekday is null or schedule_weekday between 0 and 6)')
    expect(sql).toContain('check (schedule_day_of_month is null or schedule_day_of_month between 1 and 31)')
    expect(sql).toContain('check (schedule_anchor_month is null or schedule_anchor_month between 1 and 12)')
  })

  it('ties the schedule to the section: each frequency may carry only its own fields', () => {
    expect(sql).toContain("when 'weekly'    then schedule_day_of_month is null and schedule_anchor_month is null")
    expect(sql).toContain("when 'monthly'   then schedule_weekday is null and schedule_anchor_month is null")
    expect(sql).toContain("when 'quarterly' then schedule_weekday is null")
    expect(sql).toContain("when 'annually'  then schedule_weekday is null")
    expect(sql).toMatch(/when 'urgent'\s+then schedule_weekday is null and schedule_day_of_month is null/)
  })

  it('requires a COMPLETE schedule for each frequency, or none at all', () => {
    expect(sql).toContain("when 'weekly'    then schedule_weekday is not null")
    expect(sql).toContain("when 'monthly'   then schedule_day_of_month is not null")
    expect(sql).toContain("when 'quarterly' then schedule_day_of_month is not null and schedule_anchor_month is not null")
    expect(sql).toContain("when 'annually'  then schedule_day_of_month is not null and schedule_anchor_month is not null")
    // The deploy-window allowance: an all-null row from the build live at migration time lands.
    expect(sql).toContain(
      '(schedule_weekday is null and schedule_day_of_month is null and schedule_anchor_month is null)',
    )
  })

  it('adds both new constraints the safe way: NOT VALID, then VALIDATE', () => {
    for (const name of ['cmr_recurring_vendors_schedule_shape_chk', 'cmr_recurring_vendors_schedule_complete_chk']) {
      expect(sql, name).toContain(`add constraint ${name}`)
      expect(sql, name).toContain(`validate constraint ${name}`)
    }
    expect(sql.match(/not valid;/g) ?? []).toHaveLength(2)
  })

  it('records on a priority which recurring vendor it came from, and indexes both lookups', () => {
    expect(sql).toContain(
      'add column source_recurring_id uuid references public.cmr_recurring_vendors(id) on delete set null',
    )
    expect(sql).toContain('create index cmr_weekly_priorities_source_recurring_idx')
    expect(sql).toContain('create index cmr_pending_items_recurring_source_idx')
    expect(sql).toContain("where source = 'recurring'")
  })

  it('keeps the deprecated free-text cadence column so the live build survives the deploy', () => {
    expect(sql).not.toMatch(/drop column\s+recurrence_detail/i)
    expect(sql).toContain('DEPRECATED (Phase 7)')
  })

  it('accepting a suggestion locks the vendor and re-checks the occurrence window', () => {
    for (const fn of ['cmr_place_recurring_pending', 'cmr_place_recurring_priority']) {
      expect(sql, fn).toContain(`create function public.${fn}(`)
    }
    expect(sql.match(/for update;/g) ?? []).toHaveLength(2)
    expect(sql.match(/raise exception 'ALREADY_HANDLED'/g) ?? []).toHaveLength(2)
    expect(sql.match(/raise exception 'ON_HOLD'/g) ?? []).toHaveLength(2)
    expect(sql.match(/raise exception 'INACTIVE'/g) ?? []).toHaveLength(2)
    expect(sql.match(/raise exception 'NOT_SCHEDULED'/g) ?? []).toHaveLength(2)
    // The window check reads BOTH tables: a pending item by its date, a priority by its week.
    expect(sql.match(/effective_date between p_window_start and p_window_end/g) ?? []).toHaveLength(2)
    expect(sql.match(/week_start \+ 6 >= p_window_start/g) ?? []).toHaveLength(2)
  })

  it('keeps the service-role-only posture on both new functions', () => {
    expect(sql).not.toMatch(/create policy/i)
    expect(sql.match(/security invoker\s+set search_path = ''/g) ?? []).toHaveLength(2)
    expect(sql.match(/revoke all on function public\.cmr_place_recurring_\w+\([^)]*\) from public, anon, authenticated;/g) ?? [])
      .toHaveLength(2)
    expect(sql.match(/grant execute on function public\.cmr_place_recurring_\w+\([^)]*\) to service_role;/g) ?? [])
      .toHaveLength(2)
  })

  it('seeds nothing, and drops nothing but the widened section check', () => {
    // The only inserts are inside the two placement functions, which are indented; a seed would
    // sit at the start of a line.
    expect(sql).not.toMatch(/^insert\s+into/im)
    expect(sql).not.toMatch(/drop table/i)
    expect(sql).not.toMatch(/drop function/i)
    expect(sql).not.toMatch(/drop column/i)
    expect(sql.match(/drop constraint \w+/g) ?? []).toEqual(['drop constraint cmr_recurring_vendors_section_chk'])
  })
})
