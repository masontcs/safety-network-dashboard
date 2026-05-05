# CLAUDE.md — /lib/ai
## AI Integration Rules

---

## MODEL

Always use: `claude-sonnet-4-20250514`
Never change this without updating this file.

---

## TWO AI FEATURES — NOTHING ELSE

This module handles exactly two AI tasks:
1. Employee name matching (payroll + fuel imports)
2. Payroll item group suggestion (payroll imports)

Do not add AI features without updating this file and the root CLAUDE.md.

---

## CRITICAL SECURITY RULE

The Anthropic API key is accessed ONLY via `process.env.ANTHROPIC_API_KEY`.
This code runs ONLY in `/lib/ai/` which is imported ONLY by API routes (server-side).
Never import anything from this module in a client component.
If you see this module imported in a file under `/app/(dashboard)/`, that is a bug — stop and fix it.

---

## FEATURE 1: EMPLOYEE NAME MATCHING

### When it's called
During payroll OR fuel import when a raw name has no confirmed match in `employee_entity_assignments` or `fuel_card_assignments`.

### Function signature
```typescript
async function matchEmployeeName(
  rawName: string,
  existingEmployees: Array<{ displayName: string; knownRawNames: string[] }>
): Promise<MatchResult[]>

type MatchResult = {
  candidateName: string;
  score: number;          // 0.0 to 1.0
  reasoning: string;      // brief explanation shown to admin
}
```

### Prompt template (in `/lib/ai/prompts.ts`)
```
You are matching a name from a payroll or fuel report to an existing employee record.

New name from report: "[RAW_NAME]"

Existing employees:
[LIST: display_name + all known raw names for each]

Return a JSON array of up to 3 best matches, ordered by confidence:
[
  { "candidateName": "...", "score": 0.95, "reasoning": "Same person, last-first vs first-last" },
  ...
]

Consider: name order variations (LAST, FIRST vs First Last), abbreviations,
nicknames, middle initials, hyphenated names, OCR-style errors.

If no reasonable match exists (score < 0.6), return an empty array [].
Return ONLY valid JSON. No explanation outside the JSON.
```

### Response parsing
```typescript
// Strip any markdown fences before parsing
const cleaned = response.replace(/```json|```/g, '').trim()
const results = JSON.parse(cleaned) as MatchResult[]
// Validate each result has candidateName (string), score (number 0-1), reasoning (string)
// If parse fails, return [] and log warning — do NOT throw
```

---

## FEATURE 2: PAYROLL ITEM GROUP SUGGESTION

### When it's called
During payroll import when a payroll item name from the file is not found in the `payroll_items` table.

### Function signature
```typescript
async function suggestPayrollItemGroup(
  newItemName: string,
  existingItems: Array<{ name: string; groupName: string }>
): Promise<GroupSuggestion>

type GroupSuggestion = {
  suggestedGroup: string;   // must be one of the 12 valid group names
  confidence: number;       // 0.0 to 1.0
  reasoning: string;
}
```

### Valid group names (hardcode this list as a constant)
```typescript
const VALID_GROUPS = [
  'Standard Time', 'Overtime', 'Double-time', 'Lunch Comp',
  'SAUs', 'Per Diem', 'Reimbursement', 'Fringes',
  'Salary', 'Paid Leave', 'Other', 'Taxes'
] as const
```

### Prompt template (in `/lib/ai/prompts.ts`)
```
You are categorizing a QuickBooks payroll item into a predefined group.

New payroll item: "[ITEM_NAME]"

Valid groups: Standard Time, Overtime, Double-time, Lunch Comp, SAUs,
Per Diem, Reimbursement, Fringes, Salary, Paid Leave, Other, Taxes

Existing items for reference:
[SAMPLE: 10 items from each group showing name → group]

Return a JSON object:
{ "suggestedGroup": "...", "confidence": 0.85, "reasoning": "..." }

The suggestedGroup MUST be one of the 12 valid groups listed above.
Return ONLY valid JSON. No explanation outside the JSON.
```

### Validation after parsing
```typescript
if (!VALID_GROUPS.includes(result.suggestedGroup)) {
  // AI hallucinated a group name — fall back to "Other" with low confidence
  return { suggestedGroup: 'Other', confidence: 0.1, reasoning: 'AI returned invalid group, defaulted to Other' }
}
```

---

## BEHAVIOR RULES

- AI calls are NEVER blocking — they run after the file is parsed and stored
- Results are stored in the DB (`ai_suggested_group`, `ai_match_candidate`, `ai_confidence`)
- The admin sees suggestions in a review queue — they are NEVER auto-applied
- If an AI call fails (network, timeout, API error): log the error, store null values, add item to review queue without a suggestion
- Do not retry automatically — let the admin trigger a re-suggestion from the UI if needed

---

## VERIFICATION CHECKLIST

- [ ] `ANTHROPIC_API_KEY` accessed only via `process.env` — never hardcoded
- [ ] Module is never imported in any client component (search: `import.*from.*lib/ai` in `/app/(dashboard)/`)
- [ ] Response parsing has try/catch — a bad AI response never crashes an import
- [ ] Suggested group is validated against `VALID_GROUPS` — invalid responses fall back to 'Other'
- [ ] AI match scores below 0.6 return empty array (no false matches forced on admin)
- [ ] Prompts live in `/lib/ai/prompts.ts` — no inline prompt strings in API routes
