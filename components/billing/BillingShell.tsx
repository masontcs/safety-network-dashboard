import type { ReactNode } from 'react'
import BillingSidebar from '@/components/billing/BillingSidebar'
import BillingTopbar from '@/components/billing/BillingTopbar'
import { BranchProvider } from '@/components/billing/BranchContext'
import type { InterfaceKey } from '@/components/billing/InterfaceSwitcher'
import type { Role } from '@/lib/supabase/database.types'

/**
 * The billing interface shell — the concept layout: a white sidebar, a sticky
 * translucent topbar, and the scrolling content beneath. `.billing-root` scopes
 * the v2 design system (app/billing/billing.css) so the dashboards are untouched.
 */
export default function BillingShell({
  userName,
  role,
  available,
  children,
}: {
  userName: string
  role: Role
  available: InterfaceKey[]
  children: ReactNode
}) {
  return (
    <div className="billing-root" style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <BillingSidebar userName={userName} role={role} available={available} />
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <BranchProvider>
          <BillingTopbar />
          <div style={{ padding: '24px 26px 70px', maxWidth: 1200, width: '100%' }}>{children}</div>
        </BranchProvider>
      </main>
    </div>
  )
}
