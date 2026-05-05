import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
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
        <Sidebar role={role} />
        <main
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#111111',
            padding: 16,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
