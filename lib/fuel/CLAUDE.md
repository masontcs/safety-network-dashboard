# CLAUDE.md — /lib/fuel
## Fuel Parser Rules

---

## TWO VENDORS, TWO FORMATS

| | Interstate | Flyers |
|---|---|---|
| File format | CSV (always) | XLSX (always) |
| Headers row | Row 1 (index 0) | Row 2 (index 1) |
| Data starts | Row 2 (index 1) | Row 3 (index 2) |

**Auto-detect vendor by file extension:**
- `.csv` → Interstate
- `.xlsx` → Flyers

If extension doesn't match either, return a structured parse error.

---

## FIELD MAPPING

```typescript
// Interstate (CSV) column names
const INTERSTATE_MAP = {
  cardName:       'Card_Description',
  date:           'Trans_Date',       // format: "MM/DD/YYYY"
  time:           'Trans_Time',       // format: "HH:MM AM/PM"
  product:        'Product_Desc',
  gallons:        'Quantity',
  pricePerGallon: 'Price',
  tax:            'Sales_Tax',
  siteName:       'Site_Name',        // e.g. "CA-CITY OF BAKERSFIELD"
  // total_pretax = gallons * pricePerGallon (calculate — not in file)
  // total_with_tax = total_pretax + tax (calculate)
  // site_city and site_state: parse from Site_Name (see below)
}

// Flyers (XLSX) column names
const FLYERS_MAP = {
  cardName:       'CardDescription',
  date:           'Date',             // format: "MM/DD/YYYY"
  time:           'Time',             // format: "HH:MM:SS"
  product:        'Product',
  gallons:        'Quantity',
  pricePerGallon: 'UnitPrice',
  tax:            'TaxTotal',
  totalWithTax:   'TotalPrice',       // use directly, no calculation needed
  siteAddress:    'SiteAddress',
  siteCity:       'SiteCity',         // direct field
  siteState:      'State',
  siteName:       'SiteDescription',
  // total_pretax = totalWithTax - tax (calculate from Flyers fields)
}
```

---

## SITE PARSING FOR INTERSTATE

Interstate `Site_Name` format: `"CA-CITY OF BAKERSFIELD"` or `"CA-CITY OF SANTA MARIA"`

Parse rules:
```typescript
function parseInterstateSite(siteName: string): { city: string, state: string } {
  // Split on first "-"
  // Left part = state code (2 chars)
  // Right part = "CITY OF [CITY NAME]" → strip "CITY OF " prefix
  // If pattern doesn't match, store full siteName in city, empty string in state
}
```

---

## WESTERN HIGHWAYS DETECTION

Tag transactions as `business_tag = 'western_highways'` when:
- `CardDescription` (Flyers) === 'WESTERN SHOP'
- `ReportingGroup` (Flyers) is 'WEST HWY' or 'WESTERN HIGHWAYS'

These transactions ARE imported but excluded from Safety Network dashboards.
Do NOT skip them. Do NOT discard them. Tag and store them.

---

## CALCULATIONS

```typescript
// Interstate: total not in file, must calculate
total_pretax  = gallons * price_per_gallon
total_with_tax = total_pretax + tax

// Flyers: total is in file
total_with_tax = TotalPrice   (from file)
total_pretax   = total_with_tax - TaxTotal
```

Round all calculated values to 2 decimal places using `Math.round(val * 100) / 100`.

---

## RETURN TYPE

```typescript
type FuelParseResult = {
  vendor: 'interstate' | 'flyers';
  dateRangeStart: string;     // earliest transaction date (ISO)
  dateRangeEnd: string;       // latest transaction date (ISO)
  transactions: ParsedFuelTransaction[];
  newCardNames: string[];     // card names not yet in fuel_card_assignments
  warnings: string[];
}

type ParsedFuelTransaction = {
  cardName: string;           // raw from report
  transactionDate: string;    // ISO date
  transactionTime: string;    // "HH:MM:SS"
  siteName: string;
  siteCity: string;
  siteState: string;
  product: string;
  gallons: number;
  pricePerGallon: number;
  totalPretax: number;
  tax: number;
  totalWithTax: number;
  businessTag: 'western_highways' | 'signs' | null;
}
```

---

## WHAT THIS MODULE DOES NOT DO

- Does NOT resolve card names to employee_id or branch_id — import API route handles that
- Does NOT call AI for card matching
- Does NOT write to the database

The parser simply identifies which card names are new (not in fuel_card_assignments) and returns them in `newCardNames[]` so the import route can trigger AI matching.

---

## VERIFICATION CHECKLIST

- [ ] File type auto-detection works for both .csv and .xlsx
- [ ] Interstate `Site_Name` parsing produces correct city + state
- [ ] Western Highways cards are tagged, not skipped
- [ ] `total_pretax` and `total_with_tax` are calculated correctly for both vendors
- [ ] Calculated values rounded to 2 decimal places
- [ ] Date range start/end are derived from actual transaction dates in the file, not the filename
- [ ] `newCardNames` contains only names not already in fuel_card_assignments
- [ ] No DB writes in this module (DB reads for existing card lookup are OK)
