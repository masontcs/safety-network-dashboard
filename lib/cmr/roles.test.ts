import { describe, it, expect } from 'vitest'
import { cmrNavFor, CMR_CONTROLLER_PATHS, isCmrRole } from '@/lib/cmr/roles'

const hrefs = (role: Parameters<typeof cmrNavFor>[0]) => cmrNavFor(role).flatMap((g) => g.items.map((i) => i.href))

describe('CMR nav gating', () => {
  it('controller sees every section including Settings', () => {
    expect(cmrNavFor('controller').map((g) => g.label)).toEqual(['Ledger', 'Vendors', 'Settings'])
    expect(hrefs('controller')).toEqual(expect.arrayContaining(['/cmr/access', '/cmr/accounts']))
  })

  it('requester and viewer see read views only — no Settings', () => {
    for (const role of ['requester', 'viewer'] as const) {
      expect(cmrNavFor(role).map((g) => g.label)).toEqual(['Ledger', 'Vendors'])
      for (const p of CMR_CONTROLLER_PATHS) expect(hrefs(role)).not.toContain(p)
    }
  })

  it('an unknown role gets nothing (fail closed)', () => {
    expect(cmrNavFor('admin' as unknown as 'viewer')).toEqual([])
  })

  it('isCmrRole only accepts the three CMR roles', () => {
    expect(['controller', 'requester', 'viewer'].every(isCmrRole)).toBe(true)
    expect(['admin', 'executive', '', null, undefined, 1].some(isCmrRole)).toBe(false)
  })
})
