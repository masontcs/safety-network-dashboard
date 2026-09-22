import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrApClient from '@/components/cmr/CmrApClient'

export const metadata: Metadata = { title: 'Accounts payable' }

/**
 * Every CMR role reads this page (Controller, Requester, Viewer). The (secure) layout is the
 * gate — explicit grant only, no admin inheritance — and this repeats it so the page can never
 * render on its own. The Import control appears only when /api/cmr/ap says `canImport`
 * (Controller), and /api/cmr/ap/import/* re-check the role on every call.
 */
export default async function CmrApPage() {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')
  return <CmrApClient />
}
