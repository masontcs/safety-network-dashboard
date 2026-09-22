import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cmr/ap is readable by EVERY CMR role (unlike Accounts/Access) — but only with a
 * cmr_access grant. The (secure) layout and the page both bounce everyone else; a platform
 * admin without a grant is treated like anyone else. Writes are gated by the API.
 */

const h = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/cmr/session', () => ({ getCmrPageContext: async () => h.ctx }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }) },
  usePathname: () => '/cmr/ap',
}))
vi.mock('@/components/cmr/CmrApClient', () => ({ default: () => null }))
vi.mock('@/components/cmr/CmrShell', () => ({ default: ({ children }: { children: unknown }) => children }))

import CmrApPage from './page'
import CmrSecureLayout from '../layout'

const where = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null } catch (e) { return (e as { to?: string }).to ?? 'threw' }
}
const ok = (role: string) => ({ ok: true, userId: 'u', role, displayName: 'X' })

beforeEach(() => { h.ctx = null })

describe('/cmr/ap page gate', () => {
  for (const role of ['controller', 'requester', 'viewer']) {
    it(`${role} can open it`, async () => {
      h.ctx = ok(role)
      expect(await where(() => CmrSecureLayout({ children: null }))).toBeNull()
      expect(await where(() => CmrApPage())).toBeNull()
    })
  }

  it('no grant (admin included) → /cmr/no-access; no session → /login', async () => {
    h.ctx = { ok: false, status: 403 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/cmr/no-access')
    expect(await where(() => CmrApPage())).toBe('/cmr/no-access')
    h.ctx = { ok: false, status: 401 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/login')
    expect(await where(() => CmrApPage())).toBe('/login')
  })

  it('the sidebar links Accounts Payable for every role', async () => {
    const { cmrNavFor } = await import('@/lib/cmr/roles')
    for (const role of ['controller', 'requester', 'viewer'] as const) {
      expect(cmrNavFor(role).flatMap((g) => g.items).some((i) => i.href === '/cmr/ap')).toBe(true)
    }
  })

  it('it is not a Controller-only path, and it sits in the Vendors group', async () => {
    const { CMR_CONTROLLER_PATHS, cmrNavFor } = await import('@/lib/cmr/roles')
    expect(CMR_CONTROLLER_PATHS.some((p) => '/cmr/ap'.startsWith(p))).toBe(false)
    const vendors = cmrNavFor('viewer').find((g) => g.label === 'Vendors')
    expect(vendors?.items.map((i) => i.href)).toEqual(['/cmr/recurring', '/cmr/requests', '/cmr/ap'])
    expect(vendors?.items[2].label).toBe('Accounts Payable')
  })
})
