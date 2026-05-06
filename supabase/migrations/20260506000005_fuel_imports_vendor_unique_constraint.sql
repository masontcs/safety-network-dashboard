-- Fix duplicate check: uniqueness for fuel_imports must include vendor.
-- Interstate and Flyers cover the same dates independently and must both be importable.

-- Drop old constraint if it was ever added without vendor (safety net)
ALTER TABLE fuel_imports DROP CONSTRAINT IF EXISTS fuel_imports_date_range_start_date_range_end_key;

-- Add correct constraint scoped to vendor
ALTER TABLE fuel_imports ADD CONSTRAINT fuel_imports_vendor_date_range_unique
  UNIQUE (vendor, date_range_start, date_range_end);
