import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import PayrollItemsClient from './PayrollItemsClient'

export const dynamic = 'force-dynamic'

export default async function PayrollItemsPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  return (
    <DashboardShell role="admin" userName={profile.display_name}>
      <PayrollItemsClient />
    </DashboardShell>
  )
}
