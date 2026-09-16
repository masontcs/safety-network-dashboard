import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrRecurringClient from '@/components/cmr/CmrRecurringClient'

export const metadata: Metadata = { title: 'Recurring vendors' }

/**
 * Every CMR role reads this page (Controller, Requester, Viewer). The (secure) layout is the
 * gate — explicit grant only, no admin inheritance — and this repeats it so the page can never
 * render on its own. Edit controls appear only when /api/cmr/recurring says `canEdit`
 * (Controller), and that API re-checks the role on every write.
 */
export default async function CmrRecurringPage() {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')
  return <CmrRecurringClient />
}
