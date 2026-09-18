import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrRollupClient from '@/components/cmr/CmrRollupClient'
import { parseWeek } from '@/lib/cmr/priorities'
import { thisWeekStart } from '@/lib/cmr/week'

export const metadata: Metadata = { title: 'Weekly rollup' }

/**
 * Weekly rollup — the start-to-end-of-week cash position, what is pending and still needed, the
 * recurring schedule by frequency with an account filter, and the recurring vendors that are due
 * but not yet entered.
 *
 * Every CMR role reads this page (Controller, Requester, Viewer). The (secure) layout is the
 * gate — explicit grant only, no admin inheritance — and this repeats it so the page can never
 * render on its own. The Add control appears only when /api/cmr/rollup says `canEdit`
 * (Controller), and /api/cmr/recurring/place re-checks the role on every accept.
 *
 * ?week=YYYY-MM-DD picks the week (any day → its Sunday); missing or invalid → this week
 * (Pacific).
 */
export default async function CmrRollupPage({
  searchParams,
}: {
  searchParams?: { week?: string | string[] }
}) {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')

  const week = parseWeek(searchParams?.week)
  return <CmrRollupClient initialWeek={week.ok ? week.value : thisWeekStart()} />
}
