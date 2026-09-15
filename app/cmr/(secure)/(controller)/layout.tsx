import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'

/**
 * Settings (Accounts, Access) are Controller-only. Hiding the nav links is cosmetic; this is
 * the page-level check. The matching APIs enforce it again with guardCmrController.
 */
export default async function CmrControllerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')
  if (ctx.role !== 'controller') redirect('/cmr')
  return <>{children}</>
}
