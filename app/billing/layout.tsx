import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import BillingShell from '@/components/billing/BillingShell'
import type { InterfaceKey } from '@/components/billing/InterfaceSwitcher'
import './billing.css'

/**
 * Gate the whole /billing subtree once, here — the pages beneath no longer
 * repeat the auth check or wrap themselves in a shell.
 *
 * Billing roles are not defined yet, so access is admin-only. When they land,
 * this is the single place to widen it (plus the guardAdminOnly() calls in the
 * billing API routes).
 */
const BILLING_ROLES: Role[] = ['admin']

/** Which interfaces this user may switch between. */
function interfacesFor(role: Role): InterfaceKey[] {
  const keys: InterfaceKey[] = ['dashboards'] // everyone with an account has the dashboards
  if (BILLING_ROLES.includes(role)) keys.push('billing')
  return keys
}

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
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
    <BillingShell userName={profile.display_name} available={interfacesFor(profile.role)}>
      {children}
    </BillingShell>
  )
}
