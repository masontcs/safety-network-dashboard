import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * This bug shipped twice — price-list tier cells, then item variation adjustments — so
 * guard it structurally instead of trusting review. Any <input> whose value is a cents
 * amount formatted with .toFixed() reformats mid-typing: the value snaps after one digit
 * and the caret jumps. Money ENTRY must go through MoneyInput, which holds raw text while
 * focused. (Read-only display with .toFixed() is fine — this only looks inside <input>.)
 */
const dir = join(process.cwd(), 'components/billing')
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx') && f !== 'MoneyInput.tsx')

describe('money entry fields use MoneyInput', () => {
  it('has no <input> that formats cents on every render', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      // Each <input ...> element, including multi-line ones.
      for (const m of src.matchAll(/<input\b[\s\S]*?\/?>/g)) {
        const tag = m[0]
        if (/value=\{[^}]*toFixed\(/.test(tag)) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${f}:${line}`)
        }
      }
    }
    expect(offenders, `Use MoneyInput for money entry: ${offenders.join(', ')}`).toEqual([])
  })
})
