'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import { useTheme } from '@/lib/theme/ThemeContext'
import InterfaceSwitcher, { type InterfaceKey } from '@/components/billing/InterfaceSwitcher'

/**
 * The billing interface's own navigation. Deliberately NOT the dashboard
 * sidebar: different sections, different information architecture, and the
 * active item carries the restrained orange accent (left bar + icon tint).
 *
 * Sections mirror the domain: the work you do daily (Billing) vs the things you
 * configure once (Setup).
 */

interface NavItem { href: string; label: string; icon: string; soon?: boolean }
interface NavSection { heading: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    heading: 'Billing',
    items: [
      { href: '/billing/profiles', label: 'Billing Profiles', icon: '❏' },
      { href: '/billing/jobs', label: 'Jobs', icon: '▤' },
      { href: '/billing/tickets', label: 'Tickets', icon: '▣' },
      { href: '/billing/invoices', label: 'Invoices', icon: '⌗' },
    ],
  },
  {
    heading: 'Setup',
    items: [
      { href: '/billing/items', label: 'Items', icon: '≣' },
      { href: '/billing/price-lists', label: 'Price Lists', icon: '≡' },
      { href: '/billing/settings', label: 'Settings', icon: '⚙', soon: true },
    ],
  },
]

export default function BillingSidebar({ userName, available }: { userName: string; available: InterfaceKey[] }) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, toggle } = useTheme()

  async function signOut() {
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside
      style={{
        width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--bg-nav)', borderRight: '1px solid var(--border)',
        padding: '12px 10px', overflowY: 'auto',
      }}
    >
      <InterfaceSwitcher current="billing" available={available} />

      {SECTIONS.map((section) => (
        <div key={section.heading}>
          <div style={{
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em',
            color: 'var(--text-dim)', padding: '12px 10px 4px',
          }}>
            {section.heading}
          </div>

          {section.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')

            if (item.soon) {
              return (
                <div key={item.href} title="Not built yet"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px',
                    borderRadius: 10, fontSize: 13, color: 'var(--text-faint)', cursor: 'default', userSelect: 'none',
                  }}>
                  <span style={{ width: 16, textAlign: 'center', fontSize: 13 }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>soon</span>
                </div>
              )
            }

            return (
              <Link key={item.href} href={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px',
                  borderRadius: 10, fontSize: 13, textDecoration: 'none', position: 'relative',
                  background: active ? 'var(--bg-tertiary)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: active ? 500 : 400,
                }}>
                {/* the accent's entire job on this screen: mark where you are */}
                {active && (
                  <span aria-hidden style={{
                    position: 'absolute', left: 0, top: 6, bottom: 6, width: 2,
                    borderRadius: 2, background: 'var(--accent)',
                  }} />
                )}
                <span style={{ width: 16, textAlign: 'center', fontSize: 13, color: active ? 'var(--accent)' : 'var(--text-dim)' }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </div>
      ))}

      <div style={{ flex: 1 }} />

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 8px' }}>
          <span style={{
            width: 26, height: 26, borderRadius: '50%', background: 'var(--primary)', color: 'var(--on-primary)',
            display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0,
          }}>
            {(userName || '?').slice(0, 2).toUpperCase()}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userName}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={toggle} title="Toggle theme"
            style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
          <button onClick={signOut} title="Sign out"
            style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
