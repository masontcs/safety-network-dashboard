import JobDetailClient from '@/components/billing/JobDetailClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function BillingJobDetailPage({ params }: { params: { id: string } }) {
  return <JobDetailClient jobId={params.id} />
}
