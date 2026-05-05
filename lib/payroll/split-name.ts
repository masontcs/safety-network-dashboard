export type NameSplit = {
  firstName: string
  lastName: string
  unexpected: boolean
}

// Title-cases a single name segment; preserves hyphens so ALTAMIRANO-CRUZ → Altamirano-Cruz
function toTitleCase(str: string): string {
  if (!str) return ''
  return str
    .split('-')
    .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ''))
    .join('-')
}

// Splits a QuickBooks legal name into preferred first/last name defaults.
//
// QuickBooks format: "LAST, FIRST MIDDLE" or "LAST, FIRST"
//   "AGUILAR, MARC A"          → { firstName: "Marc",  lastName: "Aguilar" }
//   "AGUILAR, OBED G"          → { firstName: "Obed",  lastName: "Aguilar" }
//   "BETTENCOURT, LUIS A"      → { firstName: "Luis",  lastName: "Bettencourt" }
//   "ALTAMIRANO-CRUZ, CESAR A" → { firstName: "Cesar", lastName: "Altamirano-Cruz" }
//   "MARC AGUILAR"             → { firstName: "",      lastName: "Marc Aguilar", unexpected: true }
//
// Strips middle initials. Title-cases both parts. Preserves hyphens in last names.
// If no comma is found: stores full name in lastName, leaves firstName blank, sets unexpected = true.
export function splitLegalName(raw: string): NameSplit {
  const trimmed = raw.trim()

  if (trimmed.includes(',')) {
    const commaIdx = trimmed.indexOf(',')
    const last = trimmed.slice(0, commaIdx).trim()
    const rest = trimmed.slice(commaIdx + 1).trim()
    // Take only the first word — drops middle initial (e.g. "A" from "MARC A")
    const firstName = rest.split(/\s+/)[0] ?? ''
    return {
      firstName: toTitleCase(firstName),
      lastName:  toTitleCase(last),
      unexpected: false,
    }
  }

  // Multiple words (e.g. "MARC AGUILAR") — title-case each word individually
  return {
    firstName:  '',
    lastName:   trimmed.split(/\s+/).map(toTitleCase).join(' '),
    unexpected: true,
  }
}
