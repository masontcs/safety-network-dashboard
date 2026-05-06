-- Backfill branch_id, employee_id, and business_tag on fuel_transactions
-- for all cards that were confirmed in the review queue AFTER the transactions
-- were imported. Only touches rows that still have a NULL branch_id.
UPDATE fuel_transactions ft
SET
    branch_id    = fca.branch_id,
    employee_id  = fca.employee_id,
    business_tag = COALESCE(ft.business_tag, fca.business_tag)
FROM fuel_card_assignments fca
WHERE ft.fuel_card_assignment_id = fca.id
  AND fca.is_confirmed = true
  AND ft.branch_id IS NULL;
