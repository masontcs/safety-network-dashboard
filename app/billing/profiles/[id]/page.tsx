import ProfileDetailClient from '@/components/billing/ProfileDetailClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function BillingProfileDetailPage({ params }: { params: { id: string } }) {
  return <ProfileDetailClient profileId={params.id} />
}
