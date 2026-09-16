import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrLedgerClient from '@/components/cmr/CmrLedgerClient'
import { pacificToday } from '@/lib/utils/date'
import { parseLedgerDate, parsePeriod } from '@/lib/cmr/ledger'

export const metadata: Metadata = { title: 'Daily ledger' }

/**
 * The Cash Ledger home: the daily ledger for one (date, period) snapshot.
 *
 * Every CMR role reads this page (Controller, Requester, Viewer). The (secure) layout is the
 * gate — explicit grant only, no admin inheritance — and this repeats it so the page can never
 * render on its own. Edit controls appear only when /api/cmr/ledger says `canEdit`
 * (Controller), and every /api/cmr/ledger write re-checks the role.
 *
 * ?date=YYYY-MM-DD&period=am|pm pick the snapshot; anything missing or invalid falls back to
 * today (Pacific) and AM.
 */
export default async function CmrDailyLedgerPage({
  searchParams,
}: {
  searchParams?: { date?: string | string[]; period?: string | string[] }
}) {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')

  const date = parseLedgerDate(searchParams?.date)
  const period = parsePeriod(searchParams?.period)
  return (
    <CmrLedgerClient
      initialDate={date.ok ? date.value : pacificToday()}
      initialPeriod={period.ok ? period.value : 'am'}
    />
  )
}
