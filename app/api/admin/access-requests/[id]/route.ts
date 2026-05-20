import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Role } from '@/lib/supabase/database.types'
import { logAudit, getClientIp } from '@/lib/audit/log'

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/

const VALID_ROLES: Role[] = [
  'branch_manager', 'district_manager', 'executive',
  'ar_manager', 'ar_team', 'office_team', 'project_manager', 'sales', 'admin',
]

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
      branchIds?: string[]
      temporaryPassword?: string
      username?: string
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
      await logAudit({
        userId:          ctx.access.userId,
        userDisplayName: ctx.access.displayName,
        userRole:        ctx.access.role,
        action:          'access_request.archive',
        resourceType:    'access_request',
        resourceId:      id,
        resourceLabel:   `${req.first_name} ${req.last_name}`,
        metadata:        { email: req.email, requestedRole: req.requested_role },
        ipAddress:       getClientIp(request),
      })
      return NextResponse.json({ success: true })
    }

    // action === 'approve'
    const { role, branchIds, temporaryPassword, username } = body as {
      action: 'approve'; role?: string; branchIds?: string[]; temporaryPassword?: string; username?: string
    }

    if (!role || !VALID_ROLES.includes(role as Role)) {
      return NextResponse.json({ success: false, error: 'A valid role is required to approve', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!branchIds || branchIds.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one branch is required to approve', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!temporaryPassword || temporaryPassword.length < 8) {
      return NextResponse.json({ success: false, error: 'A temporary password of at least 8 characters is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    // Validate and resolve username — prefer admin-adjusted value, fall back to requested
    const uname = (username?.trim().toLowerCase() || req.username?.trim().toLowerCase() || '').replace(/[^a-z0-9_]/g, '')
    if (uname && !USERNAME_REGEX.test(uname)) {
      return NextResponse.json({ success: false, error: 'Invalid username format', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    // Check username uniqueness if one is set
    if (uname) {
      const { data: taken } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', uname)
        .maybeSingle()
      if (taken) {
        return NextResponse.json({ success: false, error: `Username "${uname}" is already taken`, code: 'CONFLICT' }, { status: 409 })
      }
    }

    const displayName = `${req.first_name} ${req.last_name}`

    // Create Supabase Auth user
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

    // Create user_profiles (with username if provided)
    const { error: profileErr } = await supabase
      .from('user_profiles')
      .insert({
        id: userId,
        role: role as Role,
        display_name: displayName,
        must_change_password: true,
        ...(uname ? { username: uname } : {}),
      })

    if (profileErr) {
      await supabase.auth.admin.deleteUser(userId)
      throw new Error(profileErr.message)
    }

    // Create user_branch_assignments
    const { error: assignErr } = await supabase
      .from('user_branch_assignments')
      .insert(branchIds.map((branch_id) => ({ user_id: userId, branch_id })))

    if (assignErr) {
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

    await logAudit({
      userId:          ctx.access.userId,
      userDisplayName: ctx.access.displayName,
      userRole:        ctx.access.role,
      action:          'access_request.approve',
      resourceType:    'access_request',
      resourceId:      id,
      resourceLabel:   displayName,
      metadata:        { email: req.email, requestedRole: req.requested_role, approvedRole: role, branchIds },
      ipAddress:       getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { userId } })
  } catch (err) {
    return apiError(err)
  }
}
