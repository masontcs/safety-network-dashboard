import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import FuelDashboard from './FuelDashboard'

export default async function FuelPage() {
  const supabase = createServerComponentClient<Database>({ cookies })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile) redirect('/login')

  const role = profile.role
  let branchIds: string[] | null = null
  let branches: Array<{ id: string; name: string }> = []

  if (role === 'admin' || role === 'executive') {
    const { data: allBranches } = await supabase
      .from('branches')
      .select('id, name')
      .eq('is_revenue_generating', true)
      .order('name')
    branches = (allBranches ?? []) as { id: string; name: string }[]
  } else {
    const { data: assignments } = await supabase
      .from('user_branch_assignments')
      .select('branch_id')
      .eq('user_id', user.id)
    branchIds = ((assignments ?? []) as { branch_id: string }[]).map((a) => a.branch_id)
    if (branchIds.length === 0) redirect('/login')

    const { data: branchesRaw } = await supabase
      .from('branches')
      .select('id, name')
      .in('id', branchIds)
      .order('name')
    branches = (branchesRaw ?? []) as { id: string; name: string }[]
  }

  return (
    <DashboardShell role={role} userName={profile.display_name}>
      <FuelDashboard role={role} branchIds={branchIds} branches={branches} />
    </DashboardShell>
  )
}
