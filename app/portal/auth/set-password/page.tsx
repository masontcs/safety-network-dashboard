'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Landing for an invite or password-reset link. By the time we're here the callback has
 * already exchanged the link's code for a session, so the customer just picks a password
 * (and, optionally, a short username for quicker sign-ins). On success they go to /portal.
 */
export default function SetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [username, setUsername] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setErr('Those passwords don’t match.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/portal/set-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, username: username.trim() || undefined }),
      })
      const j = await res.json()
      if (!j.success) { setErr(j.error ?? 'Could not set your password.'); return }
      router.replace('/portal')
    } catch { setErr('Network error — please try again.') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 400 }}>
        <div className="bx-brand" style={{ color: 'var(--ink)', marginBottom: 18 }}>
          <span className="dot" aria-hidden />
          <span>
            <b style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em', display: 'block' }}>Safety Network</b>
            <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>Customer portal</span>
          </span>
        </div>

        <form onSubmit={submit}>
          <h1 className="bx-h1" style={{ fontSize: 19 }}>Set your password</h1>
          <p className="bx-sub">Choose a password to finish setting up your account.</p>

          <label className="bx-lbl" htmlFor="pw">New password</label>
          <input id="pw" type="password" required autoFocus autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
            className="bx-f" style={{ width: '100%', marginBottom: 12 }} />

          <label className="bx-lbl" htmlFor="pw2">Confirm password</label>
          <input id="pw2" type="password" required autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter it"
            className="bx-f" style={{ width: '100%', marginBottom: 12 }} />

          <label className="bx-lbl" htmlFor="un">Username <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(optional — for quicker sign-in)</span></label>
          <input id="un" value={username} autoComplete="username"
            onChange={(e) => setUsername(e.target.value)} placeholder="e.g. acme-jobs"
            className="bx-f" style={{ width: '100%', marginBottom: err ? 8 : 16 }} />

          {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}

          <button className="bx-btn accent" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Saving…' : 'Save & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
