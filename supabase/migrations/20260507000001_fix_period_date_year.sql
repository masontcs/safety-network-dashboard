-- Correct period_date values where a 2-digit year was parsed as year < 100 CE.
-- Root cause: QuickBooks export had "Mar 8, 26" (2-digit year); date-fns parsed
-- as year 26 CE instead of 2026. Parser now validates year >= 2000 on import.

UPDATE payroll_transactions
SET period_date = (period_date + INTERVAL '2000 years')::date
WHERE EXTRACT(year FROM period_date) < 100;

UPDATE payroll_taxes
SET period_date = (period_date + INTERVAL '2000 years')::date
WHERE EXTRACT(year FROM period_date) < 100;

UPDATE payroll_imports
SET period_date = (period_date + INTERVAL '2000 years')::date
WHERE EXTRACT(year FROM period_date) < 100;
