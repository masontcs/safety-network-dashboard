import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import ArDashboard from '@/components/ar/ArDashboard'

export default async function ArPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createServiceClient()

  const [profileRes, assignRes, branchRes] = await Promise.all([
    svc.from('user_profiles').select('role, display_name').eq('id', user.id).single(),
    svc.from('user_branch_assignments').select('branch_id').eq('user_id', user.id),
    svc.from('branches').select('id, name').eq('is_active', true).eq('is_revenue_generating', true).order('name'),
  ])

  if (!profileRes.data) redirect('/login')
  const role = profileRes.data.role as Role

  let branchIds: string[] | null = null
  if (role !== 'admin' && role !== 'executive' && role !== 'ar_manager' && role !== 'ar_team') {
    branchIds = (assignRes.data ?? []).map((a: { branch_id: string }) => a.branch_id)
    if (branchIds.length === 0) redirect('/login')
  }

  const allBranches = (branchRes.data ?? []) as { id: string; name: string }[]
  const branches = branchIds === null
    ? allBranches
    : allBranches.filter((b) => branchIds!.includes(b.id))

  return (
    <DashboardShell role={role} userName={profileRes.data.display_name ?? ''}>
      <ArDashboard role={role} branches={branches} />
    </DashboardShell>
  )
}
