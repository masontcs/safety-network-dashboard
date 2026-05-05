-- User / Access Tables
-- user_profiles, user_branch_assignments

-- Mirrors auth.users — one row per authenticated user
CREATE TABLE user_profiles (
  id           uuid  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text  NOT NULL CHECK (role IN ('admin','executive','district_manager','branch_manager')),
  display_name text  NOT NULL DEFAULT ''
);

-- admin/executive rows have no entries here (branchIds = null = all access)
-- district_manager rows have 2+ entries; branch_manager rows have exactly 1
CREATE TABLE user_branch_assignments (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  UNIQUE (user_id, branch_id)
);

-- Index for fast branch-access lookups in RLS policies
CREATE INDEX idx_user_branch_assignments_user_id ON user_branch_assignments(user_id);
CREATE INDEX idx_user_branch_assignments_branch_id ON user_branch_assignments(branch_id);
