-- Add is_excluded flag to ar_customers
ALTER TABLE ar_customers ADD COLUMN IF NOT EXISTS is_excluded boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────
-- INC class codes
-- ─────────────────────────────────────────────

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'INC-BF', b.id, 'INC' FROM branches b WHERE b.name = 'Bakersfield' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'INC-FR', b.id, 'INC' FROM branches b WHERE b.name = 'Fresno' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'INC-MO', b.id, 'INC' FROM branches b WHERE b.name = 'Modesto' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

-- Sacramento merged into Modesto (no separate Sacramento branch)
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'INC-SAC', b.id, 'INC' FROM branches b WHERE b.name = 'Modesto' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'INC-OC', b.id, 'INC' FROM branches b WHERE b.name = 'Orange County' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'INC-VI', b.id, 'INC' FROM branches b WHERE b.name = 'Visalia' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'INC-ARR', b.id, 'INC' FROM branches b WHERE b.name = 'Arroyo Grande' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

-- Separate company — no branch; customers auto-excluded below
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  VALUES ('INC-CNST', NULL, 'INC')
  ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- STS class codes
-- ─────────────────────────────────────────────

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'STBOP', b.id, 'STS' FROM branches b WHERE b.name = 'Bakersfield' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'STOOP', b.id, 'STS' FROM branches b WHERE b.name = 'Orange County' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'STAOP', b.id, 'STS' FROM branches b WHERE b.name = 'Arroyo Grande' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'STMOP', b.id, 'STS' FROM branches b WHERE b.name = 'Modesto' LIMIT 1
  ON CONFLICT (code) DO NOTHING;

-- Signs division — no branch; customers auto-excluded below
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  VALUES ('SGN-FRM', NULL, 'STS')
  ON CONFLICT (code) DO NOTHING;

-- TCP: tracked but not tied to any branch
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  VALUES ('TCP', NULL, 'STS')
  ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- Backfill branch_id on existing invoices
-- (applies retroactively to already-imported data)
-- ─────────────────────────────────────────────

UPDATE ar_invoices ai
SET branch_id = cc.branch_id
FROM ar_class_codes cc
WHERE ai.raw_class_code = cc.code
  AND ai.branch_id IS NULL
  AND cc.branch_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- Auto-exclude customers for separate companies
-- INC-CNST = separate construction company
-- SGN-FRM  = Signs Fabrication division
-- ─────────────────────────────────────────────

UPDATE ar_customers
SET is_excluded = true
WHERE id IN (
  SELECT DISTINCT customer_id
  FROM ar_invoices
  WHERE raw_class_code IN ('INC-CNST', 'SGN-FRM')
);
