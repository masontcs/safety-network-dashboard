import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import AdminDashboard from '@/components/dashboard/AdminDashboard'

export default async function AdminPage({
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

  if (!profile || profile.role !== 'admin') redirect('/login')

  // Fetch all SN revenue-generating branches to resolve branch names client-side
  const { data: branchesRaw } = await supabase
    .from('branches')
    .select('id, name')
    .eq('is_revenue_generating', true)
    .order('name')

  const branches = (branchesRaw as { id: string; name: string }[] | null) ?? []

  const initialView = (searchParams.view === 'mtd' || searchParams.view === 'ytd') ? searchParams.view : 'weekly'
  const initialWeek = searchParams.week ?? null

  return (
    <DashboardShell role="admin" userName={profile.display_name}>
      <AdminDashboard branches={branches} initialWeek={initialWeek} initialView={initialView} />
    </DashboardShell>
  )
}
