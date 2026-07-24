'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import InterfaceSwitcher, { type InterfaceKey } from '@/components/billing/InterfaceSwitcher'

/**
 * Billing navigation — the concept's sidebar: brand mark, grouped nav (Operate /
 * Money / Setup), the active item filled with ink, unbuilt screens shown as "soon".
 * Styling lives in app/billing/billing.css (.bx-side / .bx-nav / .bx-brand).
 */

interface NavItem { href: string; label: string; icon: string; soon?: boolean; exact?: boolean; badge?: number }
interface NavSection { heading: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    heading: 'Operate',
    items: [
      { href: '/billing', label: 'Dashboard', icon: '◧', exact: true },
      { href: '/billing/dispatch', label: 'Dispatch', icon: '▦' },
      { href: '/billing/jobs', label: 'Jobs', icon: '▤' },
      { href: '/billing/tickets', label: 'Tickets', icon: '▣' },
      { href: '/billing/quotes', label: 'Quotes', icon: '▧' },
    ],
  },
  {
    heading: 'Money',
    items: [
      { href: '/billing/invoices', label: 'Invoices', icon: '⌗' },
      { href: '/billing/customers', label: 'Customers', icon: '◍' },
    ],
  },
  {
    heading: 'Setup',
    items: [
      { href: '/billing/items', label: 'Items', icon: '≣' },
      { href: '/billing/price-lists', label: 'Price Lists', icon: '≡' },
      { href: '/billing/technicians', label: 'Technicians', icon: '☰' },
    ],
  },
]

export default function BillingSidebar({ userName, available }: { userName: string; available: InterfaceKey[] }) {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="bx-side">
      <Link href="/billing" className="bx-brand" style={{ color: 'var(--ink)' }}>
        <span className="dot" aria-hidden />
        <span>
          <b style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-.01em', display: 'block' }}>Safety Network</b>
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>Rental billing</span>
        </span>
      </Link>

      {SECTIONS.map((section) => (
        <div key={section.heading}>
          <div className="bx-navgroup">{section.heading}</div>
          {section.items.map((item) => {
            const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/')
            if (item.soon) {
              return (
                <div key={item.href} className="bx-nav soon" title="Coming in a later phase">
                  <span style={{ width: 16, textAlign: 'center' }}>{item.icon}</span>
                  <span>{item.label}</span>
                  <span className="soontag">soon</span>
                </div>
              )
            }
            return (
              <Link key={item.href} href={item.href} className={`bx-nav${active ? ' active' : ''}`} style={{ color: active ? 'var(--surface)' : 'var(--muted)' }}>
                <span style={{ width: 16, textAlign: 'center' }}>{item.icon}</span>
                <span>{item.label}</span>
                {item.badge ? <span className="badge">{item.badge}</span> : null}
              </Link>
            )
          })}
        </div>
      ))}

      <div style={{ flex: 1 }} />

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}>
        <InterfaceSwitcher current="billing" available={available} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 6px 4px' }}>
          <span className="avatar" style={{ width: 30, height: 30 }}>{(userName || '?').slice(0, 2).toUpperCase()}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</span>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>Admin · Bakersfield</span>
          </span>
          <button onClick={signOut} title="Sign out" className="bx-iconbtn" style={{ width: 30, height: 30, fontSize: 13 }}>⏻</button>
        </div>
      </div>
    </aside>
  )
}
