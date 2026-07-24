'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme/ThemeContext'
import { useBranch } from '@/components/billing/BranchContext'

/**
 * The concept's topbar: live search (customers / jobs / tickets / invoices), the
 * active-branch picker, the light/dark toggle, and a working "+ New" quick-create menu.
 */

interface Hit { type: string; label: string; sub: string | null; href: string }

// Quick-create targets. Parent-dependent records (profile/ticket/proof/invoice) drop you
// on the page where you pick the parent, then create from there.
const NEW_ITEMS: { label: string; sub: string; href: string }[] = [
  { label: 'Customer', sub: 'A new billing customer', href: '/billing/customers?new=1' },
  { label: 'Billing profile', sub: 'Open a customer, then add a profile', href: '/billing/customers' },
  { label: 'Job', sub: 'Under a billing profile', href: '/billing/jobs?new=1' },
  { label: 'Ticket', sub: 'Open a job to add a ticket', href: '/billing/jobs' },
  { label: 'Proof', sub: 'Open a job → Generate → Preview', href: '/billing/jobs' },
  { label: 'Invoice', sub: 'Open a job → Generate', href: '/billing/jobs' },
]

export default function BillingTopbar() {
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const { branchId, setBranchId, branches, currentLabel } = useBranch()

  const [branchOpen, setBranchOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const branchRef = useRef<HTMLDivElement>(null)
  const newRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (branchRef.current && !branchRef.current.contains(t)) setBranchOpen(false)
      if (newRef.current && !newRef.current.contains(t)) setNewOpen(false)
      if (searchRef.current && !searchRef.current.contains(t)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Debounced search — fires 250ms after typing stops.
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) { setHits(null); setSearching(false); return }
    setSearching(true)
    const id = setTimeout(() => {
      fetch('/api/billing/search?q=' + encodeURIComponent(query)).then((r) => r.json())
        .then((j) => { if (j.success) setHits(j.data) }).catch(() => {}).finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(id)
  }, [q])

  function go(href: string) {
    setNewOpen(false); setSearchOpen(false); setBranchOpen(false); setQ(''); setHits(null)
    router.push(href)
  }

  return (
    <div className="bx-topbar">
      {/* Search */}
      <div ref={searchRef} style={{ position: 'relative', flex: 1, maxWidth: 460 }}>
        <div className="bx-search">
          <span aria-hidden>⌕</span>
          <input
            placeholder="Search jobs, tickets, customers…" aria-label="Search"
            value={q} onChange={(e) => { setQ(e.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearchOpen(false); setQ('') } }}
          />
        </div>
        {searchOpen && q.trim().length >= 2 && (
          <div style={menuStyle}>
            {searching && (!hits || hits.length === 0) ? (
              <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--dim)' }}>Searching…</div>
            ) : !hits || hits.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--dim)' }}>No matches for “{q.trim()}”.</div>
            ) : (
              hits.map((h, i) => (
                <button key={i} onClick={() => go(h.href)} style={rowStyle}>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--dim)', width: 62, flex: 'none' }}>{h.type}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{h.label}</span>
                  {h.sub && <span style={{ fontSize: 11, color: 'var(--dim)', flex: 'none', fontFamily: 'ui-monospace, monospace' }}>{h.sub}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Branch picker */}
      <div ref={branchRef} style={{ position: 'relative' }}>
        <button className="bx-pill" title="Filter by branch" aria-haspopup="listbox" aria-expanded={branchOpen} onClick={() => setBranchOpen((v) => !v)}>
          {currentLabel} ▾
        </button>
        {branchOpen && (
          <div role="listbox" style={{ ...menuStyle, right: 0, left: 'auto', minWidth: 190 }}>
            <MenuOption label="All branches" active={branchId === ''} onClick={() => { setBranchId(''); setBranchOpen(false) }} />
            {branches.map((b) => (
              <MenuOption key={b.id} label={b.name} sub={b.code} active={branchId === b.id} onClick={() => { setBranchId(b.id); setBranchOpen(false) }} />
            ))}
          </div>
        )}
      </div>

      <button className="bx-iconbtn" onClick={toggle} title="Toggle light / dark" aria-label="Toggle theme">
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      {/* Quick create */}
      <div ref={newRef} style={{ position: 'relative' }}>
        <button className="bx-btn" title="Create something new" aria-haspopup="menu" aria-expanded={newOpen} onClick={() => setNewOpen((v) => !v)}>
          + New ▾
        </button>
        {newOpen && (
          <div role="menu" style={{ ...menuStyle, right: 0, left: 'auto', minWidth: 240 }}>
            {NEW_ITEMS.map((it) => (
              <button key={it.label} role="menuitem" onClick={() => go(it.href)} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{it.label}</span>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>{it.sub}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const menuStyle: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
  background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 10,
  boxShadow: 'var(--shadow-card)', padding: 6, maxHeight: 360, overflowY: 'auto', width: 'max-content', minWidth: 260,
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
  padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 13, background: 'transparent', color: 'var(--ink)',
}

function MenuOption({ label, sub, active, onClick }: { label: string; sub?: string; active: boolean; onClick: () => void }) {
  return (
    <button role="option" aria-selected={active} onClick={onClick}
      style={{ ...rowStyle, background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--ink)' }}>
      <span style={{ flex: 1, fontWeight: active ? 600 : 500 }}>{label}</span>
      {sub && <span style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'ui-monospace, monospace' }}>{sub}</span>}
      {active && <span style={{ color: 'var(--accent)' }}>✓</span>}
    </button>
  )
}
