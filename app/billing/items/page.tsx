import ItemsClient from '@/components/billing/ItemsClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function BillingItemsPage() {
  return <ItemsClient isAdmin />
}
