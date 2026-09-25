import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped wh_payroll migration. The file in this repo IS the SQL applied to the
 * live database with the sanctioned flow (`supabase db push`, via apply-wh-payroll-migration
 * .command, whose md5 gate refuses to apply anything else). Editing an applied migration is what
 * caused the 2026-09-10 drift, so this pins its md5 and re-asserts the rules the app depends on.
 * To change the schema, add a NEW migration — don't touch this file.
 *
 * Its behaviour was run against a scratch PostgreSQL 16 before shipping: the two tables and the
 * function apply cleanly; a period's employee_count and four totals are summed server-side from
 * the rows that landed; re-importing the same (period_start, period_end) replaces just that
 * period and leaves every other one alone; a different period accumulates alongside; deleting a
 * period cascades its lines; BAD_LINES / NO_LINES / BAD_DATES are raised as specified; positive
 * taxes, a name that kept its '*', a duplicated employee within a period and a duplicated period
 * are all refused by constraint; and anon and authenticated are refused outright ("permission
 * denied for table wh_payroll_periods") rather than merely policy-less.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = 'ee951437c2eccb5a59b9ca363b0a81b7'
const NAME = 'wh_payroll'

const files = readdirSync(DIR).filter((f) => f.endsWith(`_${NAME}.sql`))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''
/**
 * The SQL with its `--` commentary removed. The comments deliberately DISCUSS the A/R and A/P
 * snapshot tables and their is_current column, to explain why payroll does not work that way —
 * so the "touches nothing else" assertions below read the statements, not the prose. The
 * `comment on …` statements are documentation too and are dropped for the same reason.
 */
const code = sql
  .replace(/--.*$/gm, '')
  .replace(/^comment on [\s\S]*?';$/gm, '')

describe('wh_payroll migration', () => {
  it('is exactly one file, at a single applied version, byte-identical to what was verified', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(new RegExp(`^\\d{14}_${NAME}\\.sql$`))
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('sorts after WH Phase 1 and the access allow-list it is gated by', () => {
    for (const earlier of ['_wh_ar_ap.sql', '_wh_access.sql']) {
      const prior = readdirSync(DIR).filter((f) => f.endsWith(earlier))
      expect(prior, earlier).toHaveLength(1)
      expect(files[0] > prior[0], `${files[0]} must sort after ${prior[0]}`).toBe(true)
    }
  })

  it('keeps the service-role-only posture on both tables: RLS on, no policies, anon+authenticated revoked', () => {
    for (const t of ['wh_payroll_periods', 'wh_payroll_lines']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`)
      expect(sql).toContain(`revoke all on table public.${t} from anon, authenticated;`)
    }
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).not.toMatch(/grant .* on table public\.wh_payroll/i)
  })

  it('has the columns the phase specified', () => {
    expect(sql).toMatch(/period_start\s+date not null/)
    expect(sql).toMatch(/period_end\s+date not null/)
    expect(sql).toMatch(/source_filename\s+text/)
    expect(sql).toMatch(/employee_count\s+int not null/)
    expect(sql).toMatch(/total_hours\s+numeric not null/)
    expect(sql).toMatch(/gross_total_cents\s+bigint not null/)
    expect(sql).toMatch(/taxes_total_cents\s+bigint not null/)
    expect(sql).toMatch(/net_total_cents\s+bigint not null/)
    expect(sql).toMatch(/imported_by\s+uuid references public\.user_profiles\(id\) on delete set null/)
    expect(sql).toMatch(/imported_at\s+timestamptz not null default now\(\)/)

    expect(sql).toMatch(/period_id\s+uuid not null references public\.wh_payroll_periods\(id\) on delete cascade/)
    expect(sql).toMatch(/employee_name text not null/)
    expect(sql).toMatch(/is_active\s+boolean not null/)
    expect(sql).toMatch(/hours\s+numeric not null/)
    expect(sql).toMatch(/gross_cents\s+bigint not null/)
    expect(sql).toMatch(/taxes_cents\s+bigint not null/)
    expect(sql).toMatch(/net_cents\s+bigint not null/)
    expect(sql).toMatch(/detail\s+jsonb/)
    expect(sql).toMatch(/created_at\s+timestamptz not null default now\(\)/)
  })

  it('accumulates periods: keyed on (period_start, period_end), with NO is_current column', () => {
    expect(sql).toContain('unique (period_start, period_end)')
    // The A/R / A/P single-snapshot machinery must not have been copied across.
    expect(code).not.toMatch(/is_current/)
    expect(code).not.toMatch(/one_current_idx/)
  })

  it('indexes period_id, employee_name and the imported_by foreign key', () => {
    expect(sql).toContain('create index wh_payroll_lines_period_idx on public.wh_payroll_lines (period_id);')
    expect(sql).toContain('create index wh_payroll_lines_employee_idx on public.wh_payroll_lines (employee_name);')
    expect(sql).toContain('create index wh_payroll_periods_imported_by_idx on public.wh_payroll_periods (imported_by);')
  })

  it('enforces the taxes sign it chose, so a period can never sum withholding the wrong way', () => {
    expect(sql).toMatch(/check \(taxes_cents <= 0/)
    expect(sql).toMatch(/check \(taxes_total_cents <= 0\)/)
  })

  it("never lets the report's '*' survive into a stored employee name", () => {
    expect(sql).toMatch(/employee_name not like '\*%'/)
  })

  it('keeps one row per employee per period, so the period totals cannot double-count', () => {
    expect(sql).toContain('unique (period_id, employee_name)')
  })

  it('replaces a period in one transaction, under an advisory lock, deleting only that period', () => {
    const fn = /create function public\.wh_payroll_replace_period[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? ''
    expect(fn).toBeTruthy()
    expect(fn).toContain('pg_advisory_xact_lock')
    // Scoped to the period, so two different periods never block one another.
    expect(fn).toMatch(/pg_advisory_xact_lock\(\s*\n?\s*hashtext\('wh_payroll_replace_period'\)/)
    // The delete must be narrowed to THIS period — an unqualified delete would wipe the history.
    const del = /delete from public\.wh_payroll_periods[\s\S]*?;/.exec(fn)?.[0] ?? ''
    expect(del).toContain('where period_start = p_period_start')
    expect(del).toContain('and period_end = p_period_end')
    expect(fn).toMatch(/raise exception 'BAD_LINES'/)
    expect(fn).toMatch(/raise exception 'NO_LINES'/)
    expect(fn).toMatch(/raise exception 'BAD_DATES'/)
  })

  it('derives the period totals server-side rather than trusting the caller', () => {
    const fn = /create function public\.wh_payroll_replace_period[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? ''
    // The insert supplies no figures…
    expect(fn).toContain('(period_start, period_end, source_filename, imported_by)')
    // …they are summed from the rows that landed.
    expect(fn).toMatch(/update public\.wh_payroll_periods[\s\S]*?count\(\*\)[\s\S]*?sum\(hours\)[\s\S]*?sum\(gross_cents\)[\s\S]*?sum\(taxes_cents\)[\s\S]*?sum\(net_cents\)/)
    for (const p of ['p_employee_count', 'p_total_hours', 'p_gross_total_cents', 'p_taxes_total_cents', 'p_net_total_cents']) {
      expect(fn, `${p} must not be a parameter — totals are derived`).not.toContain(p)
    }
  })

  it('is security invoker with an empty search_path, executable by service_role only', () => {
    expect(sql).toContain('security invoker')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toContain('revoke all on function public.wh_payroll_replace_period(uuid, text, date, date, jsonb) from public, anon, authenticated;')
    expect(sql).toContain('grant execute on function public.wh_payroll_replace_period(uuid, text, date, date, jsonb) to service_role;')
    expect(sql).not.toMatch(/security definer/i)
  })

  it('creates only the two payroll objects, seeds nothing, and touches nothing else', () => {
    expect(code).not.toMatch(/^\s*insert\s+into\s+public\.(?!wh_payroll)/im)
    expect(code).not.toMatch(/alter table public\.(?!wh_payroll)/i)
    expect(code).not.toMatch(/^\s*drop\s/im)
    expect(code).not.toMatch(/create table public\.(?!wh_payroll)/i)
    // No WH A/R or A/P object, no SN table, and no revenue table (that is Phase 3).
    expect(code).not.toMatch(/wh_(ar|ap)_(imports|lines)/)
    expect(code).not.toMatch(/wh_revenue/)
    expect(code).not.toMatch(/wh_ar_replace_import|wh_ap_replace_import|wh_is_intercompany/)
    // wh_access is only mentioned in a comment about where access is decided, never touched.
    expect(code).not.toMatch(/public\.wh_access/i)
  })

  it('creates exactly the two tables and the one function', () => {
    expect(sql.match(/^create table /gm)).toHaveLength(2)
    expect(sql.match(/^create function /gm)).toHaveLength(1)
  })
})
