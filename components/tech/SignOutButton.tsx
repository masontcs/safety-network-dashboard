'use client'

import { useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

/** Sign out and return to the login screen. */
export default function SignOutButton() {
  const [busy, setBusy] = useState(false)
  async function signOut() {
    if (busy) return
    setBusy(true)
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }
  return (
    <button onClick={signOut} disabled={busy} className="tech-btn ghost sm" aria-label="Sign out">
      {busy ? '…' : 'Sign out'}
    </button>
  )
}
