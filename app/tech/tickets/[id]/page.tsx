import TicketClient from '@/components/tech/TicketClient'

export const dynamic = 'force-dynamic'

export default function TechTicketPage({ params }: { params: { id: string } }) {
  return <TicketClient ticketId={params.id} />
}
