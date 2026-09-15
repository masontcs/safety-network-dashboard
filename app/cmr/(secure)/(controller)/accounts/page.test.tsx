import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cmr/accounts is Controller-only at the page level: the (controller) layout AND the page
 * both redirect anyone else. (The APIs enforce it again — see app/api/cmr/accounts.)
 */

const h = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/cmr/session', () => ({ getCmrPageContext: async () => h.ctx }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }) },
}))
vi.mock('@/components/cmr/CmrAccountsClient', () => ({ default: () => null }))

import CmrAccountsPage from './page'
import CmrControllerLayout from '../layout'

const where = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null } catch (e) { return (e as { to?: string }).to ?? 'threw' }
}
const ok = (role: string) => ({ ok: true, userId: 'u', role, displayName: 'X' })

beforeEach(() => { h.ctx = null })

describe('/cmr/accounts page gate', () => {
  for (const role of ['requester', 'viewer']) {
    it(`${role} is bounced to /cmr by the layout and the page`, async () => {
      h.ctx = ok(role)
      expect(await where(() => CmrControllerLayout({ children: null }))).toBe('/cmr')
      expect(await where(() => CmrAccountsPage())).toBe('/cmr')
    })
  }

  it('no grant (admin included) → /cmr/no-access; no session → /login', async () => {
    h.ctx = { ok: false, status: 403 }
    expect(await where(() => CmrControllerLayout({ children: null }))).toBe('/cmr/no-access')
    expect(await where(() => CmrAccountsPage())).toBe('/cmr')
    h.ctx = { ok: false, status: 401 }
    expect(await where(() => CmrControllerLayout({ children: null }))).toBe('/login')
  })

  it('controller renders', async () => {
    h.ctx = ok('controller')
    expect(await where(() => CmrControllerLayout({ children: null }))).toBeNull()
    expect(await where(() => CmrAccountsPage())).toBeNull()
  })
})
