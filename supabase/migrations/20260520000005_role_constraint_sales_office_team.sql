-- Update user_profiles role CHECK constraint to include sales and office_team roles
-- Added in code but never added to the DB constraint, causing insert failures.

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
    'sales'
  ));
