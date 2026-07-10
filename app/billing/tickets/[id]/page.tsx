import TicketDetailClient from '@/components/billing/TicketDetailClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function BillingTicketDetailPage({ params }: { params: { id: string } }) {
  return <TicketDetailClient ticketId={params.id} />
}
