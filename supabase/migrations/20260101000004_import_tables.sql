-- Import Header Tables
-- payroll_imports, revenue_imports, fuel_imports

-- One row per (entity, period_date) — duplicate check key
CREATE TABLE payroll_imports (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id    uuid        NOT NULL REFERENCES entities(id),
  period_date  date        NOT NULL,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  imported_by  uuid        NOT NULL REFERENCES user_profiles(id),
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','confirmed','replaced')),
  UNIQUE (entity_id, period_date)
);

-- One revenue file covers all entities for a period
CREATE TABLE revenue_imports (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  period_date  date        NOT NULL UNIQUE,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  imported_by  uuid        NOT NULL REFERENCES user_profiles(id),
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','confirmed','replaced'))
);

-- Fuel imports are per-vendor; date range is derived from the file's transactions
CREATE TABLE fuel_imports (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor            text        NOT NULL CHECK (vendor IN ('interstate','flyers')),
  date_range_start  date        NOT NULL,
  date_range_end    date        NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  imported_by       uuid        NOT NULL REFERENCES user_profiles(id),
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','confirmed','replaced'))
);

-- Indexes for duplicate-check queries
CREATE INDEX idx_payroll_imports_entity_period ON payroll_imports(entity_id, period_date);
CREATE INDEX idx_payroll_imports_status ON payroll_imports(status);
CREATE INDEX idx_revenue_imports_period ON revenue_imports(period_date);
CREATE INDEX idx_fuel_imports_vendor_range ON fuel_imports(vendor, date_range_end);
