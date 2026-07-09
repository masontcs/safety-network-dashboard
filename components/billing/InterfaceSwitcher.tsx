'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Switches between the two interfaces that share this app: Dashboards and
 * Billing. Only shows the interfaces the user actually has access to — if they
 * have just one, it renders as a plain, non-interactive brand block.
 *
 * Lives at the top of both sidebars, in the workspace-switcher spot.
 */

export type InterfaceKey = 'dashboards' | 'billing'

const META: Record<InterfaceKey, { label: string; sub: string; href: string; mark: string }> = {
  dashboards: { label: 'Dashboards', sub: 'Safety Network', href: '/dashboard', mark: 'SN' },
  billing: { label: 'Billing', sub: 'Traffic Control Rental', href: '/billing/profiles', mark: 'SN' },
}

interface Props {
  current: InterfaceKey
  available: InterfaceKey[]
  /** Dashboard sidebar collapses to an icon rail; render just the mark. */
  collapsed?: boolean
}

export default function InterfaceSwitcher({ current, available, collapsed = false }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const meta = META[current]
  const canSwitch = available.length > 1

  const mark = (
    <span
      aria-hidden
      style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: current === 'billing' ? 'var(--primary)' : '#ff6b00',
        color: current === 'billing' ? 'var(--brand, #ffcc00)' : '#fff',
        display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, letterSpacing: '-0.02em',
      }}
    >
      {meta.mark}
    </span>
  )

  if (collapsed) {
    return (
      <div title={canSwitch ? `${meta.label} — click to switch` : meta.label}
        onClick={() => canSwitch && setOpen((v) => !v)}
        style={{ display: 'flex', justifyContent: 'center', padding: '8px 0', cursor: canSwitch ? 'pointer' : 'default' }}>
        {mark}
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => canSwitch && setOpen((v) => !v)}
        aria-haspopup={canSwitch ? 'menu' : undefined}
        aria-expanded={canSwitch ? open : undefined}
        disabled={!canSwitch}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 9,
          padding: '8px 10px', borderRadius: 10,
          border: '1px solid var(--border)', background: 'transparent',
          cursor: canSwitch ? 'pointer' : 'default', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        {mark}
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.15 }}>
            {meta.label}
          </span>
          <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {meta.sub}
          </span>
        </span>
        {canSwitch && <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>⌄</span>}
      </button>

      {open && canSwitch && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 60,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: 'var(--shadow-pop, 0 10px 30px -10px rgba(0,0,0,.4))', padding: 5,
          }}
        >
          {available.map((k) => {
            const m = META[k]
            const active = k === current
            return (
              <button
                key={k}
                role="menuitem"
                onClick={() => { setOpen(false); if (!active) router.push(m.href) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 9px', borderRadius: 7, border: 0, cursor: 'pointer',
                  background: active ? 'var(--accent-soft-bg)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-primary)',
                  fontFamily: 'inherit', fontSize: 12.5, fontWeight: active ? 600 : 400, textAlign: 'left',
                }}
              >
                <span style={{ flex: 1 }}>{m.label}</span>
                {active && <span style={{ fontSize: 11 }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
