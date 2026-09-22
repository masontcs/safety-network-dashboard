import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrVendorsClient from '@/components/cmr/CmrVendorsClient'

export const metadata: Metadata = { title: 'Vendors' }

/**
 * The cross-account vendor rollup (AP Phase 3a). Every CMR role reads it. The (secure) layout is
 * the gate — explicit grant only, no admin inheritance — and this repeats it so the page can
 * never render on its own. Read only: there is no control here that changes anything.
 */
export default async function CmrVendorsPage() {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')
  return <CmrVendorsClient />
}
