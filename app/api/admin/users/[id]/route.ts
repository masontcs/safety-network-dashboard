import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Role } from '@/lib/supabase/database.types'

const VALID_ROLES: Role[] = ['admin', 'executive', 'district_manager', 'branch_manager']

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as { role?: Role; branchIds?: string[] }
    const { role, branchIds } = body

    if (role && !VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Invalid role', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    if (role) {
      const { error } = await supabase
        .from('user_profiles')
        .update({ role })
        .eq('id', params.id)
      if (error) throw new Error(error.message)
    }

    if (branchIds !== undefined) {
      // Replace all branch assignments atomically
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

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
