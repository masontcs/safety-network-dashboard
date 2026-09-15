import { describe, it, expect } from 'vitest'
import { compareAccounts, findActiveNameClash, parseAccountName, parseAccountType } from './accounts'

describe('cmr accounts helpers', () => {
  it('parseAccountName trims, collapses spaces and enforces 1..60', () => {
    expect(parseAccountName('  WH  WY ')).toEqual({ ok: true, value: 'WH WY' })
    expect(parseAccountName('').ok).toBe(false)
    expect(parseAccountName(null).ok).toBe(false)
    expect(parseAccountName('a'.repeat(60)).ok).toBe(true)
    expect(parseAccountName('a'.repeat(61)).ok).toBe(false)
  })

  it('parseAccountType maps blank to null and enforces ≤40', () => {
    expect(parseAccountType(undefined)).toEqual({ ok: true, value: null })
    expect(parseAccountType('  ')).toEqual({ ok: true, value: null })
    expect(parseAccountType(' Payroll ')).toEqual({ ok: true, value: 'Payroll' })
    expect(parseAccountType('b'.repeat(41)).ok).toBe(false)
    expect(parseAccountType(3).ok).toBe(false)
  })

  it('findActiveNameClash ignores case, inactive rows and itself', () => {
    const rows = [
      { id: '1', name: 'TCS', active: true },
      { id: '2', name: 'Old', active: false },
    ]
    expect(findActiveNameClash(rows, ' tcs ')?.id).toBe('1')
    expect(findActiveNameClash(rows, 'TCS', '1')).toBeNull()
    expect(findActiveNameClash(rows, 'old')).toBeNull()
  })

  it('compareAccounts sorts by sort_order, then name', () => {
    const list = [
      { id: 'c', name: 'b', sortOrder: 1 },
      { id: 'a', name: 'Z', sortOrder: 0 },
      { id: 'b', name: 'a', sortOrder: 1 },
    ].sort(compareAccounts)
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})
