import '@/app/billing/billing.css'

/**
 * Portal root. Reuses the billing concept design system (billing.css, scoped to
 * .billing-root) so the customer-facing app shares the exact look of the internal one.
 * No auth gate here — the /portal/login page must be reachable while signed out; the
 * gate lives in app/portal/(secure)/layout.tsx.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="billing-root" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {children}
    </div>
  )
}
