-- Add business_tag to employee_entity_assignments.
-- When set, the employee belongs to Signs or Western Highways and is excluded
-- from all Safety Network payroll reports. is_confirmed is set to true so they
-- do not appear in the review queue again on future imports.

ALTER TABLE employee_entity_assignments
  ADD COLUMN IF NOT EXISTS business_tag text
    CHECK (business_tag IN ('western_highways', 'signs'));
