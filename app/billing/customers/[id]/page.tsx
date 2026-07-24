import CustomerDetailClient from '@/components/billing/CustomerDetailClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function BillingCustomerDetailPage({ params }: { params: { id: string } }) {
  return <CustomerDetailClient customerId={params.id} />
}
