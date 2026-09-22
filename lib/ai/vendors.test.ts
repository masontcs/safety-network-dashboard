import { describe, it, expect, vi, afterEach } from 'vitest'
import { reviewVendorDuplicates } from './vendors'

/**
 * AP Phase 3b — the optional AI review of duplicate vendors. Advisory only: it returns verdicts
 * and extra pairs by VENDOR ID, validated against what it was given; anything malformed is
 * dropped, and any failure means "unavailable" (the page then shows the rule-based list alone).
 * No network here — a stand-in client.
 */

const input = {
  vendors: [
    { id: 'v-a', name: 'TRAFFIX DEVICES', spellings: ['TRAFFIX DEVICES'], accounts: ['STS'] },
    { id: 'v-b', name: 'TRAFFIX DEVICES INC', spellings: ['TRAFFIX DEVICES INC'], accounts: ['Holdings'] },
    { id: 'v-c', name: 'HCTRA', spellings: ['HCTRA'], accounts: ['TCS'] },
    { id: 'v-d', name: 'HARRIS COUNTY TOLL ROAD AUTHORITY', spellings: ['HARRIS COUNTY TOLL ROAD AUTHORITY'], accounts: ['Holdings'] },
  ],
  pairs: [{ a: 'v-a', b: 'v-b', reason: 'Same name apart from the company suffix “INC”.' }],
}

const client = (text: string | Error) => ({
  messages: {
    create: vi.fn(async () => {
      if (text instanceof Error) throw text
      return { content: [{ type: 'text', text }] }
    }),
  },
})

afterEach(() => { vi.unstubAllEnvs() })

describe('reviewVendorDuplicates', () => {
  it('maps verdicts and additional pairs back to vendor ids, and sends names + accounts only', async () => {
    // vendor numbering: the pair's vendors first (1, 2), then the rest (3, 4)
    const c = client('```json\n{"reviews":[{"pair":1,"verdict":"same","note":"Same maker of traffic devices."}],"additional":[{"a":3,"b":4,"note":"HCTRA is the Harris County Toll Road Authority."}]}\n```')
    const r = await reviewVendorDuplicates(input, c as never)
    expect(r.status).toBe('used')
    if (r.status !== 'used') return
    expect([...r.reviews]).toEqual([[0, { verdict: 'same', note: 'Same maker of traffic devices.' }]])
    expect(r.additional).toEqual([{ a: 'v-c', b: 'v-d', note: 'HCTRA is the Harris County Toll Road Authority.' }])
    const prompt = (c.messages.create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content
    expect(prompt).toContain('1. TRAFFIX DEVICES [STS]')
    expect(prompt).toContain('P1: 1 ↔ 2')
    expect(prompt).not.toMatch(/\$|cents|owed/i)
  })

  it('drops malformed entries: unknown pair numbers or vendors, bad verdicts, self-pairs, repeats of a proposed pair', async () => {
    const c = client(JSON.stringify({
      reviews: [{ pair: 9, verdict: 'same' }, { pair: 1, verdict: 'maybe' }, { pair: '1', verdict: 'same' }],
      additional: [{ a: 1, b: 2, note: 'dup of P1' }, { a: 3, b: 3 }, { a: 3, b: 99 }, { a: 'x', b: 4 }],
    }))
    const r = await reviewVendorDuplicates(input, c as never)
    expect(r).toEqual({ status: 'used', reviews: new Map(), additional: [] })
  })

  it('any failure is "unavailable", never an exception: bad JSON, API error, no key', async () => {
    expect((await reviewVendorDuplicates(input, client('not json') as never)).status).toBe('unavailable')
    expect((await reviewVendorDuplicates(input, client(new Error('529 overloaded')) as never)).status).toBe('unavailable')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const r = await reviewVendorDuplicates(input)
    expect(r).toEqual({ status: 'unavailable', message: expect.stringMatching(/not configured/) })
  })
})
