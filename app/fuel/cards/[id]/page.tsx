import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import CardDetail from './CardDetail'

export default async function FuelCardDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile) redirect('/login')

  // Load all active branches for the assignment panel — includes corporate
  const { data: branchesRaw } = await supabase
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  const branches = (branchesRaw ?? []) as { id: string; name: string }[]

  return (
    <DashboardShell role={profile.role} userName={profile.display_name}>
      <CardDetail cardId={params.id} role={profile.role} branches={branches} />
    </DashboardShell>
  )
}
