import InvoiceDetailClient from '@/components/billing/InvoiceDetailClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function BillingInvoiceDetailPage({ params }: { params: { id: string } }) {
  return <InvoiceDetailClient invoiceId={params.id} />
}
