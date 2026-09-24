import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import WhTabs from '@/components/wh/WhTabs'
import { canViewWh, canUploadWh } from '@/lib/wh/access'

/**
 * THE page gate for the Western Highways section — the second of three (the middleware's path
 * allow-list is the first, each /api/wh route's own guard is the third).
 *
 * WH is a separate company from Safety Network, so nothing here is shared with the SN
 * dashboards beyond the shell: a role that can see SN A/R does not thereby see WH. The rule
 * lives in lib/wh/access.ts and is applied here without restatement, so widening it is one
 * edit in one file.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { default: 'Western Highways', template: '%s · Western Highways' },
  robots: { index: false, follow: false },
}

export default async function WhLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createServiceClient()
  const { data: profile } = await svc
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  const role = profile.role as Role

  // Not an allowed role → send them to their own home rather than a 403 page, which would
  // confirm the section exists. Same posture as the middleware.
  if (!canViewWh(role)) redirect('/dashboard')

  return (
    <DashboardShell role={role} userName={profile.display_name ?? ''}>
      <WhTabs canUpload={canUploadWh(role)} />
      {children}
    </DashboardShell>
  )
}
