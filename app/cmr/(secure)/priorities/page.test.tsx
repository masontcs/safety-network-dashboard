import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /cmr/priorities is readable by EVERY CMR role — but only with a cmr_access grant. The (secure)
 * layout and the page both bounce everyone else; a platform admin without a grant is treated like
 * anyone else. Writes are gated by the API. ?week= picks the week (normalised to its Sunday).
 */

const h = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/cmr/session', () => ({ getCmrPageContext: async () => h.ctx }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }) },
  usePathname: () => '/cmr/priorities',
}))
vi.mock('@/components/cmr/CmrPrioritiesClient', () => ({ default: () => null }))
vi.mock('@/components/cmr/CmrShell', () => ({ default: ({ children }: { children: unknown }) => children }))
vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

import CmrPrioritiesPage from './page'
import CmrSecureLayout from '../layout'

const where = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null } catch (e) { return (e as { to?: string }).to ?? 'threw' }
}
const ok = (role: string) => ({ ok: true, userId: 'u', role, displayName: 'X' })
const weekProp = async (week?: string | string[]) =>
  ((await CmrPrioritiesPage({ searchParams: { week } })) as { props: { initialWeek: string } }).props.initialWeek

beforeEach(() => { h.ctx = null })

describe('/cmr/priorities page gate', () => {
  for (const role of ['controller', 'requester', 'viewer']) {
    it(`${role} can open it`, async () => {
      h.ctx = ok(role)
      expect(await where(() => CmrSecureLayout({ children: null }))).toBeNull()
      expect(await where(() => CmrPrioritiesPage({}))).toBeNull()
    })
  }

  it('no grant (admin included) → /cmr/no-access; no session → /login', async () => {
    h.ctx = { ok: false, status: 403 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/cmr/no-access')
    expect(await where(() => CmrPrioritiesPage({}))).toBe('/cmr/no-access')
    h.ctx = { ok: false, status: 401 }
    expect(await where(() => CmrSecureLayout({ children: null }))).toBe('/login')
    expect(await where(() => CmrPrioritiesPage({}))).toBe('/login')
  })

  it('?week= → that week’s Sunday; missing / invalid → this week (Pacific)', async () => {
    h.ctx = ok('viewer')
    expect(await weekProp('2026-09-24')).toBe('2026-09-20')
    expect(await weekProp('2026-09-20')).toBe('2026-09-20')
    expect(await weekProp(undefined)).toBe('2026-09-13')
    expect(await weekProp('garbage')).toBe('2026-09-13')
    expect(await weekProp(['2026-09-24', 'x'])).toBe('2026-09-13')
  })

  it('the sidebar links Weekly priorities for every role, and the page is no longer "coming soon"', async () => {
    const { cmrNavFor } = await import('@/lib/cmr/roles')
    for (const role of ['controller', 'requester', 'viewer'] as const) {
      expect(cmrNavFor(role).flatMap((g) => g.items).some((i) => i.href === '/cmr/priorities')).toBe(true)
    }
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'))
    expect(src).not.toMatch(/ComingSoon/)
  })
})
