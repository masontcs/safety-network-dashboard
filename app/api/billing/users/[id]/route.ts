import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { MANAGEABLE_BILLING_ROLES } from '@/lib/utils/interfaces'
import { logAudit, getClientIp } from '@/lib/audit/log'
import type { Role } from '@/lib/supabase/database.types'

/**
 * Edit a billing user (role / branches / active) or reset their password — admin + Billing
 * Manager, via the 'users' area. Guardrails: the TARGET must already be a billing role (never
 * touch an admin or dashboard user), and a branch-scoped manager may only manage users within,
 * and assign, their own branches.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
const isManageableRole = (r: string): r is Role => (MANAGEABLE_BILLING_ROLES as readonly string[]).includes(r)

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access.role, 'users')
    if (guard) return guard
    const supabase = createServiceClient()

    const { data: target } = await supabase.from('user_profiles').select('id, role, display_name').eq('id', params.id).maybeSingle()
    const t = target as { id: string; role: Role; display_name: string } | null
    if (!t) return bad('User not found', 'NOT_FOUND', 404)
    if (!isManageableRole(t.role)) return bad('This user is not a billing user.', 'FORBIDDEN', 403)

    const scope = ctx.access.branchIds
    const { data: tAsg } = await supabase.from('user_branch_assignments').select('branch_id').eq('user_id', params.id)
    const targetBranches = ((tAsg ?? []) as { branch_id: string }[]).map((a) => a.branch_id)
    if (scope !== null) {
      const allow = new Set(scope)
      if (!targetBranches.some((b) => allow.has(b))) return bad('You do not manage this user.', 'FORBIDDEN', 403)
    }

    const body = (await request.json()) as { role?: Role; branchIds?: string[]; isActive?: boolean; temporaryPassword?: string }

    // Password reset.
    if (body.temporaryPassword !== undefined) {
      if (body.temporaryPassword.length < 8) return bad('A temporary password of at least 8 characters is required')
      const { error: rErr } = await supabase.auth.admin.updateUserById(params.id, { password: body.temporaryPassword })
      if (rErr) throw new Error(rErr.message)
      await supabase.from('user_profiles').update({ must_change_password: true }).eq('id', params.id)
    }

    if (body.role !== undefined) {
      if (!isManageableRole(body.role)) return bad('Pick a billing role')
      const { error } = await supabase.from('user_profiles').update({ role: body.role }).eq('id', params.id)
      if (error) throw new Error(error.message)
    }

    if (body.isActive !== undefined) {
      const { error } = await supabase.from('user_profiles').update({ is_active: body.isActive }).eq('id', params.id)
      if (error) throw new Error(error.message)
    }

    if (body.branchIds !== undefined) {
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
      metadata: { via: 'billing', ...(body.role ? { role: body.role } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}), passwordReset: body.temporaryPassword !== undefined }, ipAddress: getClientIp(request),
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
