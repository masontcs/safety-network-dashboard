import type { Metadata } from 'next'
import ComingSoon from '@/components/cmr/ComingSoon'

export const metadata: Metadata = { title: 'Weekly priorities' }

export default function CmrPrioritiesPage() {
  return (
    <ComingSoon
      title="Weekly priorities"
      intro="What has to be paid or covered this week, in order."
      icon="priorities"
      what="A ranked list with top-priority flags, due dates, what's still needed this week, and resolve / pay actions."
      phase="Phase 4"
    />
  )
}
