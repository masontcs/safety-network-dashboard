import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database, Role } from '@/lib/supabase/database.types'
import DashboardShell from '@/components/layout/DashboardShell'
import DataExplorerClient from '@/components/data-explorer/DataExplorerClient'

export default async function AdminDataExplorerPage() {
  const supabase = createServerComponentClient<Database>({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const profile = profileRaw as { role: Role; display_name: string } | null
  if (!profile || profile.role !== 'admin') redirect('/admin')

  const [{ data: branchesRaw }, { data: entitiesRaw }] = await Promise.all([
    supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
    supabase.from('entities').select('id, code').order('code'),
  ])

  const branches = (branchesRaw as { id: string; name: string }[] | null) ?? []
  const entities = (entitiesRaw as { id: string; code: string }[] | null) ?? []

  return (
    <DashboardShell role="admin" userName={profile.display_name}>
      <DataExplorerClient branches={branches} entities={entities} />
    </DashboardShell>
  )
}
