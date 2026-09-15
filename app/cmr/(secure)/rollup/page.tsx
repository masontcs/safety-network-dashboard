import type { Metadata } from 'next'
import ComingSoon from '@/components/cmr/ComingSoon'

export const metadata: Metadata = { title: 'Weekly rollup' }

export default function CmrRollupPage() {
  return (
    <ComingSoon
      title="Weekly rollup"
      intro="The start-to-end-of-week cash position across every account."
      icon="rollup"
      what="Start and end-of-week positions, weekly and monthly recurring totals with an account filter, and suggestions for recurring vendors that are due."
      phase="Phase 7"
    />
  )
}
