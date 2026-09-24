import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import WhAccessClient from '@/components/wh/WhAccessClient'

/**
 * "Who can see Western Highways" — the admin screen for the wh_access allow-list.
 *
 * It lives in the ADMIN area, not inside /wh, on purpose: managing the list is the platform
 * admin's job and must not require being on the list, while being on the list must not let a
 * non-admin hand it out. /api/wh/access enforces exactly that again on every method.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'WH Access' }

export default async function WhAccessPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  return (
    <DashboardShell role="admin" userName={profile.display_name}>
      <WhAccessClient currentUserId={user.id} />
    </DashboardShell>
  )
}
