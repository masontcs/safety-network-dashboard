# CLAUDE.md — /lib/revenue
## Revenue Parser Rules

---

## FILE FORMAT

QuickBooks Invoice Summary by Month by Branch (.xls format — use `xlsx` library).
One file covers all entities for one week. Entity is identified by Company Code in column H.

```
Row 1:  "Invoice Summary by Month by Branch" title
Row 2:  blank
Row 3:  "Date Range [start] - [end]"   ← extract end date
Row 4:  Column headers: Invoice Year | Invoice Month | Labor | Rental | One Time Charges/Sales | Total w/o Sales Tax | Sales Tax | Company Code
Row 5+: Data rows, branch headers, totals
```

---

## COLUMN INDEX MAP (0-indexed)

```
A (0) = Branch label / row type identifier
B (1) = Invoice Month
C (2) = Labor
D (3) = Rental
E (4) = One Time Charges/Sales
F (5) = Total w/o Sales Tax  ← DO NOT store this, calculate your own total
G (6) = Sales Tax
H (7) = Company Code
```

---

## ENTITY CODE MAPPING — HARDCODED IN PARSER

```typescript
const ENTITY_MAP: Record<string, string> = {
  'SAFETY1003': 'INC',
  'SNTCS1503':  'TCS',
  'SNTSIGN':    'STS',
}
```

---

## BRANCH NAME NORMALIZATION — HARDCODED IN PARSER

```typescript
const BRANCH_MERGE: Record<string, string> = {
  'Bakersfield Sales': 'Bakersfield',
  'Fresno Sales':      'Fresno',
}
// Apply: normalizedName = BRANCH_MERGE[rawName] ?? rawName
```

---

## PARSING ALGORITHM

```
STEP 1: Extract period date
  - Find "Date Range" in row 3, column A
  - Parse the date range string: "[start] - [end]"
  - Use the END date as period_date (already a Saturday)
  - Validate it is a Saturday

STEP 2: Scan rows for data
  - When col A starts with "Branch: " → set current_branch = col A stripped of "Branch: "
    Apply BRANCH_MERGE normalization immediately
  - When col A value is a year number (e.g. 2026.0) AND col H has a Company Code → this is a DATA ROW
    Capture: current_branch, ENTITY_MAP[col H], labor, rental, one_time_charges, sales_tax
  - When col A === "Branch Totals" → this marks end of current branch section (do not capture this row)
  - When col A contains "Year Totals" or "Report Totals" → skip entirely

STEP 3: Merge same branch + entity combinations
  - Bakersfield + INC from "Bakersfield" and "Bakersfield Sales" → sum all fields, single record
```

---

## REVENUE CALCULATION

```typescript
total_revenue = labor + rental + one_time_charges
// sales_tax is stored separately — NEVER add it to total_revenue
// Do NOT use the "Total w/o Sales Tax" column from the file — calculate your own
```

---

## RETURN TYPE

```typescript
type RevenueParseResult = {
  periodDate: string;             // ISO date, Saturday
  records: ParsedRevenueRecord[];
  warnings: string[];
}

type ParsedRevenueRecord = {
  branchName: string;             // normalized branch name
  entityCode: string;             // INC | TCS | STS
  labor: number;
  rental: number;
  oneTimeCharges: number;
  salesTax: number;
  totalRevenue: number;           // labor + rental + oneTimeCharges
}
```

---

## WHAT THIS MODULE DOES NOT DO

- Does NOT map branch names to branch_id — that happens in the import API route
- Does NOT check for duplicate imports
- Does NOT write to the database
- If a Company Code appears that isn't in ENTITY_MAP → add to `warnings[]`, skip that row

---

## VERIFICATION CHECKLIST

- [ ] Period date is extracted from the END of the date range, not the start
- [ ] Period date is a Saturday — validate with `getDay() === 6`
- [ ] `total_revenue` is calculated as `labor + rental + one_time_charges` (NOT from col F)
- [ ] Sales tax is stored separately, not included in total_revenue
- [ ] Bakersfield Sales merges into Bakersfield
- [ ] Fresno Sales merges into Fresno
- [ ] Year Totals and Report Totals rows are skipped
- [ ] Only data rows (year number in col A + company code in col H) are captured
- [ ] Unknown company codes go to warnings, not errors
- [ ] No DB calls in this module
