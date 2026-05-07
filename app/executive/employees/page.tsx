import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import EmployeeListClient from '@/components/employees/EmployeeListClient'

export default async function ExecutiveEmployeesPage() {
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
  if (!profile || (profile.role !== 'admin' && profile.role !== 'executive')) {
    redirect('/login')
  }

  const [branchesResult, entitiesResult] = await Promise.all([
    supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
    supabase.from('entities').select('id, code').order('code'),
  ])

  const branches = (branchesResult.data ?? []) as { id: string; name: string }[]
  const entities = (entitiesResult.data ?? []) as { id: string; code: string }[]

  return (
    <DashboardShell role={profile.role} userName={profile.display_name}>
      <EmployeeListClient
        basePath="/executive/employees"
        branches={branches}
        entities={entities}
      />
    </DashboardShell>
  )
}
