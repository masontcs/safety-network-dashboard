import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import ItemsClient from '@/components/billing/ItemsClient'

// Billing roles are not defined yet — the interface is admin-only until they are.
const BILLING_ROLES: Role[] = ['admin']

export default async function BillingItemsPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile || !BILLING_ROLES.includes(profile.role)) redirect('/dashboard')

  return (
    <DashboardShell role={profile.role} userName={profile.display_name}>
      <ItemsClient isAdmin={profile.role === 'admin'} />
    </DashboardShell>
  )
}
