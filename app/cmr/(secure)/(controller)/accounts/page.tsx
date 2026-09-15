import type { Metadata } from 'next'
import ComingSoon from '@/components/cmr/ComingSoon'

export const metadata: Metadata = { title: 'Accounts' }

export default function CmrAccountsPage() {
  return (
    <ComingSoon
      title="Accounts"
      intro="The bank accounts the ledger tracks. Controllers only."
      icon="accounts"
      what="Add, rename, reorder and deactivate the accounts used across the ledger: TCS, Signs, STS, INC, Holdings, WHWY and JFT."
      phase="Phase 1"
    />
  )
}
