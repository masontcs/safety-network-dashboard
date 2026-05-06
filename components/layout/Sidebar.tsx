'use client'

import { usePathname } from 'next/navigation'
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

const NAV_ITEMS: NavItem[] = [
  { href: '/manager',   label: 'Dashboard', icon: <GridIcon />,  roles: ['branch_manager'] },
  { href: '/district',  label: 'Dashboard', icon: <GridIcon />,  roles: ['district_manager'] },
  { href: '/executive', label: 'Dashboard', icon: <GridIcon />,  roles: ['executive'] },
  { href: '/admin',     label: 'Dashboard', icon: <GridIcon />,  roles: ['admin'] },
  { href: '/admin/import',         label: 'Import',         icon: <UploadIcon />,   roles: ['admin'] },
  { href: '/admin/review',         label: 'Review',         icon: <ChartIcon />,    roles: ['admin'] },
  { href: '/admin/targets',        label: 'Targets',        icon: <TargetIcon />,   roles: ['admin'] },
  { href: '/admin/fiscal-months',    label: 'Fiscal Months',    icon: <CalendarIcon />, roles: ['admin'] },
  { href: '/admin/fiscal-quarters', label: 'Fiscal Quarters', icon: <LayersIcon />,   roles: ['admin'] },
  { href: '/admin/users',          label: 'Users',          icon: <UsersIcon />,    roles: ['admin'] },
]

interface SidebarProps {
  role: Role
}

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role))

  return (
    <aside className="sidebar">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`sidebar-icon${isActive ? ' sidebar-icon-active' : ''}`}
          >
            {item.icon}
          </Link>
        )
      })}
    </aside>
  )
}
