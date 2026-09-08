'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import BillingSidebar from '@/components/billing/BillingSidebar'
import BillingTopbar from '@/components/billing/BillingTopbar'
import { BranchProvider } from '@/components/billing/BranchContext'
import type { InterfaceKey } from '@/components/billing/InterfaceSwitcher'
import type { Role } from '@/lib/supabase/database.types'

/**
 * Client chrome for the billing interface: owns the mobile nav-drawer state so the topbar's
 * hamburger and the sidebar (which render in different branches of the tree) can share it.
 * On desktop the sidebar is a static column; on mobile it slides in over a backdrop.
 */
export default function BillingChrome({
  userName, role, billingRole = null, available, children,
}: {
  userName: string
  role: Role
  billingRole?: Role | null
  available: InterfaceKey[]
  children: React.ReactNode
}) {
  const [navOpen, setNavOpen] = useState(false)
  const pathname = usePathname()

  // Close the drawer whenever the route changes (a nav tap navigates, then this fires).
  useEffect(() => { setNavOpen(false) }, [pathname])

  return (
    <div className="billing-root bx-shell">
      <BillingSidebar userName={userName} role={role} billingRole={billingRole} available={available} open={navOpen} onNavigate={() => setNavOpen(false)} />
      {navOpen && <div className="bx-nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden />}
      <main className="bx-main">
        <BranchProvider>
          <BillingTopbar role={role} billingRole={billingRole} onOpenNav={() => setNavOpen(true)} />
          <div className="bx-content">{children}</div>
        </BranchProvider>
      </main>
    </div>
  )
}
