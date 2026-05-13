import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import CardList from './CardList'

export default async function FuelCardsPage() {
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

  return (
    <DashboardShell role={profile.role} userName={profile.display_name}>
      <CardList role={profile.role} />
    </DashboardShell>
  )
}
