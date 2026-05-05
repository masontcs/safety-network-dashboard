import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'

const DASHBOARD_ROUTES: Record<Role, string> = {
  admin:            '/admin',
  executive:        '/executive',
  district_manager: '/district',
  branch_manager:   '/manager',
}

export default async function RootPage() {
  const supabase = createServerClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  const { data } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()

  const profile = data as { role: Role } | null
  if (!profile) redirect('/login')

  redirect(DASHBOARD_ROUTES[profile.role])
}
