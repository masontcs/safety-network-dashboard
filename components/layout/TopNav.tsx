'use client'

import { useRouter } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

interface TopNavProps {
  branchName?: string
  userName?: string
}

export default function TopNav({ branchName, userName }: TopNavProps) {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClientComponentClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="top-nav" style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#ffffff' }}>
          Safety Network
        </span>
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
