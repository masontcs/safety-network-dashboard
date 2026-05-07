import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import ManagerDashboard from '@/components/dashboard/ManagerDashboard'

export default async function ManagerPage() {
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
  if (!profile || profile.role !== 'branch_manager') redirect('/login')

  const { data: assignmentRaw } = await supabase
    .from('user_branch_assignments')
    .select('branch_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  const assignment = assignmentRaw as { branch_id: string } | null
  if (!assignment) redirect('/login')

  const branchId = assignment.branch_id

  const { data: branchRaw } = await supabase
    .from('branches')
    .select('name')
    .eq('id', branchId)
    .single()

  const branch = branchRaw as { name: string } | null

  const { data: codeRaw } = await supabase
    .from('payroll_codes')
    .select('entity_id')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .limit(1)
    .single()

  const payrollCode = codeRaw as { entity_id: string } | null
  const entityId = payrollCode?.entity_id ?? ''

  return (
    <DashboardShell
      role="branch_manager"
      branchName={branch?.name}
      userName={profile.display_name}
    >
      <ManagerDashboard
        branchId={branchId}
        entityId={entityId}
      />
    </DashboardShell>
  )
}
