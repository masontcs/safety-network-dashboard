'use client'

import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { Role } from '@/lib/supabase/database.types'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  roles: Role[]
}

const GridIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)

const UsersIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

const UploadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

const ChartIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
)

const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)

const TargetIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
)

const LayersIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
)

const InboxIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
)

const DatabaseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12" />
    <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
  </svg>
)

const PeopleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

const SplitIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M16 3h5v5" />
    <path d="M8 3H3v5" />
    <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
    <path d="m15 9 6-6" />
  </svg>
)

const NAV_ITEMS: NavItem[] = [
  { href: '/manager',   label: 'Dashboard', icon: <GridIcon />,  roles: ['branch_manager'] },
  { href: '/district',  label: 'Dashboard', icon: <GridIcon />,  roles: ['district_manager'] },
  { href: '/executive', label: 'Dashboard', icon: <GridIcon />,  roles: ['executive'] },
  { href: '/executive/data-explorer', label: 'Data Explorer', icon: <DatabaseIcon />, roles: ['executive'] },
  { href: '/executive/employees', label: 'Employees', icon: <PeopleIcon />, roles: ['executive'] },
  { href: '/admin',     label: 'Dashboard', icon: <GridIcon />,  roles: ['admin'] },
  { href: '/admin/import',         label: 'Import',         icon: <UploadIcon />,   roles: ['admin'] },
  { href: '/admin/review',         label: 'Review',         icon: <ChartIcon />,    roles: ['admin'] },
  { href: '/admin/employees',      label: 'Employees',      icon: <PeopleIcon />,   roles: ['admin'] },
  { href: '/admin/targets',        label: 'Targets',        icon: <TargetIcon />,   roles: ['admin'] },
  { href: '/admin/fiscal-months',    label: 'Fiscal Months',    icon: <CalendarIcon />, roles: ['admin'] },
  { href: '/admin/fiscal-quarters',    label: 'Fiscal Quarters',   icon: <LayersIcon />,  roles: ['admin'] },
  { href: '/admin/data-explorer',   label: 'Data Explorer',   icon: <DatabaseIcon />, roles: ['admin'] },
  { href: '/admin/allocations',     label: 'Allocations',     icon: <SplitIcon />,    roles: ['admin'] },
  { href: '/admin/access-requests',   label: 'Access Requests',   icon: <InboxIcon />,   roles: ['admin'] },
  { href: '/admin/users',          label: 'Users',          icon: <UsersIcon />,    roles: ['admin'] },
]

interface SidebarProps {
  role: Role
}

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role))
  const [accessRequestCount, setAccessRequestCount] = useState(0)
  const [allocationCount, setAllocationCount] = useState(0)

  useEffect(() => {
    if (role !== 'admin') return
    fetch('/api/admin/access-requests/pending-count')
      .then((r) => r.json())
      .then((json) => { if (json.success) setAccessRequestCount(json.data.count) })
      .catch(() => {})
    fetch('/api/admin/allocations/pending-count')
      .then((r) => r.json())
      .then((json) => { if (json.success) setAllocationCount(json.data.count) })
      .catch(() => {})
  }, [role])

  return (
    <aside className="sidebar">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
        const showBadge =
          (item.href === '/admin/access-requests' && accessRequestCount > 0) ||
          (item.href === '/admin/allocations' && allocationCount > 0)
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`sidebar-icon${isActive ? ' sidebar-icon-active' : ''}`}
            style={{ position: 'relative' }}
          >
            {item.icon}
            {showBadge && (
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#ff6b00',
                  border: '1.5px solid #1a1a1a',
                }}
              />
            )}
          </Link>
        )
      })}
    </aside>
  )
}
