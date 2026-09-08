import type { ReactNode } from 'react'
import BillingChrome from '@/components/billing/BillingChrome'
import type { InterfaceKey } from '@/components/billing/InterfaceSwitcher'
import type { Role } from '@/lib/supabase/database.types'

/**
 * The billing interface shell. `.billing-root` scopes the v2 design system
 * (app/billing/billing.css) so the dashboards are untouched. The interactive chrome
 * (mobile nav drawer, topbar) lives in the client BillingChrome; this stays a thin
 * server wrapper that passes identity/access down.
 */
export default function BillingShell({
  userName,
  role,
  billingRole = null,
  available,
  children,
}: {
  userName: string
  role: Role
  billingRole?: Role | null
  available: InterfaceKey[]
  children: ReactNode
}) {
  return (
    <BillingChrome userName={userName} role={role} billingRole={billingRole} available={available}>
      {children}
    </BillingChrome>
  )
}
