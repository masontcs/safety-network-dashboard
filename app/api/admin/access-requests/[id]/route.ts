import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Role } from '@/lib/supabase/database.types'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const { id } = params
    const body = await request.json() as {
      action: 'approve' | 'deny'
      role?: string
      branchId?: string
      temporaryPassword?: string
    }

    const { action } = body
    if (action !== 'approve' && action !== 'deny') {
      return NextResponse.json({ success: false, error: 'action must be approve or deny', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Fetch the request
    const { data: req, error: fetchErr } = await supabase
      .from('access_requests')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchErr || !req) {
      return NextResponse.json({ success: false, error: 'Request not found', code: 'NOT_FOUND' }, { status: 404 })
    }
    if (req.status !== 'pending') {
      return NextResponse.json({ success: false, error: 'Request has already been reviewed', code: 'CONFLICT' }, { status: 409 })
    }

    if (action === 'deny') {
      const { error } = await supabase
        .from('access_requests')
        .update({ status: 'denied', reviewed_by: ctx.access.userId, reviewed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true })
    }

    // action === 'approve'
    const { role, branchId, temporaryPassword } = body as {
      action: 'approve'; role?: string; branchId?: string; temporaryPassword?: string
    }
    if (!role || !['branch_manager', 'district_manager', 'executive'].includes(role)) {
      return NextResponse.json({ success: false, error: 'A valid role is required to approve', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!branchId) {
      return NextResponse.json({ success: false, error: 'A branch is required to approve', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!temporaryPassword || temporaryPassword.length < 8) {
      return NextResponse.json({ success: false, error: 'A temporary password of at least 8 characters is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const displayName = `${req.first_name} ${req.last_name}`

    // Create Supabase Auth user with a temporary password — skip email verification
    const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
      email: req.email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    })

    if (createErr) {
      if (createErr.message?.toLowerCase().includes('already been registered') ||
          createErr.message?.toLowerCase().includes('already exists')) {
        return NextResponse.json(
          { success: false, error: `An account with ${req.email} already exists`, code: 'CONFLICT' },
          { status: 409 }
        )
      }
      throw new Error(createErr.message)
    }

    const userId = createData.user?.id
    if (!userId) throw new Error('Failed to create auth user')

    // Create user_profiles with must_change_password = true
    const { error: profileErr } = await supabase
      .from('user_profiles')
      .insert({ id: userId, role: role as Role, display_name: displayName, must_change_password: true })

    if (profileErr) {
      // Rollback: delete the auth user
      await supabase.auth.admin.deleteUser(userId)
      throw new Error(profileErr.message)
    }

    // Create user_branch_assignments
    const { error: assignErr } = await supabase
      .from('user_branch_assignments')
      .insert({ user_id: userId, branch_id: branchId })

    if (assignErr) {
      // Rollback: delete profile and auth user
      await supabase.from('user_profiles').delete().eq('id', userId)
      await supabase.auth.admin.deleteUser(userId)
      throw new Error(assignErr.message)
    }

    // Mark request as approved
    const { error: updateErr } = await supabase
      .from('access_requests')
      .update({ status: 'approved', reviewed_by: ctx.access.userId, reviewed_at: new Date().toISOString() })
      .eq('id', id)
    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json({ success: true, data: { userId } })
  } catch (err) {
    return apiError(err)
  }
}
