import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cmr/vendors (AP Phase 3a) is readable by EVERY CMR role — but only with a cmr_access grant.
 * The (secure) layout and the page both bounce everyone else; a platform admin without a grant
 * is treated like anyone else.
 */

const h = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/cmr/session', () => ({ getCmrPageContext: async () => h.ctx }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }) },
  usePathname: () => '/cmr/vendors',
}))
vi.mock('@/components/cmr/CmrVendorsClient', () => ({ default: () => null }))
vi.mock('@/components/cmr/CmrShell', () => ({ default: ({ children }: { children: unknown }) => children }))

import CmrVendorsPage from './page'
import CmrSecureLayout from '../layout'

const where = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null } catch (e) { return (e as { to?: string }).to ?? 'threw' }
}
const ok = (role: string) => ({ ok: true, userId: 'u', role, displayName: 'X' })

beforeEach(() => { h.ctx = null })

describe('/cmr/vendors page gate', () => {
  for (const role of ['controller', 'requester', 'viewer']) {
    it(`${role} can open it`, async () => {
      h.ctx = ok(role)
      expect(await where(() => CmrSecureLayout({ children: null }))).toBeNull()
      expect(await where(() => CmrVendorsPage())).toBeNull()
    })
  }

  it('no grant (admin included) → /cmr/no-access; no session → /login', async () => {
    h.ctx = { ok: false, status: 403 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/cmr/no-access')
    expect(await where(() => CmrVendorsPage())).toBe('/cmr/no-access')
    h.ctx = { ok: false, status: 401 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/login')
    expect(await where(() => CmrVendorsPage())).toBe('/login')
  })

  it('the sidebar Vendors group links it for every role, after Accounts Payable; it is not Controller-only', async () => {
    const { CMR_CONTROLLER_PATHS, cmrNavFor } = await import('@/lib/cmr/roles')
    for (const role of ['controller', 'requester', 'viewer'] as const) {
      const g = cmrNavFor(role).find((x) => x.label === 'Vendors')
      expect(g?.items.map((i) => i.label)).toEqual(['Recurring', 'Requests', 'Accounts Payable', 'Vendors'])
      expect(g?.items[3]).toMatchObject({ href: '/cmr/vendors', icon: 'vendors' })
    }
    expect(CMR_CONTROLLER_PATHS.some((p) => '/cmr/vendors'.startsWith(p))).toBe(false)
  })
})
