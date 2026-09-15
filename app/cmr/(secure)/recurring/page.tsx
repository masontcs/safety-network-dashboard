import type { Metadata } from 'next'
import ComingSoon from '@/components/cmr/ComingSoon'

export const metadata: Metadata = { title: 'Recurring vendors' }

export default function CmrRecurringPage() {
  return (
    <ComingSoon
      title="Recurring vendors"
      intro="The payments that come around every week or month, remembered so none are missed."
      icon="recurring"
      what="Weekly, monthly and urgent payment-plan vendors, with on-hold flags and the last amount sent."
      phase="Phase 2"
    />
  )
}
