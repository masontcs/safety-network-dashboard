import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import ExecutiveDashboard from '@/components/dashboard/ExecutiveDashboard'

export default async function ExecutivePage({
  searchParams,
}: {
  searchParams: { week?: string; view?: string }
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

  if (!profile || (profile.role !== 'executive' && profile.role !== 'admin')) {
    redirect('/login')
  }

  const [{ data: branchesRaw }, { data: entitiesRaw }] = await Promise.all([
    supabase.from('branches').select('id, name').eq('is_revenue_generating', true).order('name'),
    supabase.from('entities').select('id, code, name').order('code'),
  ])

  const branches = (branchesRaw as { id: string; name: string }[] | null) ?? []
  const entities = (entitiesRaw as { id: string; code: string; name: string }[] | null) ?? []

  const initialView =
    searchParams.view === 'mtd' || searchParams.view === 'ytd' ? searchParams.view : 'weekly'
  const initialWeek = searchParams.week ?? null

  return (
    <DashboardShell role={profile.role} userName={profile.display_name}>
      <ExecutiveDashboard
        branches={branches}
        entities={entities}
        initialWeek={initialWeek}
        initialView={initialView}
      />
    </DashboardShell>
  )
}
