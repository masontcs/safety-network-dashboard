import QuoteDetailClient from '@/components/billing/QuoteDetailClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function BillingQuoteDetailPage({ params }: { params: { id: string } }) {
  return <QuoteDetailClient quoteId={params.id} />
}
