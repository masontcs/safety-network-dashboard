import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrRequestsClient from '@/components/cmr/CmrRequestsClient'

export const metadata: Metadata = { title: 'Vendor requests' }

/**
 * Vendor requests — the queue a Requester submits into and the Controller places or declines.
 *
 * Every CMR role reads this page (Controller, Requester, Viewer). The (secure) layout is the
 * gate — explicit grant only, no admin inheritance — and this repeats it so the page can never
 * render on its own. The submit form appears only when /api/cmr/requests says `canRequest`
 * (Controller or Requester), and Place / Decline only when it says `canEdit` (Controller);
 * every /api/cmr/requests* write re-checks the role, and the own-row-and-still-queued rule,
 * server-side.
 */
export default async function CmrRequestsPage() {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')

  return <CmrRequestsClient />
}
