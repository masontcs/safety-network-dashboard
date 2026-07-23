'use client'

import { useTheme } from '@/lib/theme/ThemeContext'

/**
 * The concept's topbar: search, a branch filter, the light/dark toggle, and + New.
 * Sticky, translucent-blur. Search and + New are placeholders for now.
 */
export default function BillingTopbar() {
  const { theme, toggle } = useTheme()
  return (
    <div className="bx-topbar">
      <div className="bx-search">
        <span aria-hidden>⌕</span>
        <input placeholder="Search jobs, tickets, customers…" aria-label="Search" />
      </div>
      <button className="bx-pill" title="Filter by branch">Bakersfield ▾</button>
      <button className="bx-iconbtn" onClick={toggle} title="Toggle light / dark" aria-label="Toggle theme">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button className="bx-btn" title="Quick create">+ New</button>
    </div>
  )
}
