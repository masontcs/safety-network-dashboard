import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { MANAGEABLE_BILLING_ROLES } from '@/lib/utils/interfaces'
import { logAudit, getClientIp } from '@/lib/audit/log'
import type { Role } from '@/lib/supabase/database.types'

/**
 * Edit a billing user (role / branches / active) or reset their password, via the 'users' area.
 * Two kinds of target:
 *   - NATIVE  — a pure-billing account (role is itself a billing role): admin + Billing Manager
 *     may manage it, a branch-scoped manager only within their own branches (as before).
 *   - GRANTED — a dashboard/tech user who was given a layered billing_role: ADMIN ONLY, because
 *     editing them touches a shared account. Here we only change the billing role or reset the
 *     password; their branches follow their account and revoking the grant is done via
 *     DELETE /api/billing/users/grant. is_active is not toggled here (that would disable their
 *     whole account) — use the admin Users page for that.
 * Never touches an admin or a plain dashboard user with no billing.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
const isManageableRole = (r: string): r is Role => (MANAGEABLE_BILLING_ROLES as readonly string[]).includes(r)

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'users')
    if (guard) return guard
    const supabase = createServiceClient()

    const { data: target } = await supabase.from('user_profiles').select('id, role, billing_role, display_name').eq('id', params.id).maybeSingle()
    const t = target as { id: string; role: Role; billing_role: Role | null; display_name: string } | null
    if (!t) return bad('User not found', 'NOT_FOUND', 404)

    const granted = t.billing_role != null
    const native = isManageableRole(t.role) && !granted
    if (!native && !granted) return bad('This user is not a billing user.', 'FORBIDDEN', 403)

    // Granted hybrids are shared accounts — only an admin may manage them from here.
    if (granted && ctx.access.role !== 'admin') {
      return bad('Only an admin can manage a user who was granted billing access.', 'FORBIDDEN', 403)
    }

    const scope = ctx.access.branchIds
    const { data: tAsg } = await supabase.from('user_branch_assignments').select('branch_id').eq('user_id', params.id)
    const targetBranches = ((tAsg ?? []) as { branch_id: string }[]).map((a) => a.branch_id)
    if (native && scope !== null) {
      const allow = new Set(scope)
      if (!targetBranches.some((b) => allow.has(b))) return bad('You do not manage this user.', 'FORBIDDEN', 403)
    }

    const body = (await request.json()) as { role?: Role; branchIds?: string[]; isActive?: boolean; temporaryPassword?: string }

    // Password reset (both kinds).
    if (body.temporaryPassword !== undefined) {
      if (body.temporaryPassword.length < 8) return bad('A temporary password of at least 8 characters is required')
      const { error: rErr } = await supabase.auth.admin.updateUserById(params.id, { password: body.temporaryPassword })
      if (rErr) throw new Error(rErr.message)
      await supabase.from('user_profiles').update({ must_change_password: true }).eq('id', params.id)
    }

    // Billing-role change: native updates the account's role; granted updates the layered grant.
    if (body.role !== undefined) {
      if (!isManageableRole(body.role)) return bad('Pick a billing role')
      const patch = granted ? { billing_role: body.role } : { role: body.role }
      const { error } = await supabase.from('user_profiles').update(patch).eq('id', params.id)
      if (error) throw new Error(error.message)
    }

    // Active toggle + branch edits apply to NATIVE billing accounts only. For a granted hybrid,
    // both would reach into their dashboard/field identity, so they're handled elsewhere.
    if (body.isActive !== undefined) {
      if (!native) return bad('Manage active status for this user from the admin Users page.', 'FORBIDDEN', 403)
      const { error } = await supabase.from('user_profiles').update({ is_active: body.isActive }).eq('id', params.id)
      if (error) throw new Error(error.message)
    }

    if (body.branchIds !== undefined) {
      if (!native) return bad('A granted user’s branches follow their account — edit them on the admin Users page.', 'FORBIDDEN', 403)
      const branchIds = [...new Set(body.branchIds.filter(Boolean))]
      if (branchIds.length === 0) return bad('A billing user needs at least one branch')
      if (scope !== null) {
        const allow = new Set(scope)
        if (!branchIds.every((b) => allow.has(b))) return bad('You can only assign branches you manage.', 'FORBIDDEN', 403)
      }
      await supabase.from('user_branch_assignments').delete().eq('user_id', params.id)
      const { error } = await supabase.from('user_branch_assignments').insert(branchIds.map((branch_id) => ({ user_id: params.id, branch_id })))
      if (error) throw new Error(error.message)
    }

    await logAudit({
      userId: ctx.access.userId, userDisplayName: ctx.access.displayName, userRole: ctx.access.role,
      action: 'user.update', resourceType: 'user', resourceId: params.id, resourceLabel: t.display_name,
      metadata: { via: 'billing', source: granted ? 'granted' : 'native', ...(body.role ? { billingRole: body.role } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}), passwordReset: body.temporaryPassword !== undefined }, ipAddress: getClientIp(request),
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
