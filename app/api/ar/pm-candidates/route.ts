import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'

const PM_ROLES: Role[] = ['project_manager', 'branch_manager']
const ALLOWED_ROLES: Role[] = ['admin', 'executive', 'ar_manager', 'district_manager', 'branch_manager']

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    if (!ALLOWED_ROLES.includes(ctx.access.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const customerId = searchParams.get('customerId')
    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { branchIds } = ctx.access

    // Find distinct branches that have invoices for this customer
    const { data: invoiceRows } = await supabase
      .from('ar_invoices')
      .select('branch_id')
      .eq('customer_id', customerId)
      .not('branch_id', 'is', null)

    const customerBranchIds = [...new Set(
      (invoiceRows ?? []).map((r) => r.branch_id as string)
    )]

    if (customerBranchIds.length === 0) {
      return NextResponse.json({ branches: [] })
    }

    // Branch/district managers can only see their own branches
    const eligibleBranchIds = branchIds !== null
      ? customerBranchIds.filter((id) => branchIds.includes(id))
      : customerBranchIds

    if (eligibleBranchIds.length === 0) {
      return NextResponse.json({ branches: [] })
    }

    // Fetch branch names
    const { data: branchRows } = await supabase
      .from('branches')
      .select('id, name')
      .in('id', eligibleBranchIds)

    const branchNameMap = new Map(
      (branchRows ?? []).map((b) => [b.id as string, b.name as string])
    )

    // Find PM-eligible users assigned to each eligible branch
    const { data: assignments } = await supabase
      .from('user_branch_assignments')
      .select('user_id, branch_id')
      .in('branch_id', eligibleBranchIds)

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ branches: [] })
    }

    const uniqueUserIds = [...new Set(assignments.map((a) => a.user_id as string))]

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, display_name, role')
      .in('id', uniqueUserIds)
      .in('role', PM_ROLES)

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.id as string, p])
    )

    // Build branch groups sorted by branch name
    const branches = eligibleBranchIds
      .map((bId) => {
        const users = assignments
          .filter((a) => (a.branch_id as string) === bId)
          .map((a) => profileMap.get(a.user_id as string))
          .filter((p): p is NonNullable<typeof p> => p != null)
          .map((p) => ({
            id:          p.id as string,
            displayName: p.display_name as string,
            role:        p.role as string,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))

        return { id: bId, name: branchNameMap.get(bId) ?? bId, users }
      })
      .filter((b) => b.users.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ branches })
  } catch (err) {
    console.error('PM candidates GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
