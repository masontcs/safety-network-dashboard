import { describe, it, expect } from 'vitest'
import { editDistance, pairKey, suggestVendorMerges, vendorTokens, type CmrVendorMatchInput } from '@/lib/cmr/vendor-suggest'

/**
 * AP Phase 3b — the duplicate-vendor matcher (advisory only). It must surface the known real
 * near-duplicates from the four accounts' QuickBooks exports, explain each one, and leave
 * obviously different vendors alone. The names below are real vendor names from those exports
 * (a representative slice, so word rarity behaves as on the full list).
 */

const REAL = [
  'TRAFFIX DEVICES', 'TRAFFIX DEVICES INC',
  'SAFETY NETWORK TRAFFIC SIGNS', 'SAFETY NETWORK TRAFFIC SIGNS, INC',
  'WANCO INC', 'WANCO, INC',
  'OSCAR J. GARCIA, CPA', 'OSCAR J GARCIA C P A',
  'ITRIA VENTURE/BIZ2CREDIT', 'BIZ2CREDIT/ITRIA VEN',
  'R G MOORE & ASSOCIATES', 'RG MOORE & ASSOCIATES',
  // distractors that must NOT pair up
  'SAFETY NETWORK HOLDINGS, INC', 'SAFETY NETWORK TCS, INC', 'SAFETY NETWORK, INC.',
  '405 EXPRESS LANES', '91 EXPRESS LANES', 'METRO EXPRESSLANES',
  'CITY OF FRESNO TRAFFIC ENGINEERING', 'CITY OF FRESNO UTILITIES (AUTO)', 'CITY OF SELMA', 'CITY OF SALINAS', 'CITY OF SANGER',
  'CITY OF IRVINE', 'CITY OF FREMONT', 'CITY OF FILLMORE', 'CITY OF SAN CLEMENTE',
  'SAMSARA - A - 005 (LEASE SERVICES)', 'SAMSARA - B - 006 (LEASE SERVICES)',
  'COMCAST/FRESNO/AUTOPAY', 'COMCAST/MODESTO/AUTOPAY',
  'PG&E FRESNO 6383-7 [AUTO 1650', 'PG&E MODESTO (AUTOPAY 1650)',
  'SETH JOHNSON (V)', 'RUSS JOHNSON', 'TRENT H JOHNSON (V)', 'JEANNINE JOHNSON (V)',
  'UNITED RENTALS', 'UNITED SITE SERVICES',
  'WESTERN HIGHWAYS', 'WESTERN HIGHWAYS SERVICE CENTERS - FRESNO', 'WESTERN HIGHWAYS TEXAS SERVICE CENTERS',
  'CASH', 'CALIFORNIA CHECK CASHING (CORP)', 'UPS', 'ULINE', 'ADP',
  'AMAZON', 'ALLINSAFETY', 'TEG SAFETY, INC.', 'JBC SAFETY PLASTIC, INC', 'HI-WAY SAFETY PRODUCTS (HSP)',
  'AT&T MOBILITY', 'AT&T ANAHEIM INTERNET(AUTO 1650)',
  // other genuine near-duplicates in the data
  'HCTRA', 'HCTRA -TOLL COLLECTIONS',
  'FASTRAK', 'FAS TRAK INVOICE PROCESSING DEPARTMENT',
  "FARMER'S LUMBER", 'FARMERS LUMBER & SUPPLY, INC',
  'WESTERN HIGHWAY TRAFFIC TRUCK PRODUCTS', 'WESTERN HIGHWAYS TRAFFIC TRUCK PRODUCTS',
]

const vendors: CmrVendorMatchInput[] = REAL.map((n, i) => ({ id: `v${String(i).padStart(3, '0')}`, canonicalName: n, spellings: [n] }))
const nameOf = new Map(vendors.map((v) => [v.id, v.canonicalName]))
const pairs = (list = suggestVendorMerges(vendors)) => list.map((m) => [nameOf.get(m.a)!, nameOf.get(m.b)!].sort().join(' ↔ '))
const key = (x: string, y: string) => [x, y].sort().join(' ↔ ')

describe('suggestVendorMerges — the known near-duplicates', () => {
  const found = suggestVendorMerges(vendors)
  const by = (x: string, y: string) => found.find((m) => key(nameOf.get(m.a)!, nameOf.get(m.b)!) === key(x, y))

  it.each([
    ['TRAFFIX DEVICES', 'TRAFFIX DEVICES INC', 'suffix', /suffix “INC”/],
    ['SAFETY NETWORK TRAFFIC SIGNS', 'SAFETY NETWORK TRAFFIC SIGNS, INC', 'suffix', /suffix “INC”/],
    ['WANCO INC', 'WANCO, INC', 'punctuation', /punctuation/],
    ['OSCAR J. GARCIA, CPA', 'OSCAR J GARCIA C P A', 'punctuation', /punctuation/],
    ['ITRIA VENTURE/BIZ2CREDIT', 'BIZ2CREDIT/ITRIA VEN', 'reorder', /different order.*“VEN” \/ “VENTURE”/],
    ['R G MOORE & ASSOCIATES', 'RG MOORE & ASSOCIATES', 'punctuation', /punctuation/],
  ] as const)('%s ↔ %s (%s)', (x, y, kind, reason) => {
    const m = by(x, y)
    expect(m, `${x} ↔ ${y}`).toBeTruthy()
    expect(m!.kind).toBe(kind)
    expect(m!.reason).toMatch(reason)
    expect(m!.score).toBeGreaterThanOrEqual(0.9)
  })

  it('also catches truncation, containment and one-letter differences, each explained', () => {
    expect(by('HCTRA', 'HCTRA -TOLL COLLECTIONS')?.kind).toBe('contains')
    expect(by('FASTRAK', 'FAS TRAK INVOICE PROCESSING DEPARTMENT')?.kind).toBe('prefix')
    expect(by("FARMER'S LUMBER", 'FARMERS LUMBER & SUPPLY, INC')?.kind).toBe('contains')
    expect(by('WESTERN HIGHWAY TRAFFIC TRUCK PRODUCTS', 'WESTERN HIGHWAYS TRAFFIC TRUCK PRODUCTS')).toBeTruthy()
    for (const m of found) expect(m.reason.length).toBeGreaterThan(10)
  })

  it('does not propose obviously different vendors', () => {
    const got = pairs(found)
    for (const [x, y] of [
      ['405 EXPRESS LANES', '91 EXPRESS LANES'],
      ['SAMSARA - A - 005 (LEASE SERVICES)', 'SAMSARA - B - 006 (LEASE SERVICES)'],
      ['SAFETY NETWORK HOLDINGS, INC', 'SAFETY NETWORK, INC.'],
      ['SAFETY NETWORK TCS, INC', 'SAFETY NETWORK, INC.'],
      ['SAFETY NETWORK HOLDINGS, INC', 'SAFETY NETWORK TCS, INC'],
      ['SAFETY NETWORK TRAFFIC SIGNS', 'SAFETY NETWORK, INC.'],
      ['CITY OF FRESNO TRAFFIC ENGINEERING', 'CITY OF FRESNO UTILITIES (AUTO)'],
      ['CITY OF SELMA', 'CITY OF SALINAS'],
      ['CITY OF SELMA', 'CITY OF SANGER'],
      ['COMCAST/FRESNO/AUTOPAY', 'COMCAST/MODESTO/AUTOPAY'],
      ['PG&E FRESNO 6383-7 [AUTO 1650', 'PG&E MODESTO (AUTOPAY 1650)'],
      ['SETH JOHNSON (V)', 'RUSS JOHNSON'],
      ['SETH JOHNSON (V)', 'TRENT H JOHNSON (V)'],
      ['UNITED RENTALS', 'UNITED SITE SERVICES'],
      ['WESTERN HIGHWAYS', 'WESTERN HIGHWAYS SERVICE CENTERS - FRESNO'],
      ['WESTERN HIGHWAYS SERVICE CENTERS - FRESNO', 'WESTERN HIGHWAYS TEXAS SERVICE CENTERS'],
      ['CASH', 'CALIFORNIA CHECK CASHING (CORP)'],
      ['UPS', 'ULINE'],
      ['TEG SAFETY, INC.', 'JBC SAFETY PLASTIC, INC'],
      ['AT&T MOBILITY', 'AT&T ANAHEIM INTERNET(AUTO 1650)'],
      ['405 EXPRESS LANES', 'METRO EXPRESSLANES'],
    ]) expect(got, `${x} ↔ ${y}`).not.toContain(key(x, y))
    // the whole slice yields a short, reviewable list
    expect(found.length).toBeLessThanOrEqual(12)
  })

  it('is ordered strongest first, ids ordered a < b, one entry per pair, deterministic', () => {
    for (let i = 1; i < found.length; i++) expect(found[i - 1].score).toBeGreaterThanOrEqual(found[i].score)
    for (const m of found) expect(m.a < m.b).toBe(true)
    expect(new Set(found.map((m) => pairKey(m.a, m.b))).size).toBe(found.length)
    expect(suggestVendorMerges([...vendors].reverse())).toEqual(found)
  })
})

describe('suggestVendorMerges — options and inputs', () => {
  it('never proposes a dismissed pair', () => {
    const t = vendors.find((v) => v.canonicalName === 'TRAFFIX DEVICES')!.id
    const s = vendors.find((v) => v.canonicalName === 'TRAFFIX DEVICES INC')!.id
    const got = pairs(suggestVendorMerges(vendors, { dismissed: new Set([pairKey(s, t)]) }))
    expect(got).not.toContain(key('TRAFFIX DEVICES', 'TRAFFIX DEVICES INC'))
    expect(got).toContain(key('WANCO INC', 'WANCO, INC'))
  })

  it('compares every spelling a vendor owns (a merged vendor still matches through its other spelling)', () => {
    const list: CmrVendorMatchInput[] = [
      { id: 'a', canonicalName: 'Traffix (renamed)', spellings: ['TRAFFIX DEVICES'] },
      { id: 'b', canonicalName: 'TRAFFIX DEVICES INC', spellings: ['TRAFFIX DEVICES INC'] },
    ]
    expect(suggestVendorMerges(list)).toMatchObject([{ a: 'a', b: 'b', kind: 'suffix' }])
  })

  it('respects the limit and handles empty / punctuation-only names', () => {
    expect(suggestVendorMerges(vendors, { limit: 2 })).toHaveLength(2)
    expect(suggestVendorMerges([{ id: 'x', canonicalName: '...', spellings: [] }, { id: 'y', canonicalName: '---', spellings: [] }])).toEqual([])
    expect(suggestVendorMerges([])).toEqual([])
  })

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(vendors))
    suggestVendorMerges(vendors)
    expect(vendors).toEqual(copy)
  })
})

describe('vendorTokens / editDistance', () => {
  it('folds punctuation, joins initials and in-word &/apostrophes, expands abbreviations', () => {
    expect(vendorTokens('OSCAR J. GARCIA, C.P.A.')).toEqual(['OSCAR', 'J', 'GARCIA', 'CPA'])
    expect(vendorTokens('R G MOORE & ASSOCIATES')).toEqual(['RG', 'MOORE', 'AND', 'ASSOCIATES'])
    expect(vendorTokens("FARMER'S LUMBER")).toEqual(['FARMERS', 'LUMBER'])
    expect(vendorTokens('AT&T MOBILITY')).toEqual(['ATT', 'MOBILITY'])
    expect(vendorTokens('CALIFORNIA DEPT OF TAX')).toEqual(['CALIFORNIA', 'DEPARTMENT', 'OF', 'TAX'])
    expect(vendorTokens('  ')).toEqual([])
  })

  it('edit distance with an early exit', () => {
    expect(editDistance('HIGHWAY', 'HIGHWAYS')).toBe(1)
    expect(editDistance('KITTEN', 'SITTING')).toBe(3)
    expect(editDistance('ABCDEFGH', 'ZZZZZZZZ', 2)).toBe(3)
    expect(editDistance('SAME', 'SAME')).toBe(0)
  })
})
