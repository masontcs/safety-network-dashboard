import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrPrioritiesClient from '@/components/cmr/CmrPrioritiesClient'
import { parseWeek } from '@/lib/cmr/priorities'
import { thisWeekStart } from '@/lib/cmr/week'

export const metadata: Metadata = { title: 'Weekly priorities' }

/**
 * Weekly priorities — what has to be paid or handled in one Sunday → Saturday week.
 *
 * Every CMR role reads this page (Controller, Requester, Viewer). The (secure) layout is the
 * gate — explicit grant only, no admin inheritance — and this repeats it so the page can never
 * render on its own. Edit controls appear only when /api/cmr/priorities says `canEdit`
 * (Controller), and every /api/cmr/priorities write re-checks the role.
 *
 * ?week=YYYY-MM-DD picks the week (any day → its Sunday); missing or invalid → this week
 * (Pacific).
 */
export default async function CmrPrioritiesPage({
  searchParams,
}: {
  searchParams?: { week?: string | string[] }
}) {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')

  const week = parseWeek(searchParams?.week)
  return <CmrPrioritiesClient initialWeek={week.ok ? week.value : thisWeekStart()} />
}
