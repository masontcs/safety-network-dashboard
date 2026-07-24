'use client'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Customer-facing chrome: a slim top bar with the customer's name and a sign-out. No
 * internal nav — the portal is intentionally small. Uses the concept design tokens.
 */
export default function PortalShell({
  customerName, email, name, children,
}: { customerName: string; email: string; name: string | null; children: React.ReactNode }) {
  async function signOut() {
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    window.location.href = '/portal/login'
  }

  return (
    <div>
      <header className="bx-topbar" style={{ position: 'sticky', top: 0, zIndex: 20 }}>
        <div className="bx-brand" style={{ color: 'var(--ink)' }}>
          <span className="dot" aria-hidden />
          <span>
            <b style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.01em', display: 'block' }}>Safety Network</b>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>{customerName}</span>
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: 'var(--muted)', marginRight: 4 }}>{name || email}</span>
        <button onClick={signOut} className="bx-btn ghost sm" style={{ padding: '6px 12px', fontSize: 12.5 }}>
          Sign out
        </button>
      </header>
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 26px 70px' }}>
        {children}
      </main>
    </div>
  )
}
