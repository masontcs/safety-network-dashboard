'use client'

import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { useTheme } from '@/lib/theme/ThemeContext'

interface TopNavProps {
  branchName?: string
  userName?: string
}

export default function TopNav({ branchName, userName }: TopNavProps) {
  const router = useRouter()
  const { theme } = useTheme()

  async function handleSignOut() {
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="top-nav" style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="Safety Network"
          style={{
            height: 24,
            width: 'auto',
            // Logo is white — invert to dark in light mode
            filter: theme === 'light' ? 'brightness(0)' : 'none',
          }}
        />
        {branchName && (
          <>
            <span style={{ color: 'var(--text-dim)' }}>/</span>
            <span className="branch-name" style={{ fontSize: 13, fontWeight: 500 }}>
              {branchName}
            </span>
          </>
        )}
      </div>

      {/* Hidden on mobile — sign-out lives in bottom nav More sheet */}
      <div className="hidden md:flex" style={{ alignItems: 'center', gap: 12 }}>
        {userName && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{userName}</span>
        )}
        <button
          onClick={handleSignOut}
          style={{
            background: 'none',
            border: '1px solid var(--border-emphasis)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
