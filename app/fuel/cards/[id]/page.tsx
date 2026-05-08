import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import CardDetail from './CardDetail'

export default async function FuelCardDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerComponentClient<Database>({ cookies })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile) redirect('/login')

  // Load all SN branches for the assignment panel (admin needs all, others need their own)
  const { data: branchesRaw } = await supabase
    .from('branches')
    .select('id, name')
    .eq('is_revenue_generating', true)
    .order('name')
  const branches = (branchesRaw ?? []) as { id: string; name: string }[]

  return (
    <DashboardShell role={profile.role} userName={profile.display_name}>
      <CardDetail cardId={params.id} role={profile.role} branches={branches} />
    </DashboardShell>
  )
}
