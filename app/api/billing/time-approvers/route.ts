import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { isFieldRole } from '@/lib/utils/interfaces'
import type { Role } from '@/lib/supabase/database.types'

/**
 * Admin config: who may approve times, per branch. Grants govern EVERYONE (admins included).
 * Candidates are dashboard (non-field) users. Branch names are resolved in the UI.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()

    const { data: grantsRaw } = await supabase.from('billing_time_approvers').select('id, user_id, branch_id')
    const grants = (grantsRaw ?? []) as { id: string; user_id: string; branch_id: string }[]

    const { data: usersRaw } = await supabase.from('user_profiles').select('id, display_name, username, role, is_active')
    const users = (usersRaw ?? []) as { id: string; display_name: string; username: string | null; role: Role; is_active: boolean }[]
    const nameById = new Map(users.map((u) => [u.id, u.display_name || u.username || '—']))
    const candidates = users.filter((u) => u.is_active && !isFieldRole(u.role)).map((u) => ({ id: u.id, name: u.display_name || u.username || '—' }))

    return NextResponse.json({
      success: true,
      data: {
        grants: grants.map((g) => ({ id: g.id, userId: g.user_id, userName: nameById.get(g.user_id) ?? '—', branchId: g.branch_id })),
        candidates,
      },
    })
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

    const body = (await request.json()) as { userId?: string; branchId?: string }
    if (!body.userId || !body.branchId) return bad('userId and branchId are required')

    const { error } = await supabase.from('billing_time_approvers').upsert(
      { user_id: body.userId, branch_id: body.branchId }, { onConflict: 'user_id,branch_id' },
    )
    if (error) throw new Error(error.message)
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

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return bad('id is required')
    const { error } = await supabase.from('billing_time_approvers').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
