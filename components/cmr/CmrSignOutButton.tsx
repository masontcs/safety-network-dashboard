'use client'

import { useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import CmrIcon from '@/components/cmr/CmrIcon'

/** Signs out and goes to /login (a full navigation, so no cached CMR view survives). */
export default function CmrSignOutButton({ variant = 'icon' }: { variant?: 'icon' | 'button' }) {
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    try {
      await createBrowserClient().auth.signOut()
    } finally {
      window.location.href = '/login'
    }
  }

  if (variant === 'button') {
    return (
      <button type="button" className="cmr-btn ghost" onClick={signOut} disabled={busy}>
        <CmrIcon name="signout" /> {busy ? 'Signing out…' : 'Sign out'}
      </button>
    )
  }
  return (
    <button type="button" className="cmr-iconbtn" onClick={signOut} disabled={busy} aria-label="Sign out" title="Sign out">
      <CmrIcon name="signout" />
    </button>
  )
}
