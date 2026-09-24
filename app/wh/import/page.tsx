import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import WhImportClient from '@/components/wh/WhImportClient'
import { canUploadWh } from '@/lib/wh/access'

/**
 * The WH upload screen. The /wh layout already established that the viewer may see the
 * section; this page checks the upload right separately, so narrowing uploads later needs no
 * change here. Both import routes under /api/wh re-check it themselves — the UI hiding a
 * button is never the thing that stops a write.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Import' }

export default async function WhImportPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createServiceClient()
  const { data: profile } = await svc.from('user_profiles').select('role').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (!canUploadWh(profile.role as Role)) redirect('/wh/ar')

  return <WhImportClient />
}
