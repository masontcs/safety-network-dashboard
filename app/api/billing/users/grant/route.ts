import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { MANAGEABLE_BILLING_ROLES, DASHBOARD_ROLES, isFieldRole } from '@/lib/utils/interfaces'
import { logAudit, getClientIp } from '@/lib/audit/log'
import type { Role } from '@/lib/supabase/database.types'

/**
 * Grant (or update / revoke) BILLING access on an EXISTING user — admin only.
 *
 * Billing is a capability layered on top of a user's primary role (billing_role), so this
 * gives a dashboard person or a technician billing access WITHOUT creating a duplicate account
 * or disturbing their existing role. Native pure-billing accounts are still created via
 * POST /api/billing/users; this endpoint is only for layering billing onto someone who already
 * exists elsewhere.
 *
 *   GET    → candidates: existing users who could be granted billing (not admins, not already billing)
 *   POST   → grant/update: set billing_role (+ branch scope if the user has none yet)
 *   DELETE → revoke: clear billing_role (leaves their primary role + branches untouched)
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
const isManageableRole = (r: string): r is Role => (MANAGEABLE_BILLING_ROLES as readonly string[]).includes(r)

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()

    const [{ data: profs }, { data: asg }, authList] = await Promise.all([
      supabase.from('user_profiles').select('id, role, billing_role, field_access, display_name, username, is_active'),
      supabase.from('user_branch_assignments').select('user_id, branch_id'),
      supabase.auth.admin.listUsers(),
    ])
    const profiles = (profs ?? []) as { id: string; role: Role; billing_role: Role | null; field_access: boolean; display_name: string; username: string | null; is_active: boolean }[]
    const branchByUser = new Map<string, string[]>()
    for (const a of (asg ?? []) as { user_id: string; branch_id: string }[]) branchByUser.set(a.user_id, [...(branchByUser.get(a.user_id) ?? []), a.branch_id])
    const emailById = new Map((authList.data?.users ?? []).filter((u) => u.email).map((u) => [u.id, u.email as string]))

    // Grantable = anyone who isn't an admin (already full billing), isn't already a native
    // billing account, and doesn't already hold a layered grant. Must have some identity to
    // layer billing onto: a dashboard role or field access (a tech).
    const candidates = profiles
      .filter((p) => p.is_active)
      .filter((p) => p.role !== 'admin')
      .filter((p) => p.billing_role == null && !isManageableRole(p.role))
      .filter((p) => DASHBOARD_ROLES.includes(p.role) || isFieldRole(p.role) || p.field_access)
      .map((p) => ({
        id: p.id, displayName: p.display_name, username: p.username, email: emailById.get(p.id) ?? '',
        baseRole: p.role, isField: isFieldRole(p.role) || p.field_access,
        branchIds: branchByUser.get(p.id) ?? [],
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))

    return NextResponse.json({ success: true, data: { candidates } })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()

    const body = (await request.json()) as { userId?: string; billingRole?: Role; branchIds?: string[] }
    const userId = body.userId?.trim()
    const billingRole = body.billingRole
    const branchIds = [...new Set((body.branchIds ?? []).filter(Boolean))]

    if (!userId) return bad('A user is required')
    if (!billingRole || !isManageableRole(billingRole)) return bad('Pick a billing role')

    const { data: target } = await supabase.from('user_profiles').select('id, role, billing_role, display_name').eq('id', userId).maybeSingle()
    const t = target as { id: string; role: Role; billing_role: Role | null; display_name: string } | null
    if (!t) return bad('User not found', 'NOT_FOUND', 404)
    if (t.role === 'admin') return bad('Admins already have full billing access.', 'CONFLICT', 409)
    if (isManageableRole(t.role)) return bad('This is already a billing account — manage it directly.', 'CONFLICT', 409)

    // Branch scope. Billing staff are branch-scoped via assignments. Reuse the user's existing
    // assignments if they have any (never widen/shrink their dashboard scope from here); only when
    // they have NONE (e.g. an AR/office user or a tech) do we set the chosen billing branches.
    const { data: existing } = await supabase.from('user_branch_assignments').select('branch_id').eq('user_id', userId)
    const existingBranches = ((existing ?? []) as { branch_id: string }[]).map((a) => a.branch_id)
    if (existingBranches.length === 0) {
      if (branchIds.length === 0) return bad('Assign at least one branch for billing scope')
      const { error: bErr } = await supabase.from('user_branch_assignments').insert(branchIds.map((branch_id) => ({ user_id: userId, branch_id })))
      if (bErr) throw new Error(bErr.message)
    }

    const { error: uErr } = await supabase.from('user_profiles').update({ billing_role: billingRole }).eq('id', userId)
    if (uErr) throw new Error(uErr.message)

    await logAudit({
      userId: ctx.access.userId, userDisplayName: ctx.access.displayName, userRole: ctx.access.role,
      action: t.billing_role ? 'user.update' : 'user.create', resourceType: 'user', resourceId: userId, resourceLabel: t.display_name,
      metadata: { via: 'billing', billingAccessGranted: billingRole, baseRole: t.role, branchIds: existingBranches.length ? existingBranches : branchIds }, ipAddress: getClientIp(request),
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()

    const body = (await request.json()) as { userId?: string }
    const userId = body.userId?.trim()
    if (!userId) return bad('A user is required')

    const { data: target } = await supabase.from('user_profiles').select('id, role, billing_role, display_name').eq('id', userId).maybeSingle()
    const t = target as { id: string; role: Role; billing_role: Role | null; display_name: string } | null
    if (!t) return bad('User not found', 'NOT_FOUND', 404)
    if (t.billing_role == null) return bad('This user has no layered billing grant to revoke. Native billing accounts are managed directly.', 'CONFLICT', 409)

    // Clear the layered grant only — the primary role and branch assignments stay, so their
    // dashboard/field access is untouched.
    const { error } = await supabase.from('user_profiles').update({ billing_role: null }).eq('id', userId)
    if (error) throw new Error(error.message)

    await logAudit({
      userId: ctx.access.userId, userDisplayName: ctx.access.displayName, userRole: ctx.access.role,
      action: 'user.update', resourceType: 'user', resourceId: userId, resourceLabel: t.display_name,
      metadata: { via: 'billing', billingAccessRevoked: t.billing_role, baseRole: t.role }, ipAddress: getClientIp(request),
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
