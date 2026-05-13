'use client'

import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'

interface TopNavProps {
  branchName?: string
  userName?: string
}

export default function TopNav({ branchName, userName }: TopNavProps) {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="top-nav" style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Safety Network" style={{ height: 24, width: 'auto' }} />
        {branchName && (
          <>
            <span style={{ color: '#333333' }}>/</span>
            <span className="branch-name" style={{ fontSize: 13, fontWeight: 500 }}>
              {branchName}
            </span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {userName && (
          <span style={{ fontSize: 12, color: '#888888' }}>{userName}</span>
        )}
        <button
          onClick={handleSignOut}
          style={{
            background: 'none',
            border: '1px solid #333333',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            color: '#888888',
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
