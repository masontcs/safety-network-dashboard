import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Role } from '@/lib/supabase/database.types'
import { logAudit, getClientIp } from '@/lib/audit/log'

const VALID_ROLES: Role[] = ['admin', 'executive', 'district_manager', 'branch_manager', 'ar_manager', 'ar_team', 'office_team', 'project_manager', 'sales']

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const [profilesRes, assignmentsRes, branchesRes, authRes] = await Promise.all([
      supabase.from('user_profiles').select('id, role, display_name, is_active, username'),
      supabase.from('user_branch_assignments').select('user_id, branch_id'),
      supabase.from('branches').select('id, name, is_revenue_generating').eq('is_active', true).order('name'),
      supabase.auth.admin.listUsers(),
    ])

    if (profilesRes.error) throw new Error(profilesRes.error.message)
    if (assignmentsRes.error) throw new Error(assignmentsRes.error.message)

    const profiles = (profilesRes.data ?? []) as { id: string; role: Role; display_name: string; is_active: boolean; username: string | null }[]
    const branches = (branchesRes.data ?? []) as { id: string; name: string; is_revenue_generating: boolean }[]
    const authUsers = authRes.data?.users ?? []

    const emailMap = Object.fromEntries(authUsers.map((u) => [u.id, u.email ?? '']))

    const branchMap = Object.fromEntries(
      (assignmentsRes.data ?? []).reduce<[string, string[]][]>((acc, a) => {
        const existing = acc.find(([id]) => id === a.user_id)
        if (existing) existing[1].push(a.branch_id)
        else acc.push([a.user_id, [a.branch_id]])
        return acc
      }, []),
    )

    const users = profiles
      .map((p) => ({
        id:          p.id,
        displayName: p.display_name,
        email:       emailMap[p.id] ?? '',
        role:        p.role,
        branchIds:   branchMap[p.id] ?? [],
        isActive:    p.is_active ?? true,
        username:    p.username ?? null,
      }))
      .sort((a, b) => {
        // Active users first, then alphabetical by name
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        return (a.displayName ?? '').localeCompare(b.displayName ?? '')
      })

    return NextResponse.json({ success: true, data: { users, branches } })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as {
      displayName?: string
      email?: string
      username?: string
      role?: Role
      branchIds?: string[]
      temporaryPassword?: string
    }
    const { displayName, email, username, role, branchIds, temporaryPassword } = body

    if (!displayName?.trim()) {
      return NextResponse.json({ success: false, error: 'Display name is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!email?.trim()) {
      return NextResponse.json({ success: false, error: 'Email is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    const uname = username?.trim().toLowerCase() || null
    if (uname && !/^[a-z0-9_]{3,20}$/.test(uname)) {
      return NextResponse.json({ success: false, error: 'Invalid username format', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ success: false, error: 'A valid role is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!temporaryPassword || temporaryPassword.length < 8) {
      return NextResponse.json({ success: false, error: 'A temporary password of at least 8 characters is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const ids = branchIds ?? []

    const supabase = createServiceClient()

    // Check username uniqueness before creating auth user
    if (uname) {
      const { data: taken } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', uname)
        .maybeSingle()
      if (taken) {
        return NextResponse.json(
          { success: false, error: `Username "${uname}" is already taken`, code: 'CONFLICT' },
          { status: 409 },
        )
      }
    }

    const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    })

    if (createErr) {
      if (createErr.message?.toLowerCase().includes('already been registered') ||
          createErr.message?.toLowerCase().includes('already exists')) {
        return NextResponse.json(
          { success: false, error: `An account with ${email} already exists`, code: 'CONFLICT' },
          { status: 409 },
        )
      }
      throw new Error(createErr.message)
    }

    const userId = createData.user?.id
    if (!userId) throw new Error('Failed to create auth user')

    const { error: profileErr } = await supabase
      .from('user_profiles')
      .insert({ id: userId, role, display_name: displayName.trim(), must_change_password: true, ...(uname ? { username: uname } : {}) })

    if (profileErr) {
      await supabase.auth.admin.deleteUser(userId)
      throw new Error(profileErr.message)
    }

    if (ids.length > 0) {
      const { error: assignErr } = await supabase
        .from('user_branch_assignments')
        .insert(ids.map((branch_id) => ({ user_id: userId, branch_id })))

      if (assignErr) {
        await supabase.from('user_profiles').delete().eq('id', userId)
        await supabase.auth.admin.deleteUser(userId)
        throw new Error(assignErr.message)
      }
    }

    await logAudit({
      userId:          ctx.access.userId,
      userDisplayName: ctx.access.displayName,
      userRole:        ctx.access.role,
      action:          'user.create',
      resourceType:    'user',
      resourceId:      userId,
      resourceLabel:   displayName.trim(),
      metadata:        { email: email.trim(), role, branchIds: ids },
      ipAddress:       getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { userId } }, { status: 201 })
  } catch (err) {
    return apiError(err)
  }
}
