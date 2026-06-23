-- 2026-06-18
-- Executive/admin payroll-COST breakdown for a date range, company-wide:
--   Gross wages  = all earnings groups (everything that isn't Fringes/Other)
--   Fringes      = the "Fringes" item group (employer prevailing-wage/union contributions)
--   Other        = the "Other" item group (ER-paid benefits, travel time, allowances, etc.)
--   Employer Tax = the payroll_taxes table (employer FICA/FUTA/SUTA/WC burden)
-- NOTE: there are no employee-side withholdings in the imported data — this is the
-- company's payroll cost composition, not paycheck deductions.
create or replace function payroll_group_breakdown(p_start date, p_end date)
returns table(gross numeric, fringes numeric, other numeric, employer_tax numeric)
language sql
stable
as $$
  select
    coalesce(sum(pt.amount) filter (
      where pig.name is distinct from 'Fringes' and pig.name is distinct from 'Other'
    ), 0) as gross,
    coalesce(sum(pt.amount) filter (where pig.name = 'Fringes'), 0) as fringes,
    coalesce(sum(pt.amount) filter (where pig.name = 'Other'), 0) as other,
    (select coalesce(sum(amount), 0)
       from payroll_taxes tx
      where tx.period_date between p_start and p_end
        and tx.business_tag is null) as employer_tax
  from payroll_transactions pt
  left join payroll_items pi on pi.id = pt.payroll_item_id
  left join payroll_item_groups pig on pig.id = pi.group_id
  where pt.period_date between p_start and p_end
    and pt.business_tag is null;
$$;
