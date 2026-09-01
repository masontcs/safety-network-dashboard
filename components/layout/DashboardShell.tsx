import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
import MobileBottomNav from './MobileBottomNav'
import type { Role } from '@/lib/supabase/database.types'
import { createServerClient } from '@/lib/supabase/server'

interface DashboardShellProps {
  role: Role
  branchName?: string
  userName?: string
  children: ReactNode
}

export default async function DashboardShell({ role, branchName, userName, children }: DashboardShellProps) {
  // A hybrid (desktop user who also works in the field) has field_access — surface the field
  // app in the switcher. One light lookup here keeps every dashboard page from threading it.
  let fieldAccess = false
  try {
    const supabase = createServerClient()
    const { data: claims } = await supabase.auth.getClaims()
    const uid = claims?.claims?.sub as string | undefined
    if (uid) {
      const { data } = await supabase.from('user_profiles').select('field_access').eq('id', uid).single()
      fieldAccess = !!(data as { field_access: boolean } | null)?.field_access
    }
  } catch { /* switcher just won't show the field app */ }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopNav branchName={branchName} userName={userName} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar: hidden on mobile, visible on desktop */}
        <div className="hidden md:flex">
          <Sidebar role={role} fieldAccess={fieldAccess} />
        </div>
        <main
          className="dashboard-main"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            background: 'var(--bg-base)',
            padding: 16,
          }}
        >
          {children}
        </main>
      </div>
      {/* Bottom nav: mobile only */}
      <div className="md:hidden">
        <MobileBottomNav role={role} />
      </div>
    </div>
  )
}
