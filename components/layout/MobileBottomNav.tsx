'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import type { Role } from '@/lib/supabase/database.types'

interface Props { role: Role }

// ─── Icons ────────────────────────────────────────────────────────────────────

function GridIcon({ a }: { a: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#ff6b00' : '#666'} strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function ArIcon({ a }: { a: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#ff6b00' : '#666'} strokeWidth={1.8}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <path d="M7 15h2" />
      <path d="M11 15h4" />
    </svg>
  )
}

function FuelIcon({ a }: { a: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#ff6b00' : '#666'} strokeWidth={1.8}>
      <path d="M3 22V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M3 22h12" />
      <path d="M15 8h2a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2h0" />
      <path d="M19 22V12" />
      <line x1="7" y1="10" x2="11" y2="10" />
    </svg>
  )
}

function UploadIcon({ a }: { a: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#ff6b00' : '#666'} strokeWidth={1.8}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function EmployeesIcon({ a }: { a: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#ff6b00' : '#666'} strokeWidth={1.8}>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
      <path d="M19 8v6M16 11h6" />
    </svg>
  )
}

function MenuIcon({ a }: { a: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#ff6b00' : '#666'} strokeWidth={1.8}>
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function LogOutIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth={1.8}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

// ─── Nav config ───────────────────────────────────────────────────────────────

type PrimaryItem = { href: string; label: string; icon: (a: boolean) => React.ReactNode; exact?: boolean }
type MoreItem    = { href: string; label: string }
type NavConfig   = { primary: PrimaryItem[]; more: MoreItem[] }

const NAV_CONFIG: Record<Role, NavConfig> = {
  admin: {
    primary: [
      { href: '/dashboard',      label: 'Dashboard', icon: (a) => <GridIcon a={a} />, exact: true },
      { href: '/ar',             label: 'AR',         icon: (a) => <ArIcon a={a} /> },
      { href: '/fuel',           label: 'Fuel',       icon: (a) => <FuelIcon a={a} /> },
      { href: '/admin/employees', label: 'Employees', icon: (a) => <EmployeesIcon a={a} /> },
    ],
    more: [
      { href: '/admin/import',          label: 'Import' },
      { href: '/admin/review',          label: 'Review' },
      { href: '/admin/targets',         label: 'Targets' },
      { href: '/admin/data-explorer',   label: 'Data Explorer' },
      { href: '/admin/allocations',     label: 'Allocations' },
      { href: '/admin/fiscal-months',   label: 'Fiscal Months' },
      { href: '/admin/fiscal-quarters', label: 'Fiscal Quarters' },
      { href: '/admin/payroll-items',   label: 'Pay Items' },
      { href: '/admin/access-requests', label: 'Access Requests' },
      { href: '/admin/users',           label: 'Users' },
      { href: '/admin/settings',        label: 'Settings' },
    ],
  },
  executive: {
    primary: [
      { href: '/dashboard', label: 'Dashboard', icon: (a) => <GridIcon a={a} />, exact: true },
      { href: '/ar',        label: 'AR',         icon: (a) => <ArIcon a={a} /> },
      { href: '/fuel',      label: 'Fuel',       icon: (a) => <FuelIcon a={a} /> },
    ],
    more: [
      { href: '/executive/data-explorer', label: 'Data Explorer' },
      { href: '/executive/employees',     label: 'Employees' },
    ],
  },
  district_manager: {
    primary: [
      { href: '/dashboard', label: 'Dashboard', icon: (a) => <GridIcon a={a} />, exact: true },
      { href: '/ar',        label: 'AR',         icon: (a) => <ArIcon a={a} /> },
    ],
    more: [],
  },
  branch_manager: {
    primary: [
      { href: '/dashboard', label: 'Dashboard', icon: (a) => <GridIcon a={a} />, exact: true },
      { href: '/ar',        label: 'AR',         icon: (a) => <ArIcon a={a} /> },
    ],
    more: [],
  },
  ar_manager: {
    primary: [
      { href: '/ar', label: 'AR', icon: (a) => <ArIcon a={a} /> },
    ],
    more: [],
  },
  ar_team: {
    primary: [
      { href: '/ar', label: 'AR', icon: (a) => <ArIcon a={a} /> },
    ],
    more: [],
  },
  project_manager: {
    primary: [
      { href: '/dashboard', label: 'Dashboard', icon: (a) => <GridIcon a={a} />, exact: true },
      { href: '/ar',        label: 'AR',         icon: (a) => <ArIcon a={a} /> },
    ],
    more: [],
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MobileBottomNav({ role }: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  const config  = NAV_CONFIG[role]
  const hasMore = config.more.length > 0

  async function handleSignOut() {
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function isActive(item: PrimaryItem) {
    return item.exact ? pathname === item.href : (pathname === item.href || pathname.startsWith(item.href + '/'))
  }

  const isMoreActive = config.more.some((m) => pathname === m.href || pathname.startsWith(m.href + '/'))

  const itemStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    textDecoration: 'none', fontSize: 10, minWidth: 52, minHeight: 44,
    padding: '6px 8px', justifyContent: 'center',
    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  }

  return (
    <>
      {/* More sheet */}
      {menuOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 150, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setMenuOpen(false)}
        >
          <div
            style={{ background: '#1a1a1a', borderRadius: '16px 16px 0 0', borderTop: '1px solid #2a2a2a', paddingBottom: 64, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px 8px', fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              More
            </div>
            {config.more.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', padding: '14px 20px', minHeight: 52,
                    fontSize: 15, fontWeight: active ? 500 : 400,
                    color: active ? '#ff6b00' : '#ccc',
                    textDecoration: 'none', borderBottom: '1px solid #222',
                  }}
                >
                  {item.label}
                </Link>
              )
            })}
            <button
              onClick={handleSignOut}
              style={{
                display: 'flex', alignItems: 'center', padding: '14px 20px', minHeight: 52,
                fontSize: 15, width: '100%', textAlign: 'left',
                background: 'none', border: 'none', color: '#666',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 60, background: '#1a1a1a', borderTop: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-around', zIndex: 100 }}>
        {config.primary.map((item) => {
          const active = isActive(item)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{ ...itemStyle, color: active ? '#ff6b00' : '#666' }}
            >
              {item.icon(active)}
              <span>{item.label}</span>
            </Link>
          )
        })}

        {hasMore ? (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{ ...itemStyle, color: isMoreActive || menuOpen ? '#ff6b00' : '#666' }}
          >
            <MenuIcon a={isMoreActive || menuOpen} />
            <span>More</span>
          </button>
        ) : (
          <button onClick={handleSignOut} style={{ ...itemStyle, color: '#666' }}>
            <LogOutIcon />
            <span>Sign Out</span>
          </button>
        )}
      </nav>
    </>
  )
}
