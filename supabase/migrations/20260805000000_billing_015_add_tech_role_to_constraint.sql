-- billing_015_add_tech_role_to_constraint
-- The `tech` role was added to the app types + interfaces (Phase 0, billing_014) but never
-- to the user_profiles role CHECK constraint, so creating a tech profile fails with
-- "user_profiles_role_check". Same class of gap that previously hit sales/office_team.
-- Add `tech` so field technicians can have accounts.

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN (
    'admin',
    'executive',
    'district_manager',
    'branch_manager',
    'ar_manager',
    'ar_team',
    'office_team',
    'project_manager',
    'sales',
    'tech'
  ));
