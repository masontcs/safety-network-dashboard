export const VALID_GROUPS = [
  'Standard Time',
  'Overtime',
  'Double-time',
  'Lunch Comp',
  'SAUs',
  'Per Diem',
  'Reimbursement',
  'Fringes',
  'Salary',
  'Paid Leave',
  'Other',
  'Taxes',
] as const

export type ValidGroup = (typeof VALID_GROUPS)[number]

export function buildMatchEmployeePrompt(
  rawName: string,
  existing: Array<{ displayName: string; knownRawNames: string[] }>
): string {
  const listText = existing
    .map((e) => {
      const raws = e.knownRawNames.length > 0 ? ` (known raw names: ${e.knownRawNames.join(', ')})` : ''
      return `- ${e.displayName}${raws}`
    })
    .join('\n')

  return `You are matching a name from a payroll or fuel report to an existing employee record.

New name from report: "${rawName}"

Existing employees:
${listText}

Return a JSON array of up to 3 best matches, ordered by confidence:
[
  { "candidateName": "...", "score": 0.95, "reasoning": "Same person, last-first vs first-last" },
  ...
]

Consider: name order variations (LAST, FIRST vs First Last), abbreviations,
nicknames, middle initials, hyphenated names, OCR-style errors.

If no reasonable match exists (score < 0.6), return an empty array [].
Return ONLY valid JSON. No explanation outside the JSON.`
}

export function buildSuggestGroupPrompt(
  itemName: string,
  existing: Array<{ name: string; groupName: string }>
): string {
  const sampleText = existing
    .slice(0, 50)
    .map((e) => `- ${e.name} → ${e.groupName}`)
    .join('\n')

  return `You are categorizing a QuickBooks payroll item into a predefined group.

New payroll item: "${itemName}"

Valid groups: Standard Time, Overtime, Double-time, Lunch Comp, SAUs,
Per Diem, Reimbursement, Fringes, Salary, Paid Leave, Other, Taxes

Existing items for reference:
${sampleText}

Return a JSON object:
{ "suggestedGroup": "...", "confidence": 0.85, "reasoning": "..." }

The suggestedGroup MUST be one of the 12 valid groups listed above.
Return ONLY valid JSON. No explanation outside the JSON.`
}

/**
 * FEATURE 3 (CMR AP Phase 3b): advisory review of possible duplicate A/P vendors. The model only
 * comments — a Cash Ledger Controller confirms every merge. Names are QuickBooks vendor names,
 * never people's pay data.
 */
export function buildVendorDuplicatePrompt(
  vendors: Array<{ n: number; name: string; spellings: string[]; accounts: string[] }>,
  pairs: Array<{ p: number; a: number; b: number; reason: string }>
): string {
  const vendorText = vendors
    .map((v) => {
      const other = v.spellings.filter((s) => s !== v.name)
      return `${v.n}. ${v.name}${other.length ? ` (also spelled: ${other.join(' | ')})` : ''} [${v.accounts.join(', ') || 'no open A/P'}]`
    })
    .join('\n')
  const pairText = pairs.length
    ? pairs.map((p) => `P${p.p}: ${p.a} ↔ ${p.b} — ${p.reason}`).join('\n')
    : '(none)'

  return `You are helping an accounts-payable controller clean up a vendor list exported from QuickBooks
for several related companies (the bracketed names are the company accounts that owe the vendor).
The same real-world vendor is sometimes spelled differently in different companies' books.

Vendors:
${vendorText}

A rule-based matcher proposed these possible duplicate pairs:
${pairText}

Tasks:
1. For EVERY proposed pair, say whether the two are the same real-world vendor:
   "same", "different" or "unsure", with a note of at most 15 words.
2. List up to 15 ADDITIONAL pairs the rules missed that are very likely the same real-world vendor
   (e.g. an abbreviation, a former name noted in the text, a brand vs its legal name). Do not
   repeat a proposed pair. Different locations, card numbers, loans or accounts of the same
   company are NOT duplicates unless the names show they are the same payee.

Return ONLY a JSON object, no other text:
{ "reviews": [ { "pair": 1, "verdict": "same", "note": "..." } ],
  "additional": [ { "a": 12, "b": 40, "note": "..." } ] }
Use the vendor numbers and pair numbers exactly as given.`
}
