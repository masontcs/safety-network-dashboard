'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Customer portal sign-in. Password-based: the customer signs in with their email OR their
 * username, plus a password. "Forgot password" emails a reset link. New accounts arrive via
 * an emailed invite that lands on the set-password page.
 */
export default function PortalLoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')

  // sign-in
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // forgot
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/portal/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      })
      const j = await res.json()
      if (!j.success) { setErr(j.error ?? 'Sign-in failed.'); return }
      router.replace('/portal')
    } catch { setErr('Network error — please try again.') }
    finally { setLoading(false) }
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/portal/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      setSent(true)
    } finally { setLoading(false) }
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

        {mode === 'signin' ? (
          <form onSubmit={signIn}>
            <h1 className="bx-h1" style={{ fontSize: 19 }}>Sign in</h1>
            <p className="bx-sub">Use your email or username and your password.</p>

            <label className="bx-lbl" htmlFor="identifier">Email or username</label>
            <input
              id="identifier" required autoFocus autoComplete="username" value={identifier}
              onChange={(e) => setIdentifier(e.target.value)} placeholder="you@company.com"
              className="bx-f" style={{ width: '100%', marginBottom: 12 }}
            />

            <label className="bx-lbl" htmlFor="password">Password</label>
            <input
              id="password" type="password" required autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              className="bx-f" style={{ width: '100%', marginBottom: err ? 8 : 16 }}
            />

            {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}

            <button className="bx-btn accent" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="bx-btn ghost" style={{ width: '100%', marginTop: 10 }}
              onClick={() => { setMode('forgot'); setErr(null); setSent(false) }}>
              Forgot password?
            </button>
          </form>
        ) : sent ? (
          <div>
            <h1 className="bx-h1" style={{ fontSize: 19 }}>Check your email</h1>
            <p className="bx-sub" style={{ marginBottom: 0 }}>
              If <b>{email}</b> has portal access, a reset link is on its way. Open it to choose a new password.
            </p>
            <button className="bx-btn ghost" style={{ marginTop: 18, width: '100%' }}
              onClick={() => { setMode('signin'); setSent(false) }}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={sendReset}>
            <h1 className="bx-h1" style={{ fontSize: 19 }}>Reset password</h1>
            <p className="bx-sub">Enter your account email and we&apos;ll send a reset link.</p>
            <label className="bx-lbl" htmlFor="reset-email">Email</label>
            <input
              id="reset-email" type="email" required autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
              className="bx-f" style={{ width: '100%', marginBottom: 16 }}
            />
            <button className="bx-btn accent" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <button type="button" className="bx-btn ghost" style={{ width: '100%', marginTop: 10 }}
              onClick={() => setMode('signin')}>
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
