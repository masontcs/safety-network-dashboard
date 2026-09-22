import Anthropic from '@anthropic-ai/sdk'
import { buildVendorDuplicatePrompt } from './prompts'

/**
 * FEATURE 3 — CMR AP Phase 3b: an ADVISORY second opinion on possible duplicate vendors.
 *
 * Only called when a Cash Ledger Controller asks for it (the "Ask AI to review" button on the
 * Vendors page → GET /api/cmr/vendors/suggestions?ai=1). It never writes anything: its verdicts
 * and extra pairs only annotate the review list, where the Controller confirms each merge (or
 * dismisses the pair). If the key is missing, the call fails, times out or returns anything
 * unexpected, the caller simply shows the rule-based suggestions on their own.
 *
 * Server only (API routes), like the rest of /lib/ai.
 */

const MODEL = 'claude-sonnet-4-20250514'
const TIMEOUT_MS = 25_000
/** Beyond this many vendors only the proposed pairs are reviewed (the prompt stays small). */
const MAX_VENDORS_LISTED = 600
const MAX_ADDITIONAL = 15

export type VendorAiVerdict = 'same' | 'different' | 'unsure'

export interface VendorAiInput {
  vendors: Array<{ id: string; name: string; spellings: string[]; accounts: string[] }>
  /** The rule-based pairs, by vendor id. */
  pairs: Array<{ a: string; b: string; reason: string }>
}

export type VendorAiResult =
  | {
      status: 'used'
      /** Keyed by the index into input.pairs. */
      reviews: Map<number, { verdict: VendorAiVerdict; note: string }>
      additional: Array<{ a: string; b: string; note: string }>
    }
  | { status: 'unavailable'; message: string }

const VERDICTS = new Set<VendorAiVerdict>(['same', 'different', 'unsure'])
const clean = (s: unknown, max = 160) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export async function reviewVendorDuplicates(input: VendorAiInput, client?: Pick<Anthropic, 'messages'>): Promise<VendorAiResult> {
  if (!client && !process.env.ANTHROPIC_API_KEY) {
    return { status: 'unavailable', message: 'AI review is not configured (no ANTHROPIC_API_KEY).' }
  }
  try {
    // Number the vendors: every proposed pair's vendors first, then the rest (up to the cap).
    const inPairs = new Set(input.pairs.flatMap((p) => [p.a, p.b]))
    const ordered = [...input.vendors.filter((v) => inPairs.has(v.id)), ...input.vendors.filter((v) => !inPairs.has(v.id))]
    const listed = ordered.slice(0, Math.max(MAX_VENDORS_LISTED, inPairs.size))
    const num = new Map(listed.map((v, i) => [v.id, i + 1]))
    const byNum = new Map(listed.map((v, i) => [i + 1, v.id]))

    const prompt = buildVendorDuplicatePrompt(
      listed.map((v, i) => ({ n: i + 1, name: v.name, spellings: v.spellings, accounts: v.accounts })),
      input.pairs.map((p, i) => ({ p: i + 1, a: num.get(p.a)!, b: num.get(p.b)!, reason: p.reason })),
    )

    const ai = client ?? new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 })
    const message = await ai.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = message.content[0]
    if (!block || block.type !== 'text') return { status: 'unavailable', message: 'The AI review returned no text.' }
    const parsed: unknown = JSON.parse(block.text.replace(/```json|```/g, '').trim())
    if (typeof parsed !== 'object' || parsed === null) return { status: 'unavailable', message: 'The AI review could not be read.' }
    const obj = parsed as Record<string, unknown>

    const reviews = new Map<number, { verdict: VendorAiVerdict; note: string }>()
    for (const r of Array.isArray(obj.reviews) ? obj.reviews : []) {
      const x = r as Record<string, unknown>
      const i = typeof x.pair === 'number' && Number.isInteger(x.pair) ? x.pair - 1 : -1
      const verdict = x.verdict as VendorAiVerdict
      if (i < 0 || i >= input.pairs.length || !VERDICTS.has(verdict) || reviews.has(i)) continue
      reviews.set(i, { verdict, note: clean(x.note) })
    }

    const known = new Set(input.pairs.map((p) => [p.a, p.b].sort().join('|')))
    const additional: Array<{ a: string; b: string; note: string }> = []
    for (const r of Array.isArray(obj.additional) ? obj.additional : []) {
      if (additional.length >= MAX_ADDITIONAL) break
      const x = r as Record<string, unknown>
      const a = typeof x.a === 'number' ? byNum.get(x.a) : undefined
      const b = typeof x.b === 'number' ? byNum.get(x.b) : undefined
      if (!a || !b || a === b) continue
      const key = [a, b].sort().join('|')
      if (known.has(key)) continue
      known.add(key)
      additional.push({ a, b, note: clean(x.note) || 'Suggested by the AI review.' })
    }
    return { status: 'used', reviews, additional }
  } catch (err) {
    console.error('[AI] reviewVendorDuplicates failed:', err)
    return { status: 'unavailable', message: 'The AI review is unavailable right now — showing the rule-based suggestions only.' }
  }
}
