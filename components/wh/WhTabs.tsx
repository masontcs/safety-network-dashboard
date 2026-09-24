'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * The Western Highways section's own sub-navigation. WH is a separate company sitting inside
 * the dashboards interface, so it gets a tab strip of its own rather than more items in the
 * main sidebar — which also keeps it visibly apart from the Safety Network A/R pages.
 */

const TABS = [
  { href: '/wh/ar', label: 'A/R Aging' },
  { href: '/wh/ap', label: 'A/P Aging' },
  { href: '/wh/import', label: 'Import' },
]

export default function WhTabs({ canUpload }: { canUpload: boolean }) {
  const pathname = usePathname()
  const tabs = canUpload ? TABS : TABS.filter((t) => t.href !== '/wh/import')

  return (
    <nav
      aria-label="Western Highways"
      style={{
        display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)',
        overflowX: 'auto', WebkitOverflowScrolling: 'touch',
      }}
    >
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            style={{
              padding: '10px 14px',
              fontSize: 13,
              whiteSpace: 'nowrap',
              color: active ? '#ff6b00' : 'var(--text-muted)',
              borderBottom: `2px solid ${active ? '#ff6b00' : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
