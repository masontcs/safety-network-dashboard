import JobsClient from '@/components/billing/JobsClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function BillingJobsPage() {
  return <JobsClient isAdmin />
}
