import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'
import { allowedPrefixesFor } from '@/lib/utils/interfaces'
import type { Role } from '@/lib/supabase/database.types'

/**
 * WH access is an EXPLICIT PER-PERSON GRANT with NO role inheritance.
 *
 * This file is the lock on that. The section used to be gated on the admin/executive role, which
 * handed it to six people; if someone ever re-introduces a role shortcut, the non-granted admin
 * and non-granted executive cases below fail. Do not weaken them.
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))

import { getWhContext, hasWhGrant } from './access'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'
const EXEC = '00000000-0000-4000-8000-0000000000e1'
const GRANTED_SALES = '00000000-0000-4000-8000-0000000000s1'.replace('s', 'b')
const INACTIVE = '00000000-0000-4000-8000-0000000000d1'

const ALL_ROLES: Role[] = [
  'admin', 'executive', 'district_manager', 'branch_manager', 'ar_manager', 'ar_team',
  'office_team', 'project_manager', 'sales', 'tech', 'billing_branch_manager', 'dispatcher',
  'biller', 'accounting', 'front_counter',
]

/** grants = the wh_access rows that exist. Nothing else decides. */
function world(userId: string | null, grants: string[] = [], opts: { failTables?: string[] } = {}) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
        { id: EXEC, role: 'executive', display_name: 'Eve Exec', is_active: true },
        { id: GRANTED_SALES, role: 'sales', display_name: 'Sal Sales', is_active: true },
        { id: INACTIVE, role: 'executive', display_name: 'Old Timer', is_active: false },
      ],
      wh_access: grants.map((id) => ({ user_id: id, granted_by: null, granted_at: '2026-09-24T10:00:00Z' })),
    },
    opts,
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

describe('getWhContext — the gate for /api/wh', () => {
  it('no session → 401, and the grant is never even read', async () => {
    const fake = world(null, [ADMIN])
    const ctx = await getWhContext()
    expect(ctx.ok).toBe(false)
    if (ctx.ok) return
    expect(ctx.status).toBe(401)
    expect((await ctx.response.json()).code).toBe('UNAUTHORIZED')
    expect(fake.calls).toHaveLength(0)
  })

  it('a platform ADMIN with no wh_access row → 403 (no role inheritance)', async () => {
    world(ADMIN, [])
    const ctx = await getWhContext()
    expect(ctx.ok).toBe(false)
    if (ctx.ok) return
    expect(ctx.status).toBe(403)
    expect(await ctx.response.json()).toMatchObject({ success: false, code: 'FORBIDDEN' })
  })

  it('an EXECUTIVE with no wh_access row → 403 (the role WH used to be gated on)', async () => {
    world(EXEC, [])
    const ctx = await getWhContext()
    expect(ctx.ok).toBe(false)
    if (ctx.ok) return
    expect(ctx.status).toBe(403)
  })

  it('every role is denied without a grant — the role is irrelevant', async () => {
    for (const role of ALL_ROLES) {
      const uid = '00000000-0000-4000-8000-0000000000f1'
      const fake = fakeSupabase({
        user_profiles: [{ id: uid, role, display_name: 'Someone', is_active: true }],
        wh_access: [],
      })
      server.routeClient = fakeRouteClient(uid)
      server.serviceClient = fake.client
      const ctx = await getWhContext()
      expect(ctx.ok, `role ${role} must be denied without a grant`).toBe(false)
    }
  })

  it('a granted user passes — even on a role that reaches almost nothing else', async () => {
    world(GRANTED_SALES, [GRANTED_SALES])
    const ctx = await getWhContext()
    expect(ctx.ok).toBe(true)
    if (!ctx.ok) return
    expect(ctx).toMatchObject({ userId: GRANTED_SALES, role: 'sales', displayName: 'Sal Sales' })
  })

  it('a granted but DEACTIVATED user → 403', async () => {
    world(INACTIVE, [INACTIVE])
    const ctx = await getWhContext()
    expect(ctx.ok).toBe(false)
    if (ctx.ok) return
    expect(ctx.status).toBe(403)
  })

  it('fails CLOSED with 500 when wh_access cannot be read', async () => {
    world(ADMIN, [ADMIN], { failTables: ['wh_access'] })
    const ctx = await getWhContext()
    expect(ctx.ok).toBe(false)
    if (ctx.ok) return
    expect(ctx.status).toBe(500)
    expect((await ctx.response.json()).code).toBe('INTERNAL_ERROR')
  })

  it('fails CLOSED with 500 when the profile cannot be read', async () => {
    world(ADMIN, [ADMIN], { failTables: ['user_profiles'] })
    const ctx = await getWhContext()
    expect(ctx.ok).toBe(false)
    if (ctx.ok) return
    expect(ctx.status).toBe(500)
  })

  it('reads wh_access by user_id and consults no role column for the decision', async () => {
    const fake = world(GRANTED_SALES, [GRANTED_SALES])
    await getWhContext()
    const grantRead = fake.calls.find((c) => c.table === 'wh_access')
    expect(grantRead).toBeTruthy()
    expect(grantRead!.filters).toEqual([['user_id', GRANTED_SALES]])
  })
})

describe('hasWhGrant — the raw check the nav and middleware use', () => {
  it('true only for a user with a row', async () => {
    world(ADMIN, [GRANTED_SALES])
    expect(await hasWhGrant(GRANTED_SALES)).toBe(true)
    expect(await hasWhGrant(ADMIN)).toBe(false)
    expect(await hasWhGrant(EXEC)).toBe(false)
  })

  it('false when the table cannot be read (fails closed)', async () => {
    world(ADMIN, [ADMIN], { failTables: ['wh_access'] })
    expect(await hasWhGrant(ADMIN)).toBe(false)
  })
})

describe('no role carries /wh any more', () => {
  /**
   * The middleware gates paths through allowedPrefixesFor and then, for /wh only, through the
   * grant. So '/wh' must be in NO role's prefixes: if it reappeared for a role, that whole role
   * would reach the section again — the exact bug this phase removed.
   */
  it('allowedPrefixesFor grants /wh to nobody', () => {
    for (const role of ALL_ROLES) {
      for (const fieldAccess of [false, true]) {
        const prefixes = allowedPrefixesFor(role, fieldAccess, null)
        expect(prefixes, `allowedPrefixesFor(${role})`).not.toContain('/wh')
        expect(prefixes.some((p) => p === '/wh' || '/wh'.startsWith(p + '/')), `${role} must not reach /wh by prefix`).toBe(false)
      }
    }
  })
})
