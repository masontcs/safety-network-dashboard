import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import UnifiedDashboard from '@/components/dashboard/UnifiedDashboard'
import DashboardShell from '@/components/layout/DashboardShell'
import type { Role } from '@/lib/supabase/database.types'

export default async function DashboardPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createServiceClient()

  const [profileRes, assignRes, branchRes, fiscalMonthRes, payrollDatesRes, revenueDatesRes, fuelDatesRes] = await Promise.all([
    svc.from('user_profiles').select('role, display_name').eq('id', user.id).single(),
    svc.from('user_branch_assignments').select('branch_id').eq('user_id', user.id),
    svc.from('branches').select('id, name, is_revenue_generating').eq('is_active', true).order('name'),
    svc.from('fiscal_months').select('id, name, year, start_date, end_date, sort_order').eq('is_active', true).order('sort_order'),
    svc.from('payroll_imports').select('period_date'),
    svc.from('revenue_imports').select('period_date'),
    svc.from('fuel_imports').select('date_range_end'),
  ])

  if (!profileRes.data) redirect('/login')

  const role = profileRes.data.role as Role
  const userName = profileRes.data.display_name ?? ''

  // admin/executive have null branchIds (all access); managers get their assigned branches
  const userBranchIds: string[] | null =
    role === 'admin' || role === 'executive'
      ? null
      : (assignRes.data ?? []).map((a) => a.branch_id)

  const allBranches = (branchRes.data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    isRevenue: b.is_revenue_generating,
  }))

  // For non-admin/exec, only show branches the user can access
  const branches =
    userBranchIds === null
      ? allBranches
      : allBranches.filter((b) => userBranchIds.includes(b.id))

  // Build the set of all dates that have at least one import
  const dateDates = new Set<string>()
  for (const r of payrollDatesRes.data ?? []) dateDates.add(r.period_date)
  for (const r of revenueDatesRes.data ?? []) dateDates.add(r.period_date)
  for (const r of fuelDatesRes.data ?? []) dateDates.add(r.date_range_end)

  // Only include fiscal months that contain at least one imported date
  const fiscalMonths = (fiscalMonthRes.data ?? [])
    .filter((m) => [...dateDates].some((d) => d >= m.start_date && d <= m.end_date))
    .map((m) => ({
      id: m.id,
      name: m.name,
      year: m.year,
      startDate: m.start_date,
      endDate: m.end_date,
      sortOrder: m.sort_order,
    }))

  return (
    <DashboardShell role={role} userName={userName}>
      <Suspense>
        <UnifiedDashboard
          role={role}
          userName={userName}
          userBranchIds={userBranchIds}
          branches={branches}
          fiscalMonths={fiscalMonths}
        />
      </Suspense>
    </DashboardShell>
  )
}
