-- Western Highways (WH) · Phase 2 · QuickBooks ONLINE "Payroll summary by employee"
--
-- WH pay periods, kept as HISTORY. This is the one place the WH schema deliberately departs
-- from the A/R and A/P snapshot model shipped in Phase 1:
--
--   • A/R and A/P are a POSITION — only "now" means anything, so each import replaces the one
--     current snapshot (wh_ar_imports.is_current).
--   • Payroll is a SERIES — every pay period stands on its own and the point of the dashboard
--     is watching the periods change week over week. So there is no is_current column here.
--     Each period is keyed on (period_start, period_end) and ACCUMULATES alongside the others;
--     re-importing the same period replaces just that period's rows and leaves every other
--     period untouched.
--
-- The QBO report is a MATRIX, not a list: employees are COLUMNS, and the rows are labelled
-- items ("Hours - total", "Gross pay - total", "Employee taxes - Medicare", …). lib/wh/payroll-
-- import.ts transposes it into one row per employee, which is what lands in wh_payroll_lines.
--
--   wh_payroll_periods  — one row per imported pay period: its two dates, which file, how many
--                         employees, and the four period totals. All of them are derived from
--                         the lines BY THIS MIGRATION'S FUNCTION rather than trusted from the
--                         app, exactly as the Phase 1 functions do.
--   wh_payroll_lines    — one row per employee per period: hours, gross, employee taxes, net,
--                         the active flag, and the report's full per-employee item breakdown
--                         in `detail` so later questions ("how much overtime?", "what was
--                         withheld for CA SDI?") need no re-import.
--
-- Money is integer cents throughout. Employee taxes are stored SIGNED — negative, the way the
-- report writes them — and a check constraint holds them there, so a future caller cannot
-- quietly switch to absolute values and make a period's taxes add to the wrong sign.
--
-- Net is NOT gross − taxes: the report's own net is `Adjusted gross − |Employee taxes|`, and
-- adjusted gross is below gross whenever an employee has a pretax deduction (five of the
-- sixteen on the real file do). Net therefore arrives as its own figure, with adjusted gross
-- kept in `detail` beside it. On the real file this reproduces QuickBooks' own "Net pay" row
-- for all sixteen employees, which is how the parser's derivation is verified.
--
-- Nothing is seeded. Revenue is WH Phase 3 and is not created here. No Safety Network table
-- and no WH A/R or A/P object is read or changed.
--
-- Service-role only, like every billing_*, cmr_* and wh_* object: RLS on with NO policies, the
-- default anon/authenticated privileges revoked, and the function executable by service_role
-- alone. Access to the data is decided in the app by the wh_access grant (lib/wh/access.ts).

-- ── 1. the periods ──────────────────────────────────────────────────────────
create table public.wh_payroll_periods (
  id                 uuid primary key default gen_random_uuid(),
  -- Read from the report's period line ("From Sep 13, 2026 to Sep 19, 2026 for all employees
  -- from all locations"). Both are required: an undated pay period cannot be placed in a series.
  period_start       date not null,
  period_end         date not null,
  source_filename    text,
  -- Everything below is derived from the lines by wh_payroll_replace_period.
  employee_count     int not null default 0,
  total_hours        numeric not null default 0,
  gross_total_cents  bigint not null default 0,
  -- Negative, like the lines it sums.
  taxes_total_cents  bigint not null default 0,
  net_total_cents    bigint not null default 0,
  imported_by        uuid references public.user_profiles(id) on delete set null,
  imported_at        timestamptz not null default now(),
  constraint wh_payroll_periods_order_chk
    check (period_end >= period_start),
  -- A QBO pay period is a week; a year of slack still catches a garbled date pair.
  constraint wh_payroll_periods_span_chk
    check (period_end - period_start <= 366),
  constraint wh_payroll_periods_filename_len
    check (source_filename is null or char_length(source_filename) between 1 and 255),
  constraint wh_payroll_periods_employee_count_chk
    check (employee_count >= 0),
  constraint wh_payroll_periods_hours_chk
    check (total_hours >= 0),
  constraint wh_payroll_periods_taxes_sign_chk
    check (taxes_total_cents <= 0),
  -- ONE row per pay period. This is what makes a re-import a replace rather than a duplicate,
  -- and it is the whole difference from the A/R / A/P single-snapshot model.
  constraint wh_payroll_periods_period_key
    unique (period_start, period_end)
);

comment on table public.wh_payroll_periods is
  'Western Highways: one row per imported pay period from the QBO "Payroll summary by employee" report. Periods ACCUMULATE — unlike wh_ar_imports / wh_ap_imports there is no is_current, and re-importing a period replaces only that period (wh_payroll_periods_period_key). Written only by wh_payroll_replace_period. Service-role only (RLS on, no policies).';
comment on column public.wh_payroll_periods.total_hours is
  'Σ of the lines'' hours. Derived by wh_payroll_replace_period, never taken from the caller.';
comment on column public.wh_payroll_periods.taxes_total_cents is
  'Σ of the lines'' employee taxes, in cents and NEGATIVE (the sign the report uses).';
comment on column public.wh_payroll_periods.net_total_cents is
  'Σ of the lines'' net pay, in cents — adjusted gross less withheld taxes, not gross less taxes.';

-- newest period first is the only ordering the views ever ask for
create index wh_payroll_periods_end_idx on public.wh_payroll_periods (period_end desc);
-- foreign key (performance advisor: unindexed_foreign_keys)
create index wh_payroll_periods_imported_by_idx on public.wh_payroll_periods (imported_by);

alter table public.wh_payroll_periods enable row level security;
revoke all on table public.wh_payroll_periods from anon, authenticated;

-- ── 2. the per-employee lines ───────────────────────────────────────────────
create table public.wh_payroll_lines (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references public.wh_payroll_periods(id) on delete cascade,
  -- "Last First [Middle]", exactly as the report spells it, with the leading '*' STRIPPED — the
  -- asterisk is a flag, not part of the name, and keeping it would split one person into two
  -- names across periods the moment they are terminated.
  employee_name text not null,
  -- False when the report marked the name with '*' (inactive / terminated in QuickBooks).
  is_active     boolean not null default true,
  hours         numeric not null default 0,
  gross_cents   bigint not null default 0,
  -- SIGNED: negative, as the report writes it. Enforced below.
  taxes_cents   bigint not null default 0,
  net_cents     bigint not null default 0,
  -- The whole per-employee column of the report: every non-blank item, keyed by its label —
  -- 'Hours - *' items as plain hours, everything else in cents, plus adjustedGrossCents. Kept
  -- so a later question about overtime or a particular withholding needs no re-import.
  detail        jsonb,
  created_at    timestamptz not null default now(),
  constraint wh_payroll_lines_name_len
    check (char_length(employee_name) between 1 and 200),
  -- The '*' is a flag and must never survive into the stored name.
  constraint wh_payroll_lines_name_clean_chk
    check (employee_name = btrim(employee_name) and employee_name not like '*%'),
  constraint wh_payroll_lines_hours_chk
    check (hours >= 0 and hours <= 2000),
  constraint wh_payroll_lines_gross_chk
    check (gross_cents between -99999999999 and 99999999999),
  constraint wh_payroll_lines_taxes_sign_chk
    check (taxes_cents <= 0 and taxes_cents >= -99999999999),
  constraint wh_payroll_lines_net_chk
    check (net_cents between -99999999999 and 99999999999),
  -- One row per employee per period: the period totals are sums of these rows, so a duplicated
  -- column in a future export must fail the import loudly rather than double-count a person.
  constraint wh_payroll_lines_employee_key
    unique (period_id, employee_name)
);

comment on table public.wh_payroll_lines is
  'Western Highways: one row per employee per pay period, transposed out of the QBO report''s employee COLUMNS. Money in cents; employee taxes negative. Service-role only (RLS on, no policies).';
comment on column public.wh_payroll_lines.is_active is
  'False when the report prefixed the employee''s name with ''*'' — inactive / terminated in QuickBooks. The asterisk itself is stripped from employee_name.';
comment on column public.wh_payroll_lines.net_cents is
  'The report''s net pay: adjusted gross less withheld employee taxes. NOT gross_cents + taxes_cents — the two differ for anyone with a pretax deduction.';
comment on column public.wh_payroll_lines.detail is
  'The employee''s full column from the report, keyed by item label: ''Hours - …'' as hours, every other item in cents, plus adjustedGrossCents.';

create index wh_payroll_lines_period_idx on public.wh_payroll_lines (period_id);
-- one employee across every period — the week-over-week question
create index wh_payroll_lines_employee_idx on public.wh_payroll_lines (employee_name);

alter table public.wh_payroll_lines enable row level security;
revoke all on table public.wh_payroll_lines from anon, authenticated;

-- ── 3. replacing ONE period (service role only) ─────────────────────────────
-- p_lines is a JSON array of objects with the keys
--   employee_name, is_active, hours, gross_cents, taxes_cents, net_cents, detail
-- exactly as lib/wh/payroll-import.ts produced them. The period's employee_count and its four
-- totals are NOT taken from the caller: they are summed here, from the rows that actually
-- landed, after the insert.
--
-- "Replace the period" means precisely that: the row with the same (period_start, period_end)
-- is deleted (its lines cascade) and rebuilt. EVERY OTHER PERIOD IS LEFT ALONE — that is the
-- accumulate-by-period behaviour, and it is why this function does not resemble
-- wh_ar_replace_import, which deletes whatever snapshot is current.
--
-- Race safety: the advisory lock is taken on the PERIOD, not on the table, so two uploads of
-- two different periods proceed in parallel while two uploads of the same period queue up and
-- exactly one of them survives.
--
-- Refusals (raised as the exception message, which the app maps to a response):
--   BAD_LINES — p_lines is not a JSON array
--   NO_LINES  — the array is empty (a period with no employees would delete the real one and
--               store nothing in its place)
--   BAD_DATES — the dates are missing or the period ends before it starts
--
-- Returns the new period's id.
create function public.wh_payroll_replace_period(
  p_actor           uuid,
  p_source_filename text,
  p_period_start    date,
  p_period_end      date,
  p_lines           jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_count     int;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'BAD_LINES' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_lines);
  if v_count = 0 then
    raise exception 'NO_LINES' using errcode = 'P0001';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'BAD_DATES' using errcode = 'P0001';
  end if;

  -- Serialise uploads OF THIS PERIOD only (see the note above).
  perform pg_advisory_xact_lock(
    hashtext('wh_payroll_replace_period'),
    hashtext(p_period_start::text || '|' || p_period_end::text)
  );

  -- Just this period. Its lines cascade; no other period is touched.
  delete from public.wh_payroll_periods
   where period_start = p_period_start
     and period_end = p_period_end;

  insert into public.wh_payroll_periods
    (period_start, period_end, source_filename, imported_by)
  values
    (p_period_start, p_period_end, nullif(btrim(p_source_filename), ''), p_actor)
  returning id into v_period_id;

  insert into public.wh_payroll_lines
    (period_id, employee_name, is_active, hours, gross_cents, taxes_cents, net_cents, detail)
  select v_period_id,
         l.employee_name,
         coalesce(l.is_active, true),
         coalesce(l.hours, 0),
         coalesce(l.gross_cents, 0),
         coalesce(l.taxes_cents, 0),
         coalesce(l.net_cents, 0),
         l.detail
    from jsonb_to_recordset(p_lines) as l(
           employee_name text,
           is_active     boolean,
           hours         numeric,
           gross_cents   bigint,
           taxes_cents   bigint,
           net_cents     bigint,
           detail        jsonb
         );

  -- The period's figures are the sum of the rows that landed, never the caller's arithmetic.
  update public.wh_payroll_periods p
     set employee_count    = s.employee_count,
         total_hours       = s.total_hours,
         gross_total_cents = s.gross_total_cents,
         taxes_total_cents = s.taxes_total_cents,
         net_total_cents   = s.net_total_cents
    from (
      select count(*)                            as employee_count,
             coalesce(sum(hours), 0)              as total_hours,
             coalesce(sum(gross_cents), 0)        as gross_total_cents,
             coalesce(sum(taxes_cents), 0)        as taxes_total_cents,
             coalesce(sum(net_cents), 0)          as net_total_cents
        from public.wh_payroll_lines
       where period_id = v_period_id
    ) s
   where p.id = v_period_id;

  return v_period_id;
end;
$$;

comment on function public.wh_payroll_replace_period(uuid, text, date, date, jsonb) is
  'Western Highways: replace ONE pay period in one transaction — lock that period, refuse a non-array (BAD_LINES), empty (NO_LINES) or undated (BAD_DATES) payload, delete the row with the same (period_start, period_end) if there is one (lines cascade), insert the period and its per-employee lines, then sum employee_count and the four totals from the rows that landed. Every other period is left untouched, so periods accumulate. Returns the new wh_payroll_periods id. Service-role only.';

revoke all on function public.wh_payroll_replace_period(uuid, text, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.wh_payroll_replace_period(uuid, text, date, date, jsonb) to service_role;
