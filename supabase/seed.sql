-- Seed Data — Safety Network Operations Dashboard
-- Idempotent: safe to run multiple times on a fresh or existing DB.
-- Sources: Payroll_Codes_-_Sheet2.csv, payroll-item-mappings.csv

-- ─────────────────────────────────────────────
-- BUSINESSES (3)
-- hq_allocation_pct: fraction of HQ payroll allocated to this business
-- ─────────────────────────────────────────────
INSERT INTO businesses (name, code, is_active, hq_allocation_pct) VALUES
  ('Safety Network',   'SN',    true, 0.7813),
  ('Western Highways', 'WH',    true, 0.1852),
  ('Signs',            'SIGNS', true, 0.0335)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- ENTITIES (3)
-- ─────────────────────────────────────────────
INSERT INTO entities (name, code) VALUES
  ('Safety Network Inc', 'INC'),
  ('Safety Network TCS', 'TCS'),
  ('Safety Network STS', 'STS')
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- BRANCHES
-- 7 SN revenue-generating + 2 SN corporate (Corp - Fresno, Corp - Bakersfield)
-- WH/Signs branches not seeded for V1 (no dashboards).
-- ─────────────────────────────────────────────
INSERT INTO branches (name, business_id, is_revenue_generating, is_corporate)
SELECT b.name, bus.id, b.is_revenue_generating, b.is_corporate
FROM (VALUES
  ('Arroyo Grande',    'SN', true,  false),
  ('Bakersfield',      'SN', true,  false),
  ('Fresno',           'SN', true,  false),
  ('Modesto',          'SN', true,  false),
  ('Orange County',    'SN', true,  false),
  ('Sacramento',       'SN', true,  false),
  ('Visalia',          'SN', true,  false),
  ('Corp - Fresno',    'SN', false, true),
  ('Corp - Bakersfield','SN', false, true)
) AS b(name, bus_code, is_revenue_generating, is_corporate)
JOIN businesses bus ON bus.code = b.bus_code
ON CONFLICT (name, business_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- PAYROLL ITEM GROUPS (12)
-- ─────────────────────────────────────────────
INSERT INTO payroll_item_groups (name) VALUES
  ('Standard Time'),
  ('Overtime'),
  ('Double-time'),
  ('Lunch Comp'),
  ('SAUs'),
  ('Per Diem'),
  ('Reimbursement'),
  ('Fringes'),
  ('Salary'),
  ('Paid Leave'),
  ('Other'),
  ('Taxes')
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────
-- PAYROLL CODES (87 rows — 29 branch/type combos × 3 entities)
-- Source: Payroll_Codes_-_Sheet2.csv
-- Mapping:
--   Direct           → labor_type='direct',       allocation_type='none'
--   Admin (Hourly)   → labor_type='admin_hourly',  allocation_type='none'
--   Admin (Salary)   → labor_type='admin_salary',  allocation_type='none'
--   Corp (Hourly)    → labor_type='corp_hourly',   allocation_type='corp'
--   Corp (Salary)    → labor_type='corp_salary',   allocation_type='corp'
--   HQ (Hourly)      → labor_type='hq_hourly',     allocation_type='hq'
--   HQ (Salary)      → labor_type='hq_salary',     allocation_type='hq'
-- ─────────────────────────────────────────────
INSERT INTO payroll_codes (code, branch_id, entity_id, labor_type, allocation_type)
SELECT pc.code, b.id, e.id, pc.labor_type, pc.allocation_type
FROM (VALUES
  -- Direct Labor
  ('INCARR',  'Arroyo Grande',       'INC', 'direct',       'none'),
  ('STAOP',   'Arroyo Grande',       'STS', 'direct',       'none'),
  ('TCAOP',   'Arroyo Grande',       'TCS', 'direct',       'none'),
  ('INCBF',   'Bakersfield',         'INC', 'direct',       'none'),
  ('STBOP',   'Bakersfield',         'STS', 'direct',       'none'),
  ('TCBOP',   'Bakersfield',         'TCS', 'direct',       'none'),
  ('INCFR',   'Fresno',              'INC', 'direct',       'none'),
  ('STFOP',   'Fresno',              'STS', 'direct',       'none'),
  ('TCFOP',   'Fresno',              'TCS', 'direct',       'none'),
  ('INCMO',   'Modesto',             'INC', 'direct',       'none'),
  ('STMOP',   'Modesto',             'STS', 'direct',       'none'),
  ('TCMOP',   'Modesto',             'TCS', 'direct',       'none'),
  ('INCOC',   'Orange County',       'INC', 'direct',       'none'),
  ('STOOP',   'Orange County',       'STS', 'direct',       'none'),
  ('TCOOP',   'Orange County',       'TCS', 'direct',       'none'),
  ('INCSAC',  'Sacramento',          'INC', 'direct',       'none'),
  ('STSOP',   'Sacramento',          'STS', 'direct',       'none'),
  ('TCSOP',   'Sacramento',          'TCS', 'direct',       'none'),
  ('INCVI',   'Visalia',             'INC', 'direct',       'none'),
  ('STVOP',   'Visalia',             'STS', 'direct',       'none'),
  ('TCVOP',   'Visalia',             'TCS', 'direct',       'none'),
  -- Corp Hourly
  ('INCFCH',  'Corp - Fresno',       'INC', 'corp_hourly',  'corp'),
  ('STFCH',   'Corp - Fresno',       'STS', 'corp_hourly',  'corp'),
  ('TCFCH',   'Corp - Fresno',       'TCS', 'corp_hourly',  'corp'),
  ('INCBCH',  'Corp - Bakersfield',  'INC', 'corp_hourly',  'corp'),
  ('STBCH',   'Corp - Bakersfield',  'STS', 'corp_hourly',  'corp'),
  ('TCBCH',   'Corp - Bakersfield',  'TCS', 'corp_hourly',  'corp'),
  -- Corp Salary
  ('INCFCE',  'Corp - Fresno',       'INC', 'corp_salary',  'corp'),
  ('STFCE',   'Corp - Fresno',       'STS', 'corp_salary',  'corp'),
  ('TCFCE',   'Corp - Fresno',       'TCS', 'corp_salary',  'corp'),
  ('INCBCE',  'Corp - Bakersfield',  'INC', 'corp_salary',  'corp'),
  ('STBCE',   'Corp - Bakersfield',  'STS', 'corp_salary',  'corp'),
  ('TCBCE',   'Corp - Bakersfield',  'TCS', 'corp_salary',  'corp'),
  -- Admin Hourly
  ('INCARAD', 'Arroyo Grande',       'INC', 'admin_hourly', 'none'),
  ('STARAD',  'Arroyo Grande',       'STS', 'admin_hourly', 'none'),
  ('TCARAD',  'Arroyo Grande',       'TCS', 'admin_hourly', 'none'),
  ('INCBFAD', 'Bakersfield',         'INC', 'admin_hourly', 'none'),
  ('STBFAD',  'Bakersfield',         'STS', 'admin_hourly', 'none'),
  ('TCBFAD',  'Bakersfield',         'TCS', 'admin_hourly', 'none'),
  ('INCFRAD', 'Fresno',              'INC', 'admin_hourly', 'none'),
  ('STFRAD',  'Fresno',              'STS', 'admin_hourly', 'none'),
  ('TCFRAD',  'Fresno',              'TCS', 'admin_hourly', 'none'),
  ('INCMOAD', 'Modesto',             'INC', 'admin_hourly', 'none'),
  ('STMOAD',  'Modesto',             'STS', 'admin_hourly', 'none'),
  ('TCMOAD',  'Modesto',             'TCS', 'admin_hourly', 'none'),
  ('INCOCAD', 'Orange County',       'INC', 'admin_hourly', 'none'),
  ('STOCAD',  'Orange County',       'STS', 'admin_hourly', 'none'),
  ('TCOCAD',  'Orange County',       'TCS', 'admin_hourly', 'none'),
  ('INCSAAD', 'Sacramento',          'INC', 'admin_hourly', 'none'),
  ('STSAAD',  'Sacramento',          'STS', 'admin_hourly', 'none'),
  ('TCSAAD',  'Sacramento',          'TCS', 'admin_hourly', 'none'),
  ('INCVIAD', 'Visalia',             'INC', 'admin_hourly', 'none'),
  ('STVIAD',  'Visalia',             'STS', 'admin_hourly', 'none'),
  ('TCVIAD',  'Visalia',             'TCS', 'admin_hourly', 'none'),
  -- HQ Hourly
  ('INCFHH',  'Corp - Fresno',       'INC', 'hq_hourly',   'hq'),
  ('STFHH',   'Corp - Fresno',       'STS', 'hq_hourly',   'hq'),
  ('TCFHH',   'Corp - Fresno',       'TCS', 'hq_hourly',   'hq'),
  ('INCBHH',  'Corp - Bakersfield',  'INC', 'hq_hourly',   'hq'),
  ('STBHH',   'Corp - Bakersfield',  'STS', 'hq_hourly',   'hq'),
  ('TCBHH',   'Corp - Bakersfield',  'TCS', 'hq_hourly',   'hq'),
  -- HQ Salary
  ('INCFHE',  'Corp - Fresno',       'INC', 'hq_salary',   'hq'),
  ('STFHE',   'Corp - Fresno',       'STS', 'hq_salary',   'hq'),
  ('TCFHE',   'Corp - Fresno',       'TCS', 'hq_salary',   'hq'),
  ('INCBHE',  'Corp - Bakersfield',  'INC', 'hq_salary',   'hq'),
  ('STBHE',   'Corp - Bakersfield',  'STS', 'hq_salary',   'hq'),
  ('TCBHE',   'Corp - Bakersfield',  'TCS', 'hq_salary',   'hq'),
  -- Admin Salary
  ('INCARADE',  'Arroyo Grande',     'INC', 'admin_salary', 'none'),
  ('STARADE',   'Arroyo Grande',     'STS', 'admin_salary', 'none'),
  ('TCARADE',   'Arroyo Grande',     'TCS', 'admin_salary', 'none'),
  ('INCBFADE',  'Bakersfield',       'INC', 'admin_salary', 'none'),
  ('STBFADE',   'Bakersfield',       'STS', 'admin_salary', 'none'),
  ('TCBFADE',   'Bakersfield',       'TCS', 'admin_salary', 'none'),
  ('INCFRADE',  'Fresno',            'INC', 'admin_salary', 'none'),
  ('STFRADE',   'Fresno',            'STS', 'admin_salary', 'none'),
  ('TCFRADE',   'Fresno',            'TCS', 'admin_salary', 'none'),
  ('INCMOADE',  'Modesto',           'INC', 'admin_salary', 'none'),
  ('STMOADE',   'Modesto',           'STS', 'admin_salary', 'none'),
  ('TCMOADE',   'Modesto',           'TCS', 'admin_salary', 'none'),
  ('INCOCADE',  'Orange County',     'INC', 'admin_salary', 'none'),
  ('STOCADE',   'Orange County',     'STS', 'admin_salary', 'none'),
  ('TCOCADE',   'Orange County',     'TCS', 'admin_salary', 'none'),
  ('INCSAADE',  'Sacramento',        'INC', 'admin_salary', 'none'),
  ('STSAADE',   'Sacramento',        'STS', 'admin_salary', 'none'),
  ('TCSAADE',   'Sacramento',        'TCS', 'admin_salary', 'none'),
  ('INCVIADE',  'Visalia',           'INC', 'admin_salary', 'none'),
  ('STVIADE',   'Visalia',           'STS', 'admin_salary', 'none'),
  ('TCVIADE',   'Visalia',           'TCS', 'admin_salary', 'none')
) AS pc(code, branch_name, entity_code, labor_type, allocation_type)
JOIN branches b ON b.name = pc.branch_name
JOIN entities e ON e.code = pc.entity_code
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- PAYROLL ITEMS (195 items from payroll-item-mappings.csv)
-- All marked is_confirmed = true (these are known, pre-mapped items).
-- ─────────────────────────────────────────────
INSERT INTO payroll_items (name, group_id, is_confirmed)
SELECT pi.name, g.id, true
FROM (VALUES
  ('(COC) Prevailing Wage',               'Standard Time'),
  ('(COC) Prevailing Wage OT',            'Overtime'),
  ('Administrative (PAID)',               'Standard Time'),
  ('Apprentice Travel TIme',              'Standard Time'),
  ('Bonus',                               'Other'),
  ('Bonus hours',                         'Other'),
  ('CA  EXTRA FUTA',                      'Taxes'),
  ('CA - Employment Training Tax',        'Taxes'),
  ('CA - Unemployment Company',           'Taxes'),
  ('CAC TRAINING NOR CAL FRINGES',        'Fringes'),
  ('CAC TRAINING SO CAL FRINGES',         'Fringes'),
  ('Cell Phone Reimbursement',            'Reimbursement'),
  ('Double Time Hourly Rate',             'Double-time'),
  ('DT Prevailing Wage',                  'Double-time'),
  ('EBAC NOR CAL FRINGES',               'Fringes'),
  ('EBAC SO CAL FRINGES',                'Fringes'),
  ('Emergency On-Call',                   'Double-time'),
  ('ER Paid Benefits',                    'Other'),
  ('Federal Unemployment',                'Taxes'),
  ('Flagging/DT Prevailing Wage',         'Double-time'),
  ('Flagging/OT Prevailing Wage',         'Overtime'),
  ('Flagging/Prevailing Wage',            'Standard Time'),
  ('Gas Allowance',                       'Other'),
  ('Holiday Rate',                        'Standard Time'),
  ('Hourly',                              'Standard Time'),
  ('Hourly Rate',                         'Standard Time'),
  ('Incentive',                           'Other'),
  ('Journeyman Travel Time',              'Standard Time'),
  ('Lunch~Compensation',                  'Lunch Comp'),
  ('Management Bonus Goal',               'Other'),
  ('Management Car Allowance 1',          'Other'),
  ('Management Incentive',                'Other'),
  ('Management Salary',                   'Salary'),
  ('Management-Car Allowance',            'Other'),
  ('Management-Monthly Commission',       'Other'),
  ('Management-Salary Vacation',          'Salary'),
  ('Medicare Company',                    'Taxes'),
  ('Monthly Bonus',                       'Other'),
  ('NO CAL FRINGES - OTHER',             'Fringes'),
  ('NO. Apprentice  Labor Rate',          'Standard Time'),
  ('NO. Apprentice  OT Labor Rate',       'Overtime'),
  ('NO. Apprentice 1 DT Labor Rate',      'Double-time'),
  ('NO. Apprentice 1 Labor Rate',         'Standard Time'),
  ('NO. Apprentice 1 OT Labor Rate',      'Overtime'),
  ('NO. Apprentice 2  Labor Rate',        'Standard Time'),
  ('No. Apprentice 2 DT Labor Rate',      'Double-time'),
  ('NO. Apprentice 2 Labor Rate',         'Standard Time'),
  ('NO. Apprentice 2 OT Labor Rate',      'Overtime'),
  ('NO. Apprentice 3  Labor Rate',        'Standard Time'),
  ('NO. Apprentice 3 DT Labor Rate',      'Double-time'),
  ('NO. Apprentice 3 Labor Rate',         'Standard Time'),
  ('NO. Apprentice 3 OT Labor Rate',      'Overtime'),
  ('NO. Apprentice 4  Labor Rate',        'Standard Time'),
  ('NO. Apprentice 4 DT Labor Rate',      'Double-time'),
  ('NO. Apprentice 4 Labor Rate',         'Standard Time'),
  ('NO. Apprentice 4 OT Labor Rate',      'Overtime'),
  ('NO. Apprentice DT Labor Rate',        'Double-time'),
  ('NO. Apprentice OT Labor Rate',        'Overtime'),
  ('No. Flagging/Hourly Rate/App 1',      'Standard Time'),
  ('No. Flagging/OT Rate/App 1',          'Overtime'),
  ('NO. Journeyman DT Labor Rate',        'Double-time'),
  ('NO. Journeyman TCP 1 DT Rate B',      'Double-time'),
  ('NO. Journeyman TCP 1 OT Rate B',      'Overtime'),
  ('NO. Journeyman TCP 1 Rate B',         'Standard Time'),
  ('NO. Journeyman TCP-1 Rate A',         'Standard Time'),
  ('NO. Journeyman TCP-DT Rate A',        'Double-time'),
  ('NO. Journeyman TCP-OT Rate  A',       'Overtime'),
  ('NO. Journeyman TCP-OT Rate A',        'Overtime'),
  ('NO. Lunch Comp.',                     'Lunch Comp'),
  ('Nor Cal - CAC Training',              'Fringes'),
  ('Nor Cal - Fringes Paid to EBAC',     'Fringes'),
  ('Nor Cal -Fringes Paid to EBAC',      'Fringes'),
  ('Nor Cal Union Fringes-',              'Fringes'),
  ('Nor Cal-Doubletime Hourly Rate',      'Double-time'),
  ('Nor Cal-Holiday Rate',                'Standard Time'),
  ('Nor Cal-Holiday Worked',              'Standard Time'),
  ('Nor Cal-Hourly Rate',                 'Standard Time'),
  ('Nor Cal-Lunch~Compensation',          'Lunch Comp'),
  ('Nor Cal-Overtime Hourly Rate',        'Overtime'),
  ('Nor Cal-Sick Hourly Rate',            'Paid Leave'),
  ('Nor Cal-Vacation Hourly Rate',        'Paid Leave'),
  ('Nor Cal/ER Paid Benefit 6%',          'Other'),
  ('NorCal Prevailing Wage',              'Standard Time'),
  ('NorCal Prevailing Wage DT',           'Double-time'),
  ('NorCal Prevailing Wage OT',           'Overtime'),
  ('ODMP-NON UNION',                      'Lunch Comp'),
  ('ODMP-UNION',                          'Lunch Comp'),
  ('Officer Bonus',                       'Other'),
  ('On Call',                             'Other'),
  ('OTHER NOR CAL FRINGES NON-UNION',    'Fringes'),
  ('OTHER NOR CAL FRINGES NON-UNON',     'Fringes'),
  ('OTHER SO CAL FRINGES NON-UNION',     'Fringes'),
  ('Overtime (x1.5) hourly',              'Overtime'),
  ('Overtime Hourly Rate',                'Overtime'),
  ('Overtime Rate',                       'Overtime'),
  ('Per Deim',                            'Per Diem'),
  ('PER DEIM - FLAT RATE',               'Per Diem'),
  ('Per Diem',                            'Per Diem'),
  ('Per Diem 2',                          'Per Diem'),
  ('Qualified OT Tracking',               'Taxes'),
  ('Reimburse Mileage',                   'Reimbursement'),
  ('Reimburse Receipts',                  'Reimbursement'),
  ('Reimbursement',                       'Reimbursement'),
  ('Salary',                              'Salary'),
  ('Sick Hourly Rate',                    'Paid Leave'),
  ('So Cal - CAC Training',               'Fringes'),
  ('So Cal - OT Hourly Rate',             'Overtime'),
  ('SO CAL DT HOURLY DIFF',              'Double-time'),
  ('So Cal DT Rate',                      'Double-time'),
  ('So Cal Flg PW Lunch',                 'Lunch Comp'),
  ('So Cal Fringes Paid to EBAC',        'Fringes'),
  ('So Cal Fringes-',                     'Fringes'),
  ('SO CAL FRINGES-OTHER',               'Fringes'),
  ('SO CAL HOURLY DIFFERENTIAL',         'Standard Time'),
  ('So Cal Hourly Rate',                  'Standard Time'),
  ('SO CAL LUNCH COMP',                  'Lunch Comp'),
  ('SO CAL OT HOURLY DIFF',             'Overtime'),
  ('So Cal OT Rate',                      'Overtime'),
  ('SO CAL VAC',                         'Paid Leave'),
  ('SO CAL VAC.',                        'Paid Leave'),
  ('So Cal-DT Hourly Rate',              'Double-time'),
  ('So Cal-Holiday Rate',                'Standard Time'),
  ('So Cal-Hourly Rate',                 'Standard Time'),
  ('So Cal-Sick',                        'Paid Leave'),
  ('So Cal-Sick Hourly Rate',            'Paid Leave'),
  ('So. Flagging Apprentice 1',          'Standard Time'),
  ('So. Flagging Apprentice 2',          'Standard Time'),
  ('So. Flagging Apprentice 3',          'Standard Time'),
  ('So. Flagging Apprentice 4',          'Standard Time'),
  ('So. Flagging Apprentice 6',          'Standard Time'),
  ('So. Flagging/Apprentice 5',          'Standard Time'),
  ('So. Flagging/DT Apprentice 1',       'Double-time'),
  ('So. Flagging/DT Apprentice 2',       'Double-time'),
  ('So. Flagging/DT Apprentice 3',       'Double-time'),
  ('So. Flagging/DT Apprentice 4',       'Double-time'),
  ('So. Flagging/DT Apprentice 5',       'Double-time'),
  ('So. Flagging/DT Apprentice 6',       'Double-time'),
  ('So. Flagging/DT Prevailing Wage',    'Double-time'),
  ('So. Flagging/OT Apprentice 1',       'Overtime'),
  ('So. Flagging/OT Apprentice 2',       'Overtime'),
  ('So. Flagging/OT Apprentice 3',       'Overtime'),
  ('So. Flagging/OT Apprentice 4',       'Overtime'),
  ('So. Flagging/OT Apprentice 5',       'Overtime'),
  ('So. Flagging/OT Apprentice 6',       'Overtime'),
  ('So. Flagging/OT Prevailing Wage',    'Overtime'),
  ('So. Flagging/Prevail/Appren/OT',     'Overtime'),
  ('So. Flagging/Prevailing Wage',       'Standard Time'),
  ('Social Security Company',            'Taxes'),
  ('Truck Fueling',                      'Other'),
  ('UNION NOR CAL FRINGES A1',          'Fringes'),
  ('UNION NOR CAL FRINGES A2-J',        'Fringes'),
  ('Union So Cal  FLG-CERT DT HR',      'Double-time'),
  ('Union So Cal FLG-CERT DT HR',       'Double-time'),
  ('UNION SO CAL FRINGES A1-8',         'Fringes'),
  ('UNION SO CAL FRINGES J',            'Fringes'),
  ('Union So Cal Fringes-',             'Fringes'),
  ('UNION SO CAL GCW DT HOURLY RATE',   'Double-time'),
  ('UNION SO CAL GCW FRINGES',          'Fringes'),
  ('Union So Cal GCW Fringes-',         'Fringes'),
  ('UNION SO CAL GCW HOURLY RATE',      'Standard Time'),
  ('UNION SO CAL GCW OT HOURLY RATE',   'Overtime'),
  ('Union So Cal Lunch Comp',           'Lunch Comp'),
  ('Union So Cal PW Lunch Comp',        'Lunch Comp'),
  ('UNION SO CAL TCW FRINGES',          'Fringes'),
  ('Union So Cal TCW Fringes-',         'Fringes'),
  ('UNION SO CAL TCW4 HOURLY RATE',     'Standard Time'),
  ('UNION SO CAL TCW4 OT HR',           'Overtime'),
  ('Union So. Cal  FLG-CERT OT HR',     'Overtime'),
  ('Union So. Cal App 2 DT Rate',       'Double-time'),
  ('Union So. Cal App 2 Hourly Rate',   'Standard Time'),
  ('Union So. Cal App 2 OT Rate',       'Overtime'),
  ('Union So. Cal App 3 DT rate',       'Double-time'),
  ('Union So. Cal App 3 Hourly Rate',   'Standard Time'),
  ('Union So. Cal App 3 OT Rate',       'Overtime'),
  ('Union So. Cal Apprentice 1',        'Standard Time'),
  ('Union So. Cal Apprentice 1 DT',     'Double-time'),
  ('Union So. Cal Apprentice 1 OT',     'Overtime'),
  ('Union So. Cal Apprentice 4',        'Standard Time'),
  ('Union So. Cal Apprentice 4 DT',     'Double-time'),
  ('Union So. Cal Apprentice 4 OT',     'Overtime'),
  ('Union So. Cal Apprentice 5',        'Standard Time'),
  ('Union So. Cal Apprentice 5 DT',     'Double-time'),
  ('Union So. Cal Apprentice 5 OT',     'Overtime'),
  ('Union So. Cal FLG-CERT HR',         'Standard Time'),
  ('Union So. Cal FLG-CERT OT HR',      'Overtime'),
  ('Union So. Cal GCW DT Hourly Rat',   'Double-time'),
  ('Union So. Cal GCW Hourly Rate',     'Standard Time'),
  ('Union So. Cal GCW OT Hourly Rat',   'Overtime'),
  ('Union So. Cal TCW4 DT Hourly Ra',   'Double-time'),
  ('Union So. Cal TCW4 Hourly Rate',    'Standard Time'),
  ('Union So. Cal TCW4 OT HR',          'Overtime'),
  ('Union So. Cal- App 6 DT',           'Double-time'),
  ('Union So. Cal-App 6 Hourly Rate',   'Standard Time'),
  ('Union So. Cal-App 6 OT',            'Overtime'),
  ('Vacation Hourly Rate',               'Paid Leave'),
  ('Workers Compensation',               'Taxes')
) AS pi(name, group_name)
JOIN payroll_item_groups g ON g.name = pi.group_name
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────
-- REVENUE CODES (17 codes from branch-code-mappings.csv)
-- INC: all 7 branches
-- TCS: all 7 branches
-- STS: 3 branches only (Arroyo Grande, Orange County, Bakersfield)
-- ─────────────────────────────────────────────
INSERT INTO revenue_codes (code, branch_id, entity_id, is_active)
SELECT rc.code, b.id, e.id, true
FROM (VALUES
  ('INC-VI',   'Visalia',        'INC'),
  ('INC-BF',   'Bakersfield',    'INC'),
  ('INC-FR',   'Fresno',         'INC'),
  ('INC-MO',   'Modesto',        'INC'),
  ('INC-OC',   'Orange County',  'INC'),
  ('INC-ARR',  'Arroyo Grande',  'INC'),
  ('INC-SAC',  'Sacramento',     'INC'),
  ('TCS-ARR',  'Arroyo Grande',  'TCS'),
  ('TCS-OC',   'Orange County',  'TCS'),
  ('TCS-MO',   'Modesto',        'TCS'),
  ('TCS-FR',   'Fresno',         'TCS'),
  ('TCS-BF',   'Bakersfield',    'TCS'),
  ('TCS-VI',   'Visalia',        'TCS'),
  ('TCS-SAC',  'Sacramento',     'TCS'),
  ('STAOP',    'Arroyo Grande',  'STS'),
  ('STOOP',    'Orange County',  'STS'),
  ('STBOP',    'Bakersfield',    'STS')
) AS rc(code, branch_name, entity_code)
JOIN branches b ON b.name = rc.branch_name
JOIN entities e ON e.code = rc.entity_code
ON CONFLICT (code) DO NOTHING;
