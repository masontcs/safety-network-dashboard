import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import AllocationsClient from '@/components/allocations/AllocationsClient'

export default async function AllocationsPage() {
  const supabase = createServerComponentClient<Database>({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile || profile.role !== 'admin') redirect('/admin')

  return (
    <DashboardShell role="admin" userName={profile.display_name}>
      <AllocationsClient />
    </DashboardShell>
  )
}
