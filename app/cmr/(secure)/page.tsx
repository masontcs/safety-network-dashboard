import type { Metadata } from 'next'
import ComingSoon from '@/components/cmr/ComingSoon'
import { pacificToday } from '@/lib/utils/date'

export const metadata: Metadata = { title: 'Daily ledger' }

/** Pacific-day label for the page head, e.g. "Tue, Sep 15". */
function pacificDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

export default function CmrDailyLedgerPage() {
  const today = pacificToday()
  return (
    <ComingSoon
      title="Daily ledger"
      intro="One consolidated cash position for the day, with AM and PM snapshots."
      icon="ledger"
      what="Beginning cash for AM and PM, adjustment lines with cover-by notes, the pending-in-bank breakdown by account, and the running current balance."
      phase="Phase 3"
      aside={<time className="cmr-pill" dateTime={today}>{pacificDayLabel(today)} · Pacific</time>}
    />
  )
}
