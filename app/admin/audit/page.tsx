import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import AuditClient from '@/components/admin/AuditClient'

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const supabase = createServerClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  return <AuditClient />
}
