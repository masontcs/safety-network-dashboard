'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import CmrIcon from '@/components/cmr/CmrIcon'
import CmrSignOutButton from '@/components/cmr/CmrSignOutButton'
import { CMR_HELP_HREF, CMR_ROLE_LABEL, cmrSidebarFor, type CmrRole } from '@/lib/cmr/roles'
import { CMR_THEME_COOKIE, type CmrTheme } from '@/lib/cmr/theme'

/**
 * The Cash Ledger chrome: grouped sidebar (role-gated), slim top bar with the light/dark
 * toggle, and the content column. On narrow screens the sidebar becomes a drawer.
 *
 * The nav is cmrSidebarFor(role) — cmrNavFor(role) plus the Help group. Hiding a link is cosmetic; the (controller) layout
 * and the /api/cmr guards are what actually enforce it.
 */

const isActive = (pathname: string, href: string) =>
  href === '/cmr' ? pathname === '/cmr' : pathname === href || pathname.startsWith(href + '/')

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export default function CmrShell({
  role,
  displayName,
  children,
}: {
  role: CmrRole
  displayName: string
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? '/cmr'
  const groups = cmrSidebarFor(role)
  const current = groups.flatMap((g) => g.items).find((i) => isActive(pathname, i.href))

  // ── mobile drawer ──
  const [open, setOpen] = useState(false)
  const sideRef = useRef<HTMLElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) menuBtnRef.current?.focus()
  }, [])
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return
    sideRef.current?.querySelector<HTMLElement>('a[href]')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  // ── theme (light default; cookie so the server paints the right one) ──
  const rootRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<CmrTheme>('light')
  useEffect(() => {
    const t = rootRef.current?.closest('.cmr-root')?.getAttribute('data-theme')
    setTheme(t === 'dark' ? 'dark' : 'light')
  }, [])
  function toggleTheme() {
    const next: CmrTheme = theme === 'dark' ? 'light' : 'dark'
    rootRef.current?.closest('.cmr-root')?.setAttribute('data-theme', next)
    document.cookie = `${CMR_THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    setTheme(next)
  }

  return (
    <div className="cmr-shell" ref={rootRef}>
      <a className="cmr-skip" href="#cmr-main">Skip to content</a>

      <aside
        className="cmr-side"
        id="cmr-sidebar"
        ref={sideRef}
        data-open={open ? 'true' : 'false'}
        aria-label="Cash Ledger"
      >
        <Link href="/cmr" className="cmr-brand">
          <span className="cmr-mark" aria-hidden="true">SN</span>
          <span>
            <b className="cmr-serif">Cash Ledger</b>
            <small>Safety Network</small>
          </span>
        </Link>

        <nav aria-label="Cash Ledger sections">
          {groups.map((g) => (
            <div key={g.label}>
              <h2 className="cmr-navgroup" id={`cmr-nav-${g.label.toLowerCase()}`}>{g.label}</h2>
              <ul className="cmr-navlist" aria-labelledby={`cmr-nav-${g.label.toLowerCase()}`}>
                {g.items.map((item) => {
                  const active = isActive(pathname, item.href)
                  return (
                    <li key={item.href}>
                      <Link href={item.href} className="cmr-nav" aria-current={active ? 'page' : undefined}>
                        <CmrIcon name={item.icon} />
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="cmr-side-foot">
          <span className="cmr-avatar" aria-hidden="true">{initials(displayName)}</span>
          <div className="who">
            <div className="nm">{displayName || 'Signed in'}</div>
            <div className="rl">{CMR_ROLE_LABEL[role]}</div>
          </div>
          <CmrSignOutButton />
        </div>
      </aside>
      <div className="cmr-backdrop" data-open={open ? 'true' : 'false'} onClick={() => close(false)} aria-hidden="true" />

      <div className="cmr-main">
        <header className="cmr-top">
          <button
            ref={menuBtnRef}
            type="button"
            className="cmr-iconbtn cmr-menu-btn"
            aria-label="Open navigation"
            aria-controls="cmr-sidebar"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <CmrIcon name="menu" />
          </button>
          <span className="cmr-top-title cmr-serif">{current?.label ?? 'Cash Ledger'}</span>
          <span className="spacer" />
          {role !== 'controller' && (
            <span className="cmr-pill viewer" title="You can view the Cash Ledger but not change it">
              <CmrIcon name="lock" size={11} /> {role === 'requester' ? 'Read only · can request' : 'Read only'}
            </span>
          )}
          <Link
            href={CMR_HELP_HREF}
            className="cmr-iconbtn"
            aria-label="How to use"
            title="How to use"
            aria-current={isActive(pathname, CMR_HELP_HREF) ? 'page' : undefined}
          >
            <CmrIcon name="help" />
          </Link>
          <button
            type="button"
            className="cmr-iconbtn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            <CmrIcon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </header>

        <main className="cmr-content" id="cmr-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  )
}
