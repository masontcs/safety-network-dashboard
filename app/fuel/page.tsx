import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import FuelDashboard from './FuelDashboard'

export default async function FuelPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createServiceClient()

  const [profileRes, assignRes, branchRes, fiscalMonthRes, payrollDatesRes, revenueDatesRes, fuelDatesRes] = await Promise.all([
    svc.from('user_profiles').select('role, display_name').eq('id', user.id).single(),
    svc.from('user_branch_assignments').select('branch_id').eq('user_id', user.id),
    svc.from('branches').select('id, name').eq('is_active', true).eq('is_revenue_generating', true).order('name'),
    svc.from('fiscal_months').select('id, name, year, start_date, end_date, sort_order').eq('is_active', true).order('sort_order'),
    svc.from('payroll_imports').select('period_date'),
    svc.from('revenue_imports').select('period_date'),
    svc.from('fuel_imports').select('date_range_end'),
  ])

  if (!profileRes.data) redirect('/login')
  const role = profileRes.data.role as Role

  let branchIds: string[] | null = null
  if (role !== 'admin' && role !== 'executive') {
    branchIds = (assignRes.data ?? []).map((a: { branch_id: string }) => a.branch_id)
    if (branchIds.length === 0) redirect('/login')
  }

  const branches = (branchRes.data ?? []) as { id: string; name: string }[]

  // Only show fiscal months that contain at least one imported date
  const dateDates = new Set<string>()
  for (const r of payrollDatesRes.data ?? []) dateDates.add((r as { period_date: string }).period_date)
  for (const r of revenueDatesRes.data ?? []) dateDates.add((r as { period_date: string }).period_date)
  for (const r of fuelDatesRes.data ?? []) dateDates.add((r as { date_range_end: string }).date_range_end)

  const fiscalMonths = (fiscalMonthRes.data ?? [])
    .filter((m: { start_date: string; end_date: string }) =>
      [...dateDates].some((d) => d >= m.start_date && d <= m.end_date)
    )
    .map((m: { id: string; name: string; year: number; start_date: string; end_date: string; sort_order: number }) => ({
      id: m.id,
      name: m.name,
      year: m.year,
      startDate: m.start_date,
      endDate: m.end_date,
      sortOrder: m.sort_order,
    }))

  return (
    <DashboardShell role={role} userName={profileRes.data.display_name ?? ''}>
      <FuelDashboard
        role={role}
        branchIds={branchIds}
        branches={branches}
        fiscalMonths={fiscalMonths}
      />
    </DashboardShell>
  )
}
