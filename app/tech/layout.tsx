import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import { isFieldRole } from '@/lib/utils/interfaces'
import './tech.css'

/**
 * Gate the whole /tech subtree once, here — the second of two independent gates
 * (the middleware also allow-lists /tech to field roles only). A dashboard/billing
 * role that somehow reaches here is bounced; only a `tech` gets in.
 *
 * The tech app is money-blind by construction: it only ever calls /api/tech/*, which
 * return no prices. Nothing in this subtree touches a billing or dashboard endpoint.
 */
export default async function TechLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub as string | undefined
  if (!userId) redirect('/login')

  const { data: profileRaw } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single()

  const profile = profileRaw as { role: Role } | null
  // Only field roles reach the tech app. Anyone else goes to /login (which then
  // forwards them to their own home) — we never confirm the page exists to them.
  if (!profile || !isFieldRole(profile.role)) redirect('/login')

  return <div className="tech-root">{children}</div>
}
