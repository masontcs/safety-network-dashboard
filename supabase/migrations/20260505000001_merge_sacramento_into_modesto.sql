-- Merge Sacramento into Modesto
-- Effective: 2026-05-05
-- Sacramento is absorbed by Modesto. All historical data is reassigned.
-- Sacramento is deactivated, not deleted, to preserve referential integrity and audit history.

-- 1. Add is_active to branches (idempotent)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Reassign payroll_transactions: Sacramento payroll codes → Modesto equivalent (same entity + labor_type)
UPDATE payroll_transactions SET payroll_code_id = (
  SELECT pc_mod.id FROM payroll_codes pc_sac
  JOIN payroll_codes pc_mod ON pc_mod.entity_id = pc_sac.entity_id
    AND pc_mod.labor_type = pc_sac.labor_type
  JOIN branches b_mod ON b_mod.id = pc_mod.branch_id AND b_mod.name = 'Modesto'
  WHERE pc_sac.id = payroll_transactions.payroll_code_id
    AND pc_sac.branch_id = (SELECT id FROM branches WHERE name = 'Sacramento')
) WHERE payroll_code_id IN (
  SELECT id FROM payroll_codes WHERE branch_id = (SELECT id FROM branches WHERE name = 'Sacramento')
);

-- 3. Reassign revenue_transactions
UPDATE revenue_transactions
SET branch_id = (SELECT id FROM branches WHERE name = 'Modesto')
WHERE branch_id = (SELECT id FROM branches WHERE name = 'Sacramento');

-- 4. Reassign fuel_transactions
UPDATE fuel_transactions
SET branch_id = (SELECT id FROM branches WHERE name = 'Modesto')
WHERE branch_id = (SELECT id FROM branches WHERE name = 'Sacramento');

-- 5. Reassign employee_entity_assignments: Sacramento payroll codes → Modesto equivalents
UPDATE employee_entity_assignments SET payroll_code_id = (
  SELECT pc_mod.id FROM payroll_codes pc_sac
  JOIN payroll_codes pc_mod ON pc_mod.entity_id = pc_sac.entity_id
    AND pc_mod.labor_type = pc_sac.labor_type
  JOIN branches b_mod ON b_mod.id = pc_mod.branch_id AND b_mod.name = 'Modesto'
  WHERE pc_sac.id = employee_entity_assignments.payroll_code_id
    AND pc_sac.branch_id = (SELECT id FROM branches WHERE name = 'Sacramento')
) WHERE payroll_code_id IN (
  SELECT id FROM payroll_codes WHERE branch_id = (SELECT id FROM branches WHERE name = 'Sacramento')
);

-- 6. Reassign user_branch_assignments
UPDATE user_branch_assignments
SET branch_id = (SELECT id FROM branches WHERE name = 'Modesto')
WHERE branch_id = (SELECT id FROM branches WHERE name = 'Sacramento');

-- 7. Reassign branch_targets
--    Drop Sacramento targets that would conflict with an existing Modesto target for the same period.
--    (Modesto target wins on conflict; non-conflicting Sacramento targets are reassigned.)
DELETE FROM branch_targets
WHERE branch_id = (SELECT id FROM branches WHERE name = 'Sacramento')
  AND (period_type, target_date) IN (
    SELECT period_type, target_date
    FROM branch_targets
    WHERE branch_id = (SELECT id FROM branches WHERE name = 'Modesto')
  );

UPDATE branch_targets
SET branch_id = (SELECT id FROM branches WHERE name = 'Modesto')
WHERE branch_id = (SELECT id FROM branches WHERE name = 'Sacramento');

-- 8. Deactivate Sacramento's payroll_codes and revenue_codes to prevent use in future imports
UPDATE payroll_codes SET is_active = false
WHERE branch_id = (SELECT id FROM branches WHERE name = 'Sacramento');

UPDATE revenue_codes SET is_active = false
WHERE branch_id = (SELECT id FROM branches WHERE name = 'Sacramento');

-- 9. Deactivate Sacramento branch
UPDATE branches
SET is_active = false, is_revenue_generating = false
WHERE name = 'Sacramento';
