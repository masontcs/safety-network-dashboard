-- Transaction Tables
-- payroll_transactions, payroll_taxes, revenue_transactions, fuel_transactions
-- Cascade-delete from their parent import row (used during replace-import flow).

CREATE TABLE payroll_transactions (
  id               uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id        uuid         NOT NULL REFERENCES payroll_imports(id) ON DELETE CASCADE,
  employee_id      uuid         NOT NULL REFERENCES employees(id),
  entity_id        uuid         NOT NULL REFERENCES entities(id),
  payroll_code_id  uuid         NOT NULL REFERENCES payroll_codes(id),
  period_date      date         NOT NULL,
  payroll_item_id  uuid         REFERENCES payroll_items(id),
  hours            numeric(8,3),
  rate             numeric(10,4),
  amount           numeric(12,2) NOT NULL
);

CREATE TABLE payroll_taxes (
  id           uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id    uuid         NOT NULL REFERENCES payroll_imports(id) ON DELETE CASCADE,
  employee_id  uuid         NOT NULL REFERENCES employees(id),
  entity_id    uuid         NOT NULL REFERENCES entities(id),
  period_date  date         NOT NULL,
  amount       numeric(12,2) NOT NULL
);

-- total_revenue = labor + rental + one_time_charges (sales_tax stored separately, never summed in)
CREATE TABLE revenue_transactions (
  id               uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id        uuid         NOT NULL REFERENCES revenue_imports(id) ON DELETE CASCADE,
  revenue_code_id  uuid         REFERENCES revenue_codes(id),
  branch_id        uuid         NOT NULL REFERENCES branches(id),
  entity_id        uuid         NOT NULL REFERENCES entities(id),
  period_date      date         NOT NULL,
  labor            numeric(12,2) NOT NULL DEFAULT 0,
  rental           numeric(12,2) NOT NULL DEFAULT 0,
  one_time_charges numeric(12,2) NOT NULL DEFAULT 0,
  sales_tax        numeric(12,2) NOT NULL DEFAULT 0,
  total_revenue    numeric(12,2) NOT NULL DEFAULT 0
);

-- business_tag NULL = Safety Network; 'western_highways' or 'signs' = tagged, excluded from SN dashboards
CREATE TABLE fuel_transactions (
  id                      uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id               uuid         NOT NULL REFERENCES fuel_imports(id) ON DELETE CASCADE,
  fuel_card_assignment_id uuid         REFERENCES fuel_card_assignments(id),
  branch_id               uuid         REFERENCES branches(id),
  employee_id             uuid         REFERENCES employees(id),
  business_tag            text         CHECK (business_tag IN ('western_highways','signs')),
  vendor                  text         NOT NULL CHECK (vendor IN ('interstate','flyers')),
  transaction_date        date         NOT NULL,
  transaction_time        text,
  site_name               text,
  site_city               text,
  site_state              text,
  product                 text,
  gallons                 numeric(8,3),
  price_per_gallon        numeric(10,4),
  total_pretax            numeric(12,2),
  tax                     numeric(12,2),
  total_with_tax          numeric(12,2) NOT NULL
);

-- Query-pattern indexes
CREATE INDEX idx_pt_period_entity ON payroll_transactions(period_date, entity_id);
CREATE INDEX idx_pt_employee_id ON payroll_transactions(employee_id);
CREATE INDEX idx_pt_payroll_code_id ON payroll_transactions(payroll_code_id);
CREATE INDEX idx_pt_import_id ON payroll_transactions(import_id);

CREATE INDEX idx_ptax_period_entity ON payroll_taxes(period_date, entity_id);
CREATE INDEX idx_ptax_employee_id ON payroll_taxes(employee_id);
CREATE INDEX idx_ptax_import_id ON payroll_taxes(import_id);

CREATE INDEX idx_rt_period_branch ON revenue_transactions(period_date, branch_id);
CREATE INDEX idx_rt_entity_id ON revenue_transactions(entity_id);
CREATE INDEX idx_rt_import_id ON revenue_transactions(import_id);

CREATE INDEX idx_ft_transaction_date ON fuel_transactions(transaction_date);
CREATE INDEX idx_ft_branch_id ON fuel_transactions(branch_id);
CREATE INDEX idx_ft_business_tag ON fuel_transactions(business_tag);
CREATE INDEX idx_ft_import_id ON fuel_transactions(import_id);
