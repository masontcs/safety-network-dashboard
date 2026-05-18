import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
import MobileBottomNav from './MobileBottomNav'
import type { Role } from '@/lib/supabase/database.types'

interface DashboardShellProps {
  role: Role
  branchName?: string
  userName?: string
  children: ReactNode
}

export default function DashboardShell({ role, branchName, userName, children }: DashboardShellProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopNav branchName={branchName} userName={userName} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar: hidden on mobile, visible on desktop */}
        <div className="hidden md:flex">
          <Sidebar role={role} />
        </div>
        <main
          className="dashboard-main"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            background: '#111111',
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
