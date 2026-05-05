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
