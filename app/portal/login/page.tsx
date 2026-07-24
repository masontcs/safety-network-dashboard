'use client'

import { useState } from 'react'

/**
 * Customer portal sign-in. Email → magic link (no passwords). The request always reports
 * success; a link is only actually sent to a provisioned account (see request-link route).
 */
export default function PortalLoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/portal/request-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      setSent(true)
    } finally {
      setLoading(false)
    }
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

        {sent ? (
          <div>
            <h1 className="bx-h1" style={{ fontSize: 19 }}>Check your email</h1>
            <p className="bx-sub" style={{ marginBottom: 0 }}>
              If <b>{email}</b> has portal access, a sign-in link is on its way. Open it on this
              device to continue.
            </p>
            <button className="bx-btn ghost" style={{ marginTop: 18 }} onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="bx-h1" style={{ fontSize: 19 }}>Sign in</h1>
            <p className="bx-sub">Enter your email and we&apos;ll send you a secure sign-in link.</p>
            <label className="bx-lbl" htmlFor="email">Email</label>
            <input
              id="email" type="email" required autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
              className="bx-f" style={{ width: '100%', marginBottom: 16 }}
            />
            <button className="bx-btn accent" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
