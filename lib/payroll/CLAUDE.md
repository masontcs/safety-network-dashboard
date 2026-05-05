# CLAUDE.md — /lib/payroll
## Payroll Parser Rules

---

## WHAT THIS MODULE DOES

Parses QuickBooks Payroll Summary .xlsm files for three entities (INC, TCS, STS).
Output is a structured array of employee records ready for database insertion.
Does NOT write to DB. Does NOT call AI. Does NOT resolve employee IDs.

---

## FILE STRUCTURE

```
Row 1:  Employee names across columns (non-null, non-TOTAL = employee)
Row 2:  Header containing "Week of [DATE]"
Row 3:  Blank
Row 4:  Column headers
Row 5+: Payroll items in col D, employee data in cols E+
Last:   "Total Employer Taxes and Contributions" row
```

Employee column pattern (N = name column index, 0-based):
- `N` = hours, `N+2` = rate, `N+4` = amount

---

## PARSING ALGORITHM

```
STEP 1: Period date
  Find "Week of [date]" in row 2 → subtract 1 day → must be a Saturday

STEP 2: Payroll items (DYNAMIC)
  Read col D from row 5 downward until first blank cell

STEP 3: Employee columns
  Read row 1 across — non-null, non-"TOTAL" = employee
  Stop at "TOTAL" (case-insensitive)

STEP 4: Tax row
  Scan for "Total Employer Taxes and Contributions" in col D

STEP 5: Per employee
  For each payroll item: read hours/rate/amount
  Include only non-zero amounts
  Read tax from tax row

STEP 6: Skip zero employees
  Skip if ALL payroll amounts = 0 AND tax = 0
```

---

## NAME AUTO-SPLIT — CRITICAL

QuickBooks exports names as "LAST, FIRST MIDDLE" or "LAST, FIRST".
The parser must split these on first import.

```typescript
function splitLegalName(raw: string): { firstName: string; lastName: string } {
  const trimmed = raw.trim()

  if (trimmed.includes(',')) {
    const [last, firstAndMiddle] = trimmed.split(',', 2)
    // Take only the first word of the right side (drop middle initial)
    const firstName = firstAndMiddle.trim().split(' ')[0]
    return {
      firstName: toTitleCase(firstName),
      lastName:  toTitleCase(last.trim()),
    }
  }

  // No comma — unexpected format
  // Store full name in lastName, blank firstName, flag for review
  return { firstName: '', lastName: toTitleCase(trimmed) }
}

function toTitleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}
```

Test cases:
```
"AGUILAR, MARC A"         → { firstName: "Marc",  lastName: "Aguilar" }
"AGUILAR, OBED G"         → { firstName: "Obed",  lastName: "Aguilar" }
"BETTENCOURT, LUIS A"     → { firstName: "Luis",  lastName: "Bettencourt" }
"ALTAMIRANO-CRUZ, CESAR A"→ { firstName: "Cesar", lastName: "Altamirano-Cruz" }
"MARC AGUILAR"            → { firstName: "",      lastName: "Marc Aguilar" } + flagged
```

Hyphenated last names must preserve the hyphen. Do not split on hyphens.

---

## RETURN TYPE

```typescript
type PayrollParseResult = {
  periodDate: string            // ISO date "2026-03-28"
  entityCode: string            // "INC" | "TCS" | "STS"
  payrollItems: string[]        // ordered list from col D
  employees: ParsedEmployee[]
  warnings: string[]
}

type ParsedEmployee = {
  rawName: string               // exactly as in report — stored as raw_name_in_report
  autoFirstName: string         // from splitLegalName — default preferred first name
  autoLastName: string          // from splitLegalName — default preferred last name
  nameFormatUnexpected: boolean // true if no comma found — needs review
  lineItems: PayrollLineItem[]
  taxAmount: number
}

type PayrollLineItem = {
  itemName: string
  hours: number | null
  rate: number | null
  amount: number
}
```

The `autoFirstName` and `autoLastName` are used by the import API route to set
`employees.first_name` and `employees.last_name` when creating a new employee record.
They are NOT used if the employee already exists — never overwrite a preferred name
that has already been set.

---

## ERROR HANDLING

Throw structured error for: missing date, no payroll items, no employees, TOTAL not found, tax row not found.
Log to warnings for: no comma in name, missing rate on non-salary item, missing tax value.

---

## VERIFICATION CHECKLIST

- [ ] `splitLegalName` handles all test cases above
- [ ] Hyphenated last names preserve the hyphen
- [ ] `nameFormatUnexpected = true` when no comma found
- [ ] `autoFirstName`/`autoLastName` are NEVER applied to existing employees
- [ ] Period date always a Saturday (`getDay() === 6`)
- [ ] Zero-activity employees excluded
- [ ] No DB calls in this module
