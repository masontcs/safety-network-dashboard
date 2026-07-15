import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import BillingShell from '@/components/billing/BillingShell'
import { canUseBilling, interfacesFor } from '@/lib/utils/interfaces'
import './billing.css'

/**
 * Gate the whole /billing subtree once, here — the pages beneath no longer
 * repeat the auth check or wrap themselves in a shell. The middleware also gates
 * /billing, so this is the second of two independent gates.
 *
 * Who may reach billing lives in lib/utils/interfaces (BILLING_ROLES) — the single
 * source of truth shared with the middleware and the sidebar switcher. Widen it there,
 * not here (plus the guardAdminOnly() calls in the billing API routes).
 */

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
  if (!profile || !canUseBilling(profile.role)) redirect('/dashboard')

  return (
    <BillingShell userName={profile.display_name} available={interfacesFor(profile.role)}>
      {children}
    </BillingShell>
  )
}
