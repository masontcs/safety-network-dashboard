import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Role } from '@/lib/supabase/database.types'

const VALID_ROLES: Role[] = ['admin', 'executive', 'district_manager', 'branch_manager', 'ar_manager', 'ar_team', 'office_team', 'project_manager']
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as { role?: Role; branchIds?: string[]; isActive?: boolean; username?: string | null }
    const { role, branchIds, isActive, username } = body

    if (role && !VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Invalid role', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    // username can be a string to set, empty string to clear, or undefined to skip
    let resolvedUsername: string | null | undefined = undefined
    if (username !== undefined) {
      if (username === null || username === '') {
        resolvedUsername = null // clear it
      } else {
        const uname = username.trim().toLowerCase()
        if (!USERNAME_REGEX.test(uname)) {
          return NextResponse.json(
            { success: false, error: 'Username must be 3–20 characters: lowercase letters, numbers, underscores only', code: 'VALIDATION_ERROR' },
            { status: 400 },
          )
        }
        resolvedUsername = uname
      }
    }

    const supabase = createServiceClient()

    // ── Username uniqueness check ──────────────────────────────────────────────
    if (resolvedUsername) {
      const { data: taken } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', resolvedUsername)
        .neq('id', params.id) // allow setting same username back on same user
        .maybeSingle()
      if (taken) {
        return NextResponse.json(
          { success: false, error: `Username "${resolvedUsername}" is already taken`, code: 'CONFLICT' },
          { status: 409 },
        )
      }
    }

    // ── Role ──────────────────────────────────────────────────────────────────
    if (role) {
      const { error } = await supabase
        .from('user_profiles')
        .update({ role })
        .eq('id', params.id)
      if (error) throw new Error(error.message)
    }

    // ── Branch assignments ────────────────────────────────────────────────────
    if (branchIds !== undefined) {
      const { error: delError } = await supabase
        .from('user_branch_assignments')
        .delete()
        .eq('user_id', params.id)
      if (delError) throw new Error(delError.message)

      if (branchIds.length > 0) {
        const { error: insError } = await supabase
          .from('user_branch_assignments')
          .insert(branchIds.map((branch_id) => ({ user_id: params.id, branch_id })))
        if (insError) throw new Error(insError.message)
      }
    }

    // ── Active / deactivate ───────────────────────────────────────────────────
    if (typeof isActive === 'boolean') {
      // Update profile flag
      const { error: profileErr } = await supabase
        .from('user_profiles')
        .update({ is_active: isActive })
        .eq('id', params.id)
      if (profileErr) throw new Error(profileErr.message)

      // Ban or unban the auth user so they cannot log in while deactivated
      const { error: authErr } = await supabase.auth.admin.updateUserById(params.id, {
        ban_duration: isActive ? 'none' : '876000h', // ~100 years = effectively permanent
      })
      if (authErr) throw new Error(authErr.message)
    }

    // ── Username ──────────────────────────────────────────────────────────────
    if (resolvedUsername !== undefined) {
      const { error: unameErr } = await supabase
        .from('user_profiles')
        .update({ username: resolvedUsername })
        .eq('id', params.id)
      if (unameErr) throw new Error(unameErr.message)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
