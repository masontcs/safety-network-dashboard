import type { Metadata } from 'next'
import DashboardShell from '@/components/layout/DashboardShell'
import WhTabs from '@/components/wh/WhTabs'
import { getWhPageContext, whPageRedirect } from '@/lib/wh/access'

/**
 * THE page gate for the Western Highways section — the second of three (the middleware's /wh
 * branch is the first, each /api/wh route's own check is the third).
 *
 * Access is an explicit wh_access grant, never a role: an admin or an executive who is not on
 * the allow-list is turned away here exactly like anyone else. The rule lives in
 * lib/wh/access.ts and is applied without restatement, so the allow-list is the only thing that
 * decides. A grant covers uploading too, so the Import tab is shown to everyone who gets here.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { default: 'Western Highways', template: '%s · Western Highways' },
  robots: { index: false, follow: false },
}

export default async function WhLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getWhPageContext()
  if (!ctx.ok) whPageRedirect(ctx.reason)

  return (
    <DashboardShell role={ctx.role} userName={ctx.displayName}>
      <WhTabs canUpload />
      {children}
    </DashboardShell>
  )
}
