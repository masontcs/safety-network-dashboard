-- Staging table for transactions belonging to confirmed employees but unconfirmed
-- payroll items. When a payroll import encounters an item name not yet in the
-- system, the transaction is held here instead of being inserted with a null or
-- mis-grouped item_id. On item confirmation in the review queue, staged rows are
-- automatically moved into payroll_transactions.

CREATE TABLE payroll_item_staged_transactions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  payroll_item_id uuid NOT NULL REFERENCES payroll_items(id) ON DELETE CASCADE,
  import_id       uuid NOT NULL,
  employee_id     uuid NOT NULL,
  entity_id       uuid NOT NULL,
  payroll_code_id uuid NOT NULL,
  period_date     date NOT NULL,
  hours           numeric(8,3),
  rate            numeric(10,4),
  amount          numeric(12,2) NOT NULL
);

CREATE INDEX idx_pist_item ON payroll_item_staged_transactions(payroll_item_id);

-- RLS: admin only via service role. No direct client access permitted.
ALTER TABLE payroll_item_staged_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_item_staged" ON payroll_item_staged_transactions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );
