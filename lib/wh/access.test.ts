import { describe, it, expect } from 'vitest'
import type { Role } from '@/lib/supabase/database.types'
import { WH_ROLES, canViewWh, canUploadWh, guardWhAccess, guardWhUpload } from './access'
import { allowedPrefixesFor } from '@/lib/utils/interfaces'

/**
 * WH access is an ALLOW-LIST. This test exists so a future role added to the platform cannot
 * silently acquire Western Highways: every role that is not in WH_ROLES must be denied, and
 * the list itself is pinned.
 */

const ALL_ROLES: Role[] = [
  'admin', 'executive', 'district_manager', 'branch_manager', 'ar_manager', 'ar_team',
  'office_team', 'project_manager', 'sales', 'tech', 'billing_branch_manager', 'dispatcher',
  'biller', 'accounting', 'front_counter',
]

describe('WH access', () => {
  it('grants exactly admin and executive', () => {
    expect([...WH_ROLES]).toEqual(['admin', 'executive'])
  })

  it('denies every other role, reading and uploading alike', () => {
    for (const role of ALL_ROLES) {
      const allowed = role === 'admin' || role === 'executive'
      expect(canViewWh(role), `canViewWh(${role})`).toBe(allowed)
      expect(canUploadWh(role), `canUploadWh(${role})`).toBe(allowed)
    }
  })

  it('returns null for an allowed role and a 403 for everyone else', async () => {
    expect(guardWhAccess('admin')).toBeNull()
    expect(guardWhAccess('executive')).toBeNull()
    expect(guardWhUpload('admin')).toBeNull()

    for (const role of ALL_ROLES.filter((r) => r !== 'admin' && r !== 'executive')) {
      const res = guardWhAccess(role)
      expect(res, `guardWhAccess(${role})`).not.toBeNull()
      expect(res!.status).toBe(403)
      expect(await res!.json()).toMatchObject({ success: false, code: 'FORBIDDEN' })

      const up = guardWhUpload(role)
      expect(up, `guardWhUpload(${role})`).not.toBeNull()
      expect(up!.status).toBe(403)
    }
  })

  it('does not treat an AR role as a WH role — WH is not part of SN AR', () => {
    expect(canViewWh('ar_manager')).toBe(false)
    expect(canViewWh('ar_team')).toBe(false)
  })

  /**
   * The middleware gates paths through allowedPrefixesFor, not through this module, so the two
   * have to agree: a role that canViewWh must be able to reach /wh, and a role that cannot
   * must not. Without this, widening one and forgetting the other produces either a dead link
   * in the sidebar or a page the middleware lets through and the layout then bounces.
   */
  it('agrees with the middleware path allow-list', () => {
    for (const role of ALL_ROLES) {
      const reachable = allowedPrefixesFor(role, false, null).includes('/wh')
      expect(reachable, `allowedPrefixesFor(${role}) vs canViewWh(${role})`).toBe(canViewWh(role))
    }
  })
})
