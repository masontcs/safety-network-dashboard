import BillingUsersClient from '@/components/billing/BillingUsersClient'

// Auth + role gate live in app/billing/layout.tsx; the 'users' area (admin + Billing Manager)
// is enforced by the API + middleware/nav.
export default function BillingUsersPage() {
  return <BillingUsersClient />
}
