import { NextResponse } from 'next/server'
import { createRouteClient, createServiceClient } from '@/lib/supabase/server'
import type { UserAccess } from '@/lib/utils/access'
import type { Role } from '@/lib/supabase/database.types'

type AccessResult =
  | { ok: true; access: UserAccess }
  | { ok: false; response: NextResponse }

export function isAdminRole(role: Role): boolean {
  return role === 'admin'
}

export function guardAdminOnly(role: Role): NextResponse | null {
  if (isAdminRole(role)) return null
  return NextResponse.json(
    { success: false, error: 'Admin access required.', code: 'FORBIDDEN' },
    { status: 403 }
  )
}

export async function getAccessContext(): Promise<AccessResult> {
  const routeClient = createRouteClient()
  const { data: { user }, error: authError } = await routeClient.auth.getUser()

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized.', code: 'UNAUTHORIZED' },
        { status: 401 }
      ),
    }
  }

  const supabase = createServiceClient()

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'User profile not found.', code: 'NOT_FOUND' },
        { status: 404 }
      ),
    }
  }

  const role = profile.role as Role

  // admin and executive get null (all access)
  if (role === 'admin' || role === 'executive') {
    return { ok: true, access: { userId: user.id, role, branchIds: null } }
  }

  const { data: assignments, error: assignError } = await supabase
    .from('user_branch_assignments')
    .select('branch_id')
    .eq('user_id', user.id)

  if (assignError) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Failed to load branch assignments.', code: 'INTERNAL_ERROR' },
        { status: 500 }
      ),
    }
  }

  const branchIds = (assignments ?? []).map((a) => a.branch_id)

  return { ok: true, access: { userId: user.id, role, branchIds } }
}
