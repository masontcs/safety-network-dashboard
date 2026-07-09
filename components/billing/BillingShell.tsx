import type { ReactNode } from 'react'
import BillingSidebar from '@/components/billing/BillingSidebar'
import type { InterfaceKey } from '@/components/billing/InterfaceSwitcher'

/**
 * The billing interface shell. Separate from DashboardShell on purpose: its own
 * navigation, its own information architecture, and its own visual language.
 *
 * `.billing-root` scopes the v2 design tokens (see app/billing/billing.css) so
 * the shared card/table/button components render in billing's palette without
 * touching the dashboards.
 */
export default function BillingShell({
  userName,
  available,
  children,
}: {
  userName: string
  available: InterfaceKey[]
  children: ReactNode
}) {
  return (
    <div className="billing-root" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <BillingSidebar userName={userName} available={available} />
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          background: 'var(--bg-base)',
          padding: '24px 28px 48px',
        }}
      >
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>{children}</div>
      </main>
    </div>
  )
}
