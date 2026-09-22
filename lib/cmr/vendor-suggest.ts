/**
 * SN Cash Ledger (CMR) — AP Phase 3b: the duplicate-vendor SUGGESTION matcher.
 *
 * Deterministic and explainable. Given the canonical vendors (each with every QuickBooks spelling
 * it owns), it proposes PAIRS that look like the same real-world vendor, each with a short reason
 * a Controller can check at a glance. It never writes anything and never merges anything:
 * matching stays fully manual — a Controller confirms every merge (cmr_merge_vendors) or
 * dismisses the pair (cmr_vendor_merge_dismissals).
 *
 * The tests, strongest first (a pair is reported under the first one that holds for any of the
 * two vendors' spellings):
 *   1. punctuation   — identical once punctuation and spacing are ignored
 *                      ("WANCO INC" ↔ "WANCO, INC", "OSCAR J. GARCIA, CPA" ↔ "OSCAR J GARCIA C P A")
 *   2. suffix        — identical once a trailing company suffix is dropped (INC, LLC, CORP, CO,
 *                      CPA, …) ("TRAFFIX DEVICES" ↔ "TRAFFIX DEVICES INC")
 *   3. reorder       — the same words in another order, a word maybe cut short
 *                      ("ITRIA VENTURE/BIZ2CREDIT" ↔ "BIZ2CREDIT/ITRIA VEN")
 *   4. spelling      — one or two letters apart (normalized edit distance), never when a number or
 *                      a single-letter word differs ("…HIGHWAY TRAFFIC…" ↔ "…HIGHWAYS TRAFFIC…")
 *   5. prefix        — one name, run together, is how the other starts ("FASTRAK" ↔ "FAS TRAK …")
 *   6. contains      — every word of one is in the other and they share a DISTINCTIVE word
 *                      ("HCTRA" ↔ "HCTRA -TOLL COLLECTIONS")
 *   7. words         — most of their distinctive words are shared (IDF-weighted overlap)
 *
 * "Distinctive" is measured over the whole vendor list (inverse document frequency): a word that
 * appears in many vendor names — CITY, SAFETY, NETWORK, WESTERN — counts for little, so
 * "CITY OF FRESNO" and "CITY OF SELMA", or "SAFETY NETWORK, INC." and "SAFETY NETWORK
 * HOLDINGS, INC", are not proposed. A pair differing only in a number (91 vs 405 EXPRESS LANES,
 * SAMSARA - A - 005 vs - B - 006) is never proposed by the spelling test.
 *
 * Dependency-free, so it runs in the route and in tests alike.
 */

export type CmrVendorMatchKind = 'punctuation' | 'suffix' | 'reorder' | 'spelling' | 'prefix' | 'contains' | 'words'

export interface CmrVendorMatchInput {
  id: string
  canonicalName: string
  /** Every QuickBooks spelling (alias raw_name) the vendor owns. The canonical name is added. */
  spellings: string[]
}

export interface CmrVendorMatch {
  /** The two vendor ids, ordered a < b (the same order cmr_vendor_merge_dismissals stores). */
  a: string
  b: string
  kind: CmrVendorMatchKind
  /** 0–1, higher = more alike. Pairs are returned highest first. */
  score: number
  /** One short sentence for the Controller. */
  reason: string
}

/** The pair key used for dismissals and de-duplication (ids ordered, as stored). */
export const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`)
export const orderedPair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x])

// ── tokens ────────────────────────────────────────────────────────────────────

/** Trailing company-form words: dropped for the "suffix" test and for word comparisons. */
const SUFFIXES = new Set([
  'INC', 'INCORPORATED', 'LLC', 'LLP', 'LP', 'LTD', 'LIMITED', 'CORP', 'CORPORATION', 'CO', 'COMPANY',
  'PC', 'PLLC', 'PA', 'CPA', 'CPAS', 'DBA', 'ENTERPRISES',
])
/** Words that carry no identity. */
const STOP = new Set(['AND', 'THE', 'OF', 'FOR', 'DBA'])
/** Common QuickBooks abbreviations, compared as the full word. */
const ABBREV: Record<string, string> = {
  DEPT: 'DEPARTMENT', ASSOC: 'ASSOCIATES', ASSOCS: 'ASSOCIATES', SVC: 'SERVICES', SVCS: 'SERVICES',
  SERV: 'SERVICES', MFG: 'MANUFACTURING', NATL: 'NATIONAL', INTL: 'INTERNATIONAL', BROS: 'BROTHERS',
  CTR: 'CENTER', EQUIP: 'EQUIPMENT', MGMT: 'MANAGEMENT', SYS: 'SYSTEMS', DIST: 'DISTRICT',
  ADMIN: 'ADMINISTRATION', FIN: 'FINANCIAL', INS: 'INSURANCE', TRANSP: 'TRANSPORTATION',
}

/**
 * Upper-case words: "&" between words → AND; an apostrophe or "&" INSIDE a word joins it
 * (FARMER'S → FARMERS, AT&T → ATT); every other non-alphanumeric is a word break; runs of
 * single letters join (C P A → CPA, R G → RG); abbreviations expand (DEPT → DEPARTMENT).
 */
export function vendorTokens(name: string): string[] {
  const up = name
    .toUpperCase()
    .replace(/([A-Z0-9])['’&]+(?=[A-Z0-9])/g, '$1')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
  if (!up) return []
  const raw = up.split(' ')
  const out: string[] = []
  let run = ''
  for (const t of raw) {
    if (t.length === 1 && /[A-Z]/.test(t)) { run += t; continue }
    if (run) { out.push(run); run = '' }
    out.push(t)
  }
  if (run) out.push(run)
  return out.map((t) => ABBREV[t] ?? t)
}

/** The tokens without trailing company suffixes (and a dangling AND/THE), never emptied. */
function coreOf(tokens: string[]): { core: string[]; suffixes: string[] } {
  const core = [...tokens]
  const suffixes: string[] = []
  while (core.length > 1 && (SUFFIXES.has(core[core.length - 1]) || STOP.has(core[core.length - 1]))) {
    const t = core.pop()!
    if (SUFFIXES.has(t)) suffixes.unshift(t)
  }
  if (core.length > 1 && core[0] === 'THE') core.shift()
  return { core, suffixes }
}

interface Spelling {
  text: string
  tokens: string[]
  compact: string
  core: string[]
  coreKey: string
  coreCompact: string
  suffixes: string[]
  /** Identity words of the core (no stop words). */
  words: string[]
}

function spellingOf(text: string): Spelling | null {
  const tokens = vendorTokens(text)
  if (!tokens.length) return null
  const { core, suffixes } = coreOf(tokens)
  const words = core.filter((t) => !STOP.has(t))
  return {
    text,
    tokens,
    compact: tokens.join(''),
    core,
    coreKey: core.join(' '),
    coreCompact: core.join(''),
    suffixes,
    words: words.length ? words : core,
  }
}

// ── measures ──────────────────────────────────────────────────────────────────

/** Levenshtein distance, with an early exit once it exceeds `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** Two words match when equal, or when one (3+ letters) is how the other starts — QuickBooks cuts names short. */
const wordMatch = (x: string, y: string) =>
  x === y || (Math.min(x.length, y.length) >= 3 && !/\d/.test(x + y) && (x.startsWith(y) || y.startsWith(x)))

/** A one-to-one matching of all of `a`'s words to all of `b`'s (same count), exact first. */
function reorderMatch(a: string[], b: string[]): { ok: boolean; abbreviated: [string, string][] } {
  if (a.length !== b.length || a.length < 2) return { ok: false, abbreviated: [] }
  const left = [...b]
  const pending: string[] = []
  for (const w of a) {
    const i = left.indexOf(w)
    if (i >= 0) left.splice(i, 1)
    else pending.push(w)
  }
  const abbreviated: [string, string][] = []
  for (const w of pending) {
    const i = left.findIndex((x) => wordMatch(w, x))
    if (i < 0) return { ok: false, abbreviated: [] }
    abbreviated.push(w.length <= left[i].length ? [w, left[i]] : [left[i], w])
    left.splice(i, 1)
  }
  return { ok: true, abbreviated }
}

const sameSet = (x: string[], y: string[]) => {
  const a = [...new Set(x)].sort()
  const b = [...new Set(y)].sort()
  return a.length === b.length && a.every((v, i) => v === b[i])
}
const hasDigit = (t: string) => /\d/.test(t)

const fmtList = (xs: string[]) => xs.map((x) => `“${x}”`).join(', ')

interface Found {
  kind: CmrVendorMatchKind
  score: number
  reason: string
}

const RANK: Record<CmrVendorMatchKind, number> = {
  punctuation: 7, suffix: 6, reorder: 5, spelling: 4, prefix: 3, contains: 2, words: 1,
}

/** The strongest test two spellings pass, or null. `idf` weighs words; `df` counts vendors per word. */
function compare(x: Spelling, y: Spelling, idf: (w: string) => number, df: (w: string) => number): Found | null {
  // 1. punctuation / spacing only
  if (x.compact === y.compact) {
    return { kind: 'punctuation', score: 0.99, reason: 'Same name apart from punctuation and spacing.' }
  }
  // 2. a company suffix
  if (x.coreCompact === y.coreCompact && x.coreCompact.length >= 3) {
    const diff = [...x.suffixes.filter((s) => !y.suffixes.includes(s)), ...y.suffixes.filter((s) => !x.suffixes.includes(s))]
    const what = diff.length ? `the company suffix ${fmtList([...new Set(diff)])}` : 'a company suffix'
    return { kind: 'suffix', score: 0.97, reason: `Same name apart from ${what}.` }
  }
  // 3. same words, another order (a word maybe cut short)
  const ro = reorderMatch(x.words, y.words)
  if (ro.ok && x.words.join(' ') !== y.words.join(' ')) {
    if (!ro.abbreviated.length) return { kind: 'reorder', score: 0.94, reason: 'Same words in a different order.' }
    const cut = ro.abbreviated.map(([sh, lg]) => `“${sh}” / “${lg}”`).join(', ')
    const moved = !sameOrder(x.words, y.words)
    return {
      kind: 'reorder',
      score: 0.9,
      reason: `Same words${moved ? ' in a different order' : ''}, one written shorter (${cut}).`,
    }
  }
  // 4. one or two letters apart — never when a number or a lone letter differs
  const minLen = Math.min(x.coreKey.length, y.coreKey.length)
  if (minLen >= 5) {
    const max = minLen >= 10 ? 2 : 1
    const d = editDistance(x.coreKey, y.coreKey, max)
    const guard =
      sameSet(x.core.filter(hasDigit), y.core.filter(hasDigit)) &&
      sameSet(x.core.filter((t) => t.length === 1), y.core.filter((t) => t.length === 1))
    if (d >= 1 && d <= max && guard) {
      return {
        kind: 'spelling',
        score: Math.round((0.9 - (d - 1) * 0.04) * 100) / 100,
        reason: `Spelled almost the same (${d === 1 ? 'one letter differs' : 'two letters differ'}).`,
      }
    }
  }
  // 5. one, run together, is how the other starts ("FASTRAK" / "FAS TRAK INVOICE …") — only when
  //    that is not simply the other's first words (that is the "contains" test)
  const [short, long] = x.coreCompact.length <= y.coreCompact.length ? [x, y] : [y, x]
  if (
    short.coreCompact.length >= 6 &&
    long.coreCompact.startsWith(short.coreCompact) &&
    !short.words.every((w) => long.words.includes(w))
  ) {
    return { kind: 'prefix', score: 0.8, reason: 'One name is how the other begins, ignoring spaces and punctuation.' }
  }
  // 6/7. shared words, weighted by how distinctive they are across all vendors
  const xs = new Set(x.words)
  const ys = new Set(y.words)
  const shared = [...xs].filter((w) => ys.has(w))
  if (!shared.length) return null
  const w = (ws: Iterable<string>) => [...ws].reduce((s, t) => s + idf(t), 0)
  const union = new Set([...xs, ...ys])
  const jaccard = w(shared) / w(union)
  const distinctive = shared.filter((t) => df(t) <= 3 && t.length >= 3 && !hasDigit(t))
  const [small, big] = xs.size <= ys.size ? [xs, ys] : [ys, xs]
  const contained = [...small].every((t) => big.has(t))
  if (contained && distinctive.length && (small.size >= 2 || [...small][0].length >= 4)) {
    return {
      kind: 'contains',
      score: Math.round(Math.min(0.85, 0.7 + jaccard * 0.2) * 100) / 100,
      reason: `Every word of the shorter name is in the longer one, including ${fmtList(distinctive.slice(0, 2))}.`,
    }
  }
  if (jaccard >= 0.7 && shared.length >= 2 && distinctive.length) {
    return {
      kind: 'words',
      score: Math.round(Math.min(0.8, jaccard) * 100) / 100,
      reason: `Share most of their distinctive words (${fmtList(shared.slice(0, 3))}).`,
    }
  }
  return null
}

const sameOrder = (a: string[], b: string[]) => a.every((w, i) => wordMatch(w, b[i]))

// ── the matcher ───────────────────────────────────────────────────────────────

export interface SuggestOptions {
  /** Pair keys (pairKey) the Controller dismissed — never proposed. */
  dismissed?: Set<string>
  /** At most this many pairs (highest score first). Default 200. */
  limit?: number
}

/**
 * Candidate duplicate pairs over the given vendors, strongest first. Pure: reads its input only.
 */
export function suggestVendorMerges(vendors: CmrVendorMatchInput[], opts: SuggestOptions = {}): CmrVendorMatch[] {
  const dismissed = opts.dismissed ?? new Set<string>()
  const limit = opts.limit ?? 200

  const prepared = vendors.map((v) => {
    const texts = [...new Set([v.canonicalName, ...v.spellings].map((t) => t.trim()).filter(Boolean))]
    const sp = texts.map(spellingOf).filter((s): s is Spelling => s !== null)
    return { id: v.id, sp, words: new Set(sp.flatMap((s) => s.words)) }
  })

  // document frequency: in how many VENDORS does a word appear
  const dfMap = new Map<string, number>()
  for (const p of prepared) for (const w of p.words) dfMap.set(w, (dfMap.get(w) ?? 0) + 1)
  const n = Math.max(prepared.length, 2)
  const df = (w: string) => dfMap.get(w) ?? 1
  const idf = (w: string) => Math.log(1 + n / df(w))

  const out: CmrVendorMatch[] = []
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const p = prepared[i]
      const q = prepared[j]
      if (p.id === q.id) continue
      const key = pairKey(p.id, q.id)
      if (dismissed.has(key)) continue
      let best: Found | null = null
      for (const x of p.sp) {
        for (const y of q.sp) {
          const f = compare(x, y, idf, df)
          if (f && (!best || RANK[f.kind] > RANK[best.kind] || (RANK[f.kind] === RANK[best.kind] && f.score > best.score))) best = f
        }
      }
      if (best) {
        const [a, b] = orderedPair(p.id, q.id)
        out.push({ a, b, ...best })
      }
    }
  }
  out.sort((m, k) => k.score - m.score || RANK[k.kind] - RANK[m.kind] || (m.a + m.b < k.a + k.b ? -1 : 1))
  return out.slice(0, limit)
}
