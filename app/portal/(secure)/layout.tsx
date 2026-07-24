import { redirect } from 'next/navigation'
import { getPortalContext } from '@/lib/api/portal'
import PortalShell from '@/components/portal/PortalShell'

/**
 * The gate for everything a signed-in customer sees. getPortalContext resolves (and, on
 * first visit, links) the portal account; no account → back to the login page. All data
 * shown beneath is scoped to this customer by the API routes.
 */
export default async function SecurePortalLayout({ children }: { children: React.ReactNode }) {
  const res = await getPortalContext()
  if (!res.ok) redirect('/portal/login')
  const { ctx } = res
  return (
    <PortalShell customerName={ctx.customerName} email={ctx.email} name={ctx.name}>
      {children}
    </PortalShell>
  )
}
