import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import TargetsClient from '@/components/targets/TargetsClient'

export default async function TargetsPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile || (profile.role !== 'admin' && profile.role !== 'executive')) redirect('/dashboard')

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
      .order('year', { ascending: true })
      .order('start_date', { ascending: true }),
  ])

  const branches = (branchesRes.data as { id: string; name: string }[] | null) ?? []
  const fiscalMonths = (fiscalMonthsRes.data as { id: string; name: string; year: number; start_date: string; end_date: string }[] | null) ?? []

  return (
    <DashboardShell role={profile.role} userName={profile.display_name}>
      <TargetsClient branches={branches} fiscalMonths={fiscalMonths} />
    </DashboardShell>
  )
}
