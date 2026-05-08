'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Role } from '@/lib/supabase/database.types'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  roles: Role[]
  exactMatch?: boolean
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

const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const FuelIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M3 22V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
    <path d="M3 22h12" />
    <path d="M15 8h2a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2h0" />
    <path d="M19 22V12" />
    <line x1="7" y1="10" x2="11" y2="10" />
  </svg>
)

const LogOutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
)

const NAV_ITEMS: NavItem[] = [
  { href: '/manager',   label: 'Dashboard', icon: <GridIcon />,  roles: ['branch_manager'], exactMatch: true },
  { href: '/district',  label: 'Dashboard', icon: <GridIcon />,  roles: ['district_manager'], exactMatch: true },
  { href: '/executive', label: 'Dashboard', icon: <GridIcon />,  roles: ['executive'], exactMatch: true },
  { href: '/fuel', label: 'Fuel', icon: <FuelIcon />, roles: ['branch_manager', 'district_manager', 'executive'] },
  { href: '/executive/data-explorer', label: 'Data Explorer', icon: <DatabaseIcon />, roles: ['executive'] },
  { href: '/executive/employees', label: 'Employees', icon: <PeopleIcon />, roles: ['executive'] },
  { href: '/admin',     label: 'Dashboard', icon: <GridIcon />,  roles: ['admin'], exactMatch: true },
  { href: '/fuel', label: 'Fuel', icon: <FuelIcon />, roles: ['admin'] },
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
  { href: '/admin/settings',       label: 'Settings',       icon: <SettingsIcon />, roles: ['admin'] },
]

interface SidebarProps {
  role: Role
}

const COLLAPSED_W = 48
const EXPANDED_W = 220

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role))
  const [expanded, setExpanded] = useState(false)
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

  async function handleSignOut() {
    const supabase = createClientComponentClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const labelStyle = {
    flex: 1,
    fontSize: 13,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    opacity: expanded ? 1 : 0,
    transition: `opacity ${expanded ? '100ms' : '50ms'} ease-in-out`,
    transitionDelay: expanded ? '100ms' : '0ms',
  }

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        width: expanded ? EXPANDED_W : COLLAPSED_W,
        minWidth: expanded ? EXPANDED_W : COLLAPSED_W,
        background: '#1a1a1a',
        borderRight: '1px solid #2a2a2a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
        transition: 'width 200ms ease-in-out, min-width 200ms ease-in-out',
        zIndex: 10,
      }}
    >
      {/* Branding */}
      <div style={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        padding: '0 6px',
        flexShrink: 0,
        borderBottom: '1px solid #2a2a2a',
        marginBottom: 8,
      }}>
        <div style={{
          width: 36,
          height: 36,
          background: '#ff6b00',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>SN</span>
        </div>
        <span style={{
          marginLeft: 10,
          fontSize: 13,
          fontWeight: 600,
          color: '#ffffff',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          opacity: expanded ? 1 : 0,
          transition: `opacity ${expanded ? '100ms' : '50ms'} ease-in-out`,
          transitionDelay: expanded ? '100ms' : '0ms',
        }}>
          Safety Network
        </span>
      </div>

      {/* Nav items */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '0 6px',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        {items.map((item) => {
          const isActive = item.exactMatch
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + '/')
          const count =
            item.href === '/admin/access-requests' ? accessRequestCount
            : item.href === '/admin/allocations' ? allocationCount
            : 0
          const showBadge = count > 0
          return (
            <Link
              key={item.href}
              href={item.href}
              title={expanded ? undefined : item.label}
              className={`sidebar-link${isActive ? ' sidebar-link-active' : ''}`}
              style={{ padding: '0 9px', position: 'relative' }}
            >
              <span style={{ flexShrink: 0, display: 'flex', width: 18 }}>
                {item.icon}
              </span>
              <span style={labelStyle}>{item.label}</span>
              {showBadge && expanded && (
                <span style={{
                  background: '#ff6b00',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 10,
                  minWidth: 18,
                  textAlign: 'center',
                  flexShrink: 0,
                }}>
                  {count}
                </span>
              )}
              {showBadge && !expanded && (
                <span style={{
                  position: 'absolute',
                  top: 5,
                  right: 5,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#ff6b00',
                  border: '1.5px solid #1a1a1a',
                }} />
              )}
            </Link>
          )
        })}
      </div>

      {/* Sign out */}
      <div style={{ padding: '8px 6px', borderTop: '1px solid #2a2a2a', flexShrink: 0 }}>
        <button
          onClick={handleSignOut}
          className="sidebar-link"
          style={{ padding: '0 9px', border: 'none', background: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <span style={{ flexShrink: 0, display: 'flex', width: 18 }}>
            <LogOutIcon />
          </span>
          <span style={{ ...labelStyle, textAlign: 'left' }}>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}
