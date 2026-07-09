import PriceListsClient from '@/components/billing/PriceListsClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function PriceListsPage() {
  return <PriceListsClient isAdmin />
}
