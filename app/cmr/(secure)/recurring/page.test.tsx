import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cmr/recurring is readable by EVERY CMR role (unlike Accounts/Access) — but only with a
 * cmr_access grant. The (secure) layout and the page both bounce everyone else; a platform
 * admin without a grant is treated like anyone else. Writes are gated by the API.
 */

const h = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/cmr/session', () => ({ getCmrPageContext: async () => h.ctx }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }) },
  usePathname: () => '/cmr/recurring',
}))
vi.mock('@/components/cmr/CmrRecurringClient', () => ({ default: () => null }))
vi.mock('@/components/cmr/CmrShell', () => ({ default: ({ children }: { children: unknown }) => children }))

import CmrRecurringPage from './page'
import CmrSecureLayout from '../layout'

const where = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null } catch (e) { return (e as { to?: string }).to ?? 'threw' }
}
const ok = (role: string) => ({ ok: true, userId: 'u', role, displayName: 'X' })

beforeEach(() => { h.ctx = null })

describe('/cmr/recurring page gate', () => {
  for (const role of ['controller', 'requester', 'viewer']) {
    it(`${role} can open it`, async () => {
      h.ctx = ok(role)
      expect(await where(() => CmrSecureLayout({ children: null }))).toBeNull()
      expect(await where(() => CmrRecurringPage())).toBeNull()
    })
  }

  it('no grant (admin included) → /cmr/no-access; no session → /login', async () => {
    h.ctx = { ok: false, status: 403 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/cmr/no-access')
    expect(await where(() => CmrRecurringPage())).toBe('/cmr/no-access')
    h.ctx = { ok: false, status: 401 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/login')
    expect(await where(() => CmrRecurringPage())).toBe('/login')
  })

  it('the sidebar links Recurring for every role', async () => {
    const { cmrNavFor } = await import('@/lib/cmr/roles')
    for (const role of ['controller', 'requester', 'viewer'] as const) {
      expect(cmrNavFor(role).flatMap((g) => g.items).some((i) => i.href === '/cmr/recurring')).toBe(true)
    }
  })
})
