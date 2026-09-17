import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cmr/requests is readable by EVERY CMR role — but only with a cmr_access grant. The (secure)
 * layout and the page both bounce everyone else; a platform admin without a grant is treated
 * like anyone else. What each role may DO on the page is decided by the API (canRequest /
 * canEdit) and re-checked on every write.
 */

const h = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/cmr/session', () => ({ getCmrPageContext: async () => h.ctx }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }) },
  usePathname: () => '/cmr/requests',
}))
vi.mock('@/components/cmr/CmrRequestsClient', () => ({ default: () => null }))
vi.mock('@/components/cmr/CmrShell', () => ({ default: ({ children }: { children: unknown }) => children }))

import CmrRequestsPage from './page'
import CmrSecureLayout from '../layout'

const where = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null } catch (e) { return (e as { to?: string }).to ?? 'threw' }
}
const ok = (role: string) => ({ ok: true, userId: 'u', role, displayName: 'X' })

beforeEach(() => { h.ctx = null })

describe('/cmr/requests page gate', () => {
  for (const role of ['controller', 'requester', 'viewer']) {
    it(`${role} can open it`, async () => {
      h.ctx = ok(role)
      expect(await where(() => CmrSecureLayout({ children: null }))).toBeNull()
      expect(await where(() => CmrRequestsPage())).toBeNull()
    })
  }

  it('no grant (admin included) → /cmr/no-access; no session → /login', async () => {
    h.ctx = { ok: false, status: 403 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/cmr/no-access')
    expect(await where(() => CmrRequestsPage())).toBe('/cmr/no-access')
    h.ctx = { ok: false, status: 401 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/login')
    expect(await where(() => CmrRequestsPage())).toBe('/login')
  })

  it('the sidebar links Requests for every role, and the page is no longer "coming soon"', async () => {
    const { cmrNavFor } = await import('@/lib/cmr/roles')
    for (const role of ['controller', 'requester', 'viewer'] as const) {
      expect(cmrNavFor(role).flatMap((g) => g.items).some((i) => i.href === '/cmr/requests')).toBe(true)
    }
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'))
    expect(src).not.toMatch(/ComingSoon/)
    expect(src).toMatch(/CmrRequestsClient/)
  })

  it('Requests is NOT a Controller-only path — a Requester must be able to reach it', async () => {
    const { CMR_CONTROLLER_PATHS } = await import('@/lib/cmr/roles')
    expect(CMR_CONTROLLER_PATHS).not.toContain('/cmr/requests')
  })
})
