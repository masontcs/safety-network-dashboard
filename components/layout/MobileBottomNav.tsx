'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import type { Role } from '@/lib/supabase/database.types'

interface Props { role: Role }

const ROLE_HOME: Record<Role, string> = {
  admin:            '/admin',
  executive:        '/executive',
  district_manager: '/district',
  branch_manager:   '/manager',
  ar_manager:       '/ar',
  ar_team:          '/ar',
  project_manager:  '/dashboard',
}

// Additional nav items that go in the "More" sheet
const MORE_ITEMS: Partial<Record<Role, Array<{ href: string; label: string }>>> = {
  admin: [
    { href: '/admin/review', label: 'Review' },
    { href: '/admin/targets', label: 'Targets' },
    { href: '/admin/fiscal-months', label: 'Fiscal Months' },
    { href: '/admin/fiscal-quarters', label: 'Fiscal Quarters' },
    { href: '/admin/access-requests', label: 'Access Requests' },
    { href: '/admin/users', label: 'Users' },
  ],
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#ff6b00' : '#666666'} strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function DatabaseIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#ff6b00' : '#666666'} strokeWidth={1.8}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}

function UploadIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#ff6b00' : '#666666'} strokeWidth={1.8}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function MenuIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#ff6b00' : '#666666'} strokeWidth={1.8}>
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

export default function MobileBottomNav({ role }: Props) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  const homeHref = ROLE_HOME[role]
  const explorerHref = role === 'admin' ? '/admin/data-explorer' : role === 'executive' ? '/executive/data-explorer' : null
  const importHref = role === 'admin' ? '/admin/import' : null
  const moreItems = MORE_ITEMS[role] ?? []

  const isHome = pathname === homeHref
  const isExplorer = explorerHref ? (pathname === explorerHref || pathname.startsWith(explorerHref + '/')) : false
  const isImport = importHref ? (pathname === importHref || pathname.startsWith(importHref + '/')) : false
  const isMore = !isHome && !isExplorer && !isImport

  const navItemStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    textDecoration: 'none',
    fontSize: 10,
    minWidth: 56,
    minHeight: 44,
    padding: '6px 8px',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  return (
    <>
      {menuOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 150,
            display: 'flex',
            alignItems: 'flex-end',
          }}
          onClick={() => setMenuOpen(false)}
        >
          <div
            style={{
              background: '#1a1a1a',
              borderRadius: '16px 16px 0 0',
              borderTop: '1px solid #2a2a2a',
              paddingBottom: 60,
              width: '100%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px 8px', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              More
            </div>
            {moreItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '14px 20px',
                    fontSize: 15,
                    fontWeight: active ? 500 : 400,
                    color: active ? '#ff6b00' : '#cccccc',
                    textDecoration: 'none',
                    borderBottom: '1px solid #2a2a2a',
                    minHeight: 44,
                  }}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      )}

      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 60,
          background: '#1a1a1a',
          borderTop: '1px solid #2a2a2a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          zIndex: 100,
        }}
      >
        <Link href={homeHref} style={{ ...navItemStyle, color: isHome ? '#ff6b00' : '#666666' }}>
          <GridIcon active={isHome} />
          <span>Dashboard</span>
        </Link>

        {explorerHref && (
          <Link href={explorerHref} style={{ ...navItemStyle, color: isExplorer ? '#ff6b00' : '#666666' }}>
            <DatabaseIcon active={isExplorer} />
            <span>Explorer</span>
          </Link>
        )}

        {importHref && (
          <Link href={importHref} style={{ ...navItemStyle, color: isImport ? '#ff6b00' : '#666666' }}>
            <UploadIcon active={isImport} />
            <span>Import</span>
          </Link>
        )}

        {moreItems.length > 0 && (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{ ...navItemStyle, color: isMore || menuOpen ? '#ff6b00' : '#666666' }}
          >
            <MenuIcon active={isMore || menuOpen} />
            <span>More</span>
          </button>
        )}
      </nav>
    </>
  )
}
