import DashboardClient from '@/components/billing/DashboardClient'

// The billing home is the dashboard. Auth, role gate and shell live in app/billing/layout.tsx.
export default function BillingIndexPage() {
  return <DashboardClient />
}
