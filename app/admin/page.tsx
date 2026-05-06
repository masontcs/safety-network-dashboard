import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import AdminDashboard from '@/components/dashboard/AdminDashboard'

export default async function AdminPage() {
  const supabase = createServerComponentClient<Database>({ cookies })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile || profile.role !== 'admin') redirect('/login')

  const [branchesRes, fiscalMonthsRes] = await Promise.all([
    supabase
      .from('branches')
      .select('id, name')
      .eq('is_revenue_generating', true)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('fiscal_months')
      .select('id, name, year, start_date, end_date')
      .order('year', { ascending: false })
      .order('start_date', { ascending: false }),
  ])

  const branches = (branchesRes.data as { id: string; name: string }[] | null) ?? []
  const fiscalMonths = (fiscalMonthsRes.data as {
    id: string; name: string; year: number; start_date: string; end_date: string
  }[] | null) ?? []

  return (
    <DashboardShell role="admin" userName={profile.display_name}>
      <AdminDashboard branches={branches} fiscalMonths={fiscalMonths} />
    </DashboardShell>
  )
}
