import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const [requestsRes, branchesRes] = await Promise.all([
      supabase
        .from('access_requests')
        .select('id, first_name, last_name, email, username, branch_id, requested_role, notes, status, reviewed_at, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('branches')
        .select('id, name, is_revenue_generating')
        .eq('is_active', true)
        .order('name'),
    ])

    if (requestsRes.error) throw new Error(requestsRes.error.message)

    const branches = (branchesRes.data ?? []) as { id: string; name: string; is_revenue_generating: boolean }[]
    const branchMap = Object.fromEntries(branches.map((b) => [b.id, b.name]))

    const requests = (requestsRes.data ?? []).map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      username: r.username ?? null,
      branchId: r.branch_id,
      branchName: r.branch_id ? (branchMap[r.branch_id] ?? null) : null,
      requestedRole: r.requested_role,
      notes: r.notes,
      status: r.status,
      reviewedAt: r.reviewed_at,
      createdAt: r.created_at,
    }))

    return NextResponse.json({ success: true, data: { requests, branches } })
  } catch (err) {
    return apiError(err)
  }
}
