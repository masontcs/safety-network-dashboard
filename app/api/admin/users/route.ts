import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Role } from '@/lib/supabase/database.types'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const [profilesRes, assignmentsRes, branchesRes, authRes] = await Promise.all([
      supabase.from('user_profiles').select('id, role, display_name'),
      supabase.from('user_branch_assignments').select('user_id, branch_id'),
      supabase.from('branches').select('id, name').order('name'),
      supabase.auth.admin.listUsers(),
    ])

    if (profilesRes.error) throw new Error(profilesRes.error.message)
    if (assignmentsRes.error) throw new Error(assignmentsRes.error.message)

    const profiles = (profilesRes.data ?? []) as { id: string; role: Role; display_name: string }[]
    const assignments = assignmentsRes.data ?? []
    const branches = branchesRes.data ?? []
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

    const users = profiles.map((p) => ({
      id: p.id,
      displayName: p.display_name,
      email: emailMap[p.id] ?? '',
      role: p.role,
      branchIds: branchMap[p.id] ?? [],
    }))

    return NextResponse.json({
      success: true,
      data: {
        users,
        branches: (branches as { id: string; name: string }[]).map((b) => ({ id: b.id, name: b.name })),
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
