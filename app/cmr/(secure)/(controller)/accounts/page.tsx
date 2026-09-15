import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrAccountsClient from '@/components/cmr/CmrAccountsClient'

export const metadata: Metadata = { title: 'Accounts' }

/**
 * Controller only. The (controller) layout already redirects everyone else; this repeats the
 * check so the page can never render on its own, and /api/cmr/accounts guards every write.
 */
export default async function CmrAccountsPage() {
  const ctx = await getCmrPageContext()
  if (!ctx.ok || ctx.role !== 'controller') redirect('/cmr')
  return <CmrAccountsClient />
}
