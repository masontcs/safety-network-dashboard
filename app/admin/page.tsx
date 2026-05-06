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

  const [branchesRes, fiscalMonthsRes, fiscalQuartersRes] = await Promise.all([
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
    supabase
      .from('fiscal_quarters')
      .select(`id, name, quarter_number, year, fiscal_quarter_months(sort_order, fiscal_months(id, name, start_date, end_date))`)
      .order('year', { ascending: false })
      .order('quarter_number', { ascending: false }),
  ])

  const branches = (branchesRes.data as { id: string; name: string }[] | null) ?? []
  const fiscalMonths = (fiscalMonthsRes.data as {
    id: string; name: string; year: number; start_date: string; end_date: string
  }[] | null) ?? []

  type RawFQM = { sort_order: number; fiscal_months: { id: string; name: string; start_date: string; end_date: string } | null }
  type RawFQ = { id: string; name: string; quarter_number: number; year: number; fiscal_quarter_months: RawFQM[] }

  const fiscalQuarters = ((fiscalQuartersRes.data as RawFQ[] | null) ?? []).map((q) => ({
    id: q.id,
    name: q.name,
    quarter_number: q.quarter_number,
    year: q.year,
    months: (q.fiscal_quarter_months ?? [])
      .filter((fqm) => fqm.fiscal_months != null)
      .map((fqm) => ({ ...fqm.fiscal_months!, sort_order: fqm.sort_order }))
      .sort((a, b) => a.sort_order - b.sort_order),
  }))

  return (
    <DashboardShell role="admin" userName={profile.display_name}>
      <AdminDashboard branches={branches} fiscalMonths={fiscalMonths} fiscalQuarters={fiscalQuarters} />
    </DashboardShell>
  )
}
