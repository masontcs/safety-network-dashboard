import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cmr (the Daily ledger) is readable by EVERY CMR role — but only with a cmr_access grant.
 * The (secure) layout and the page both bounce everyone else; a platform admin without a grant
 * is treated like anyone else. Writes are gated by /api/cmr/ledger/*.
 */

const h = vi.hoisted(() => ({ ctx: null as unknown, props: null as unknown }))
vi.mock('@/lib/cmr/session', () => ({ getCmrPageContext: async () => h.ctx }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }) },
  usePathname: () => '/cmr',
}))
vi.mock('@/components/cmr/CmrLedgerClient', () => ({
  default: (props: unknown) => { h.props = props; return null },
}))
vi.mock('@/components/cmr/CmrShell', () => ({ default: ({ children }: { children: unknown }) => children }))
vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

import CmrDailyLedgerPage from './page'
import CmrSecureLayout from './layout'

const where = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null } catch (e) { return (e as { to?: string }).to ?? 'threw' }
}
const ok = (role: string) => ({ ok: true, userId: 'u', role, displayName: 'X' })
// Render the returned element's props (the page returns <CmrLedgerClient .../>).
const propsOf = async (searchParams?: Record<string, string | string[]>) => {
  const el = (await CmrDailyLedgerPage({ searchParams })) as { props: unknown }
  return el.props
}

beforeEach(() => { h.ctx = null; h.props = null })

describe('/cmr daily ledger page gate', () => {
  for (const role of ['controller', 'requester', 'viewer']) {
    it(`${role} can open it`, async () => {
      h.ctx = ok(role)
      expect(await where(() => CmrSecureLayout({ children: null }))).toBeNull()
      expect(await where(() => CmrDailyLedgerPage({}))).toBeNull()
    })
  }

  it('no grant (admin included) → /cmr/no-access; no session → /login', async () => {
    h.ctx = { ok: false, status: 403 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/cmr/no-access')
    expect(await where(() => CmrDailyLedgerPage({}))).toBe('/cmr/no-access')
    h.ctx = { ok: false, status: 401 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/login')
    expect(await where(() => CmrDailyLedgerPage({}))).toBe('/login')
  })

  it('defaults to Pacific today + AM; honours valid ?date/?period, ignores bad ones', async () => {
    h.ctx = ok('viewer')
    expect(await propsOf()).toEqual({ initialDate: '2026-09-16', initialPeriod: 'am' })
    expect(await propsOf({ date: '2026-08-01', period: 'pm' })).toEqual({ initialDate: '2026-08-01', initialPeriod: 'pm' })
    expect(await propsOf({ date: '2026-02-31', period: 'PM' })).toEqual({ initialDate: '2026-09-16', initialPeriod: 'am' })
    expect(await propsOf({ date: ['2026-08-01'], period: ['pm'] })).toEqual({ initialDate: '2026-09-16', initialPeriod: 'am' })
  })

  it('the sidebar links the Daily ledger at /cmr for every role', async () => {
    const { cmrNavFor } = await import('@/lib/cmr/roles')
    for (const role of ['controller', 'requester', 'viewer'] as const) {
      expect(cmrNavFor(role).flatMap((g) => g.items).find((i) => i.href === '/cmr')?.label).toBe('Daily ledger')
    }
  })
})
