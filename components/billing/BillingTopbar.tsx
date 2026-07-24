'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/lib/theme/ThemeContext'
import { useBranch } from '@/components/billing/BranchContext'

/**
 * The concept's topbar: search, the active-branch picker, the light/dark toggle, and
 * + New. The branch picker scopes every list view (dashboard, jobs, tickets, invoices,
 * quotes). Search and + New are still placeholders.
 */
export default function BillingTopbar() {
  const { theme, toggle } = useTheme()
  const { branchId, setBranchId, branches, currentLabel } = useBranch()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close the branch menu on any outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(id: string) { setBranchId(id); setOpen(false) }

  return (
    <div className="bx-topbar">
      <div className="bx-search">
        <span aria-hidden>⌕</span>
        <input placeholder="Search jobs, tickets, customers…" aria-label="Search" />
      </div>

      <div ref={ref} style={{ position: 'relative' }}>
        <button className="bx-pill" title="Filter by branch" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {currentLabel} ▾
        </button>
        {open && (
          <div role="listbox" style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, minWidth: 190, zIndex: 50,
            background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 10,
            boxShadow: 'var(--shadow-card)', padding: 6, maxHeight: 320, overflowY: 'auto',
          }}>
            <BranchOption label="All branches" active={branchId === ''} onClick={() => pick('')} />
            {branches.map((b) => (
              <BranchOption key={b.id} label={b.name} sub={b.code} active={branchId === b.id} onClick={() => pick(b.id)} />
            ))}
          </div>
        )}
      </div>

      <button className="bx-iconbtn" onClick={toggle} title="Toggle light / dark" aria-label="Toggle theme">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button className="bx-btn" title="Quick create">+ New</button>
    </div>
  )
}

function BranchOption({ label, sub, active, onClick }: { label: string; sub?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      role="option" aria-selected={active} onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 13, background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--ink)',
      }}
    >
      <span style={{ flex: 1, fontWeight: active ? 600 : 500 }}>{label}</span>
      {sub && <span style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'ui-monospace, monospace' }}>{sub}</span>}
      {active && <span style={{ color: 'var(--accent)' }}>✓</span>}
    </button>
  )
}
