import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import { hasFieldAccess, canUseDashboards, canUseBilling } from '@/lib/utils/interfaces'
import './tech.css'

/**
 * Gate the whole /tech subtree once, here — the second of two independent gates
 * (the middleware also allow-lists /tech). Field techs get in, and so do HYBRIDS
 * (desktop users with field_access who also work in the field). A desktop-only role
 * with no field access is bounced.
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
    .select('role, field_access')
    .eq('id', userId)
    .single()

  const profile = profileRaw as { role: Role; field_access: boolean } | null
  if (!profile || !hasFieldAccess(profile.role, profile.field_access)) redirect('/login')

  // Hybrids also have a desktop interface — offer a way back to it.
  const desktopHref = canUseBilling(profile.role) ? '/billing' : canUseDashboards(profile.role) ? '/dashboard' : null

  return (
    <div className="tech-root">
      {desktopHref && (
        /* Plain <a> (full navigation) so the cross-subdomain redirect to billing/dashboards is followed. */
        <a href={desktopHref} title="Switch to desktop"
          style={{ position: 'fixed', top: 8, right: 8, zIndex: 50, fontSize: 12, fontWeight: 600, color: 'var(--tech-accent, #b8860b)', background: 'var(--tech-surface, #fff)', border: '1px solid var(--tech-line, #d8d5cc)', borderRadius: 999, padding: '4px 10px', textDecoration: 'none' }}>
          Desktop ↗
        </a>
      )}
      {children}
    </div>
  )
}
