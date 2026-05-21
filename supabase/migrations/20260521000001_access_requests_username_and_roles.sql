-- Fix access_requests table:
-- 1. Add missing username column (API inserts it but column never existed)
-- 2. Expand requested_role constraint to include all valid roles

ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE access_requests
  DROP CONSTRAINT IF EXISTS access_requests_requested_role_check;

ALTER TABLE access_requests
  ADD CONSTRAINT access_requests_requested_role_check
  CHECK (requested_role IN (
    'branch_manager', 'district_manager', 'executive',
    'ar_manager', 'ar_team', 'office_team', 'project_manager', 'sales'
  ));
