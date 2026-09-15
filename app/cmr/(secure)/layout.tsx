import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrShell from '@/components/cmr/CmrShell'

/**
 * THE gate for every Cash Ledger page (second of two — the middleware checks the grant too).
 * Explicit grant only: getCmrContext never looks at user_profiles.role, so a platform admin
 * without a cmr_access row lands on /cmr/no-access like anyone else.
 */
export const dynamic = 'force-dynamic'

export default async function CmrSecureLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCmrPageContext()
  if (!ctx.ok) redirect(ctx.status === 401 ? '/login' : '/cmr/no-access')

  return (
    <CmrShell role={ctx.role} displayName={ctx.displayName}>
      {children}
    </CmrShell>
  )
}
