-- Row Level Security Policies
-- Enable RLS on every table, then define policies.
-- Three layers of security: middleware (route) + RLS (DB) + API checks (application).
-- RLS is the safety net — bugs in one layer don't compromise the other.

-- ─────────────────────────────────────────────
-- Helper: avoid recursive RLS on user_profiles
-- SECURITY DEFINER bypasses RLS when called internally
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid()
$$;

-- ─────────────────────────────────────────────
-- Enable RLS
-- ─────────────────────────────────────────────
ALTER TABLE businesses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_item_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_codes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_codes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branch_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees                ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_entity_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_card_assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_imports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_imports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_imports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_taxes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_transactions        ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- Reference tables: all authenticated users read; admin write
-- ─────────────────────────────────────────────
CREATE POLICY "authenticated_read" ON businesses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON businesses
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON entities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON entities
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON branches
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON branches
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON payroll_item_groups
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON payroll_item_groups
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON payroll_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON payroll_items
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON payroll_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON payroll_codes
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON revenue_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON revenue_codes
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- user_profiles: own profile always visible; admin sees all
-- Uses current_user_role() to avoid recursive policy evaluation
-- ─────────────────────────────────────────────
CREATE POLICY "own_profile_read" ON user_profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "admin_read_all" ON user_profiles
  FOR SELECT TO authenticated USING (current_user_role() = 'admin');

CREATE POLICY "admin_write" ON user_profiles
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- user_branch_assignments: users see own; admin manages all
-- ─────────────────────────────────────────────
CREATE POLICY "own_assignments_read" ON user_branch_assignments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "admin_write" ON user_branch_assignments
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- employees + employee_entity_assignments: all authenticated read; admin write
-- API routes handle fine-grained branch scoping on top of this
-- ─────────────────────────────────────────────
CREATE POLICY "authenticated_read" ON employees
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON employees
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON employee_entity_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON employee_entity_assignments
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- fuel_card_assignments: all authenticated read; admin write
-- ─────────────────────────────────────────────
CREATE POLICY "authenticated_read" ON fuel_card_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON fuel_card_assignments
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- Import tables: admin only (all operations)
-- ─────────────────────────────────────────────
CREATE POLICY "admin_only" ON payroll_imports
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "admin_only" ON revenue_imports
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "admin_only" ON fuel_imports
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- payroll_transactions — THREE-POLICY PATTERN
-- Managers see direct labor for their assigned branches only.
-- Admin payroll detail (admin_hourly, admin_salary) is NEVER visible to managers —
-- the API returns a lump sum instead, and this policy enforces the DB-level block.
-- ─────────────────────────────────────────────
CREATE POLICY "managers_direct_only" ON payroll_transactions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM user_profiles up
      JOIN user_branch_assignments uba ON uba.user_id = up.id
      JOIN payroll_codes pc ON pc.id = payroll_transactions.payroll_code_id
      WHERE up.id = auth.uid()
        AND up.role IN ('district_manager','branch_manager')
        AND uba.branch_id = pc.branch_id
        AND pc.labor_type = 'direct'
    )
  );

CREATE POLICY "admin_exec_full" ON payroll_transactions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin','executive')
    )
  );

CREATE POLICY "admin_write" ON payroll_transactions
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- payroll_taxes — managers see taxes for direct labor in their branches
-- Joins through employee_entity_assignments to find the payroll_code's branch
-- ─────────────────────────────────────────────
CREATE POLICY "managers_direct_taxes" ON payroll_taxes
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM user_profiles up
      JOIN user_branch_assignments uba ON uba.user_id = up.id
      JOIN employee_entity_assignments eea ON eea.employee_id = payroll_taxes.employee_id
        AND eea.entity_id = payroll_taxes.entity_id
      JOIN payroll_codes pc ON pc.id = eea.payroll_code_id
      WHERE up.id = auth.uid()
        AND up.role IN ('district_manager','branch_manager')
        AND uba.branch_id = pc.branch_id
        AND pc.labor_type = 'direct'
    )
  );

CREATE POLICY "admin_exec_full" ON payroll_taxes
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin','executive')
    )
  );

CREATE POLICY "admin_write" ON payroll_taxes
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- revenue_transactions — managers see their assigned branches only
-- ─────────────────────────────────────────────
CREATE POLICY "managers_own_branches" ON revenue_transactions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM user_profiles up
      JOIN user_branch_assignments uba ON uba.user_id = up.id
      WHERE up.id = auth.uid()
        AND up.role IN ('district_manager','branch_manager')
        AND uba.branch_id = revenue_transactions.branch_id
    )
  );

CREATE POLICY "admin_exec_full" ON revenue_transactions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin','executive')
    )
  );

CREATE POLICY "admin_write" ON revenue_transactions
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─────────────────────────────────────────────
-- fuel_transactions — managers see SN fuel for their branches only
-- business_tag IS NULL means Safety Network (untagged)
-- ─────────────────────────────────────────────
CREATE POLICY "managers_own_branches_sn" ON fuel_transactions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM user_profiles up
      JOIN user_branch_assignments uba ON uba.user_id = up.id
      WHERE up.id = auth.uid()
        AND up.role IN ('district_manager','branch_manager')
        AND uba.branch_id = fuel_transactions.branch_id
        AND fuel_transactions.business_tag IS NULL
    )
  );

CREATE POLICY "admin_exec_full" ON fuel_transactions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin','executive')
    )
  );

CREATE POLICY "admin_write" ON fuel_transactions
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
