import type { Metadata } from 'next'
import ComingSoon from '@/components/cmr/ComingSoon'

export const metadata: Metadata = { title: 'Vendor requests' }

export default function CmrRequestsPage() {
  return (
    <ComingSoon
      title="Vendor requests"
      intro="Payment requests from the team, waiting for the Controller to place them."
      icon="requests"
      what="Requesters submit vendor payments here; the Controller drags each one into the day's pending items or the week's priorities."
      phase="Phase 5"
    />
  )
}
