import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { MANAGEABLE_BILLING_ROLES, effectiveBillingRole } from '@/lib/utils/interfaces'
import { logAudit, getClientIp } from '@/lib/audit/log'
import type { Role } from '@/lib/supabase/database.types'

/**
 * Manage BILLING users from inside the billing interface (admin + Billing Manager only, via
 * the 'users' area). Deliberately narrow: only billing roles (billing_manager/dispatcher/
 * biller) are listed and creatable — never an admin or a dashboard account — and a
 * branch-scoped manager can only touch users in, and assign, their own branches.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
const isManageableRole = (r: string): r is Role => (MANAGEABLE_BILLING_ROLES as readonly string[]).includes(r)

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'users')
    if (guard) return guard
    const supabase = createServiceClient()

    const scope = ctx.access.branchIds // null = all branches
    const isAdmin = ctx.access.role === 'admin'
    const [{ data: profs }, { data: asg }, { data: branchRows }, authList] = await Promise.all([
      // Billing users are (a) NATIVE — role is itself a billing role — or (b) GRANTED — any
      // dashboard/tech user who was given a layered billing_role. List both.
      supabase.from('user_profiles').select('id, role, billing_role, display_name, username, is_active')
        .or('role.in.(billing_manager,dispatcher,biller),billing_role.not.is.null'),
      supabase.from('user_branch_assignments').select('user_id, branch_id'),
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.auth.admin.listUsers(),
    ])
    const profiles = (profs ?? []) as { id: string; role: Role; billing_role: Role | null; display_name: string; username: string | null; is_active: boolean }[]
    const assignments = (asg ?? []) as { user_id: string; branch_id: string }[]
    const branchByUser = new Map<string, string[]>()
    for (const a of assignments) branchByUser.set(a.user_id, [...(branchByUser.get(a.user_id) ?? []), a.branch_id])
    const emailById = new Map((authList.data?.users ?? []).filter((u) => u.email).map((u) => [u.id, u.email as string]))

    // Assignable branches: all active for admin; only the caller's for a scoped manager.
    let branches = (branchRows ?? []) as { id: string; name: string }[]
    if (scope !== null) { const allow = new Set(scope); branches = branches.filter((b) => allow.has(b.id)) }

    let users = profiles.map((p) => {
      const granted = p.billing_role != null                         // layered grant vs native billing account
      const billingRole = effectiveBillingRole(p.role, p.billing_role) // the role they act as in billing
      return {
        id: p.id, displayName: p.display_name, username: p.username, email: emailById.get(p.id) ?? '',
        baseRole: p.role,            // their primary (dashboard/tech) role — informational for granted users
        billingRole,                 // effective billing role (what drives areas)
        source: granted ? 'granted' as const : 'native' as const,
        isActive: p.is_active, branchIds: branchByUser.get(p.id) ?? [],
      }
    })
    // A scoped manager only sees billing users who share one of their branches.
    if (scope !== null) { const allow = new Set(scope); users = users.filter((u) => u.branchIds.some((b) => allow.has(b))) }
    users.sort((a, b) => (a.isActive === b.isActive ? a.displayName.localeCompare(b.displayName) : a.isActive ? -1 : 1))

    return NextResponse.json({ success: true, data: { users, branches, canManageAll: scope === null, isAdmin } })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'users')
    if (guard) return guard
    const supabase = createServiceClient()

    const body = (await request.json()) as { displayName?: string; email?: string; username?: string; temporaryPassword?: string; role?: Role; branchIds?: string[] }
    const displayName = body.displayName?.trim()
    const email = body.email?.trim()
    const uname = body.username?.trim().toLowerCase() || null
    const password = body.temporaryPassword
    const role = body.role
    const branchIds = [...new Set((body.branchIds ?? []).filter(Boolean))]

    if (!displayName) return bad('A name is required')
    if (!email) return bad('An email is required')
    if (!uname || !/^[a-z0-9_]{3,20}$/.test(uname)) return bad('Username must be 3–20 chars: lowercase letters, numbers, underscore')
    if (!password || password.length < 8) return bad('A temporary password of at least 8 characters is required')
    if (!role || !isManageableRole(role)) return bad('Pick a billing role')
    if (branchIds.length === 0) return bad('Assign at least one branch')
    // A scoped manager may only assign their own branches.
    if (ctx.access.branchIds !== null) {
      const allow = new Set(ctx.access.branchIds)
      if (!branchIds.every((b) => allow.has(b))) return bad('You can only assign branches you manage.', 'FORBIDDEN', 403)
    }

    const { data: taken } = await supabase.from('user_profiles').select('id').eq('username', uname).maybeSingle()
    if (taken) return bad(`Username "${uname}" is already taken`, 'CONFLICT', 409)

    const { data: created, error: cErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { must_change_password: true },
    })
    if (cErr) {
      const m = cErr.message?.toLowerCase() ?? ''
      if (m.includes('already') && (m.includes('registered') || m.includes('exists'))) return bad(`An account with ${email} already exists`, 'CONFLICT', 409)
      throw new Error(cErr.message)
    }
    const userId = created.user?.id
    if (!userId) throw new Error('Failed to create the auth user')

    const { error: pErr } = await supabase.from('user_profiles')
      .insert({ id: userId, role, display_name: displayName, username: uname, must_change_password: true })
    if (pErr) { await supabase.auth.admin.deleteUser(userId); throw new Error(pErr.message) }

    const { error: bErr } = await supabase.from('user_branch_assignments').insert(branchIds.map((branch_id) => ({ user_id: userId, branch_id })))
    if (bErr) { await supabase.from('user_profiles').delete().eq('id', userId); await supabase.auth.admin.deleteUser(userId); throw new Error(bErr.message) }

    await logAudit({
      userId: ctx.access.userId, userDisplayName: ctx.access.displayName, userRole: ctx.access.role,
      action: 'user.create', resourceType: 'user', resourceId: userId, resourceLabel: displayName,
      metadata: { email, role, branchIds, via: 'billing' }, ipAddress: getClientIp(request),
    })
    return NextResponse.json({ success: true, data: { userId } }, { status: 201 })
  } catch (err) {
    return billingApiError(err)
  }
}
