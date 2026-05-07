import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import DistrictDashboard from '@/components/dashboard/DistrictDashboard'

export default async function DistrictPage({
  searchParams,
}: {
  searchParams: { branch?: string }
}) {
  const supabase = createServerComponentClient<Database>({ cookies })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile || profile.role !== 'district_manager') redirect('/login')

  // Fetch assigned branch IDs
  const { data: assignments } = await supabase
    .from('user_branch_assignments')
    .select('branch_id')
    .eq('user_id', user.id)

  const branchIds = ((assignments ?? []) as { branch_id: string }[]).map((a) => a.branch_id)
  if (branchIds.length === 0) redirect('/login')

  // Fetch branch details and entity mapping in parallel
  const [{ data: branchesRaw }, { data: codeRows }] = await Promise.all([
    supabase.from('branches').select('id, name').in('id', branchIds).order('name'),
    supabase
      .from('payroll_codes')
      .select('branch_id, entity_id')
      .in('branch_id', branchIds)
      .eq('is_active', true)
      .not('entity_id', 'is', null),
  ])

  // First entity per branch
  const entityByBranch: Record<string, string> = {}
  for (const row of (codeRows ?? []) as { branch_id: string | null; entity_id: string | null }[]) {
    if (row.branch_id && row.entity_id && !entityByBranch[row.branch_id]) {
      entityByBranch[row.branch_id] = row.entity_id
    }
  }

  const branches = ((branchesRaw ?? []) as { id: string; name: string }[]).map((b) => ({
    id: b.id,
    name: b.name,
    entityId: entityByBranch[b.id] ?? '',
  }))

  const initialBranch = searchParams.branch ?? 'all'

  return (
    <DashboardShell role="district_manager" userName={profile.display_name}>
      <DistrictDashboard
        branches={branches}
        initialBranch={initialBranch}
      />
    </DashboardShell>
  )
}
