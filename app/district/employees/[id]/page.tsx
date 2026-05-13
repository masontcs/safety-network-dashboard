import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import EmployeeDetailClient from '@/components/employees/EmployeeDetailClient'

export default async function DistrictEmployeeDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerClient()

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
  if (!profile || profile.role !== 'district_manager') {
    redirect('/login')
  }

  return (
    <DashboardShell role={profile.role} userName={profile.display_name}>
      <EmployeeDetailClient
        employeeId={params.id}
        role={profile.role}
        returnPath="/district"
      />
    </DashboardShell>
  )
}
