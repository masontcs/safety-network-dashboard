'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
}

export default function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createBrowserClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    // Check if the new password is the same as the current temporary one
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.email) {
      const { error: sameCheck } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: newPassword,
      })
      if (!sameCheck) {
        // Sign-in worked → new password equals the current temporary password
        setError('Your new password cannot be the same as your temporary password.')
        setLoading(false)
        return
      }
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
      return
    }

    // Clear the must_change_password flag
    const res = await fetch('/api/auth/clear-must-change-password', { method: 'POST' })
    if (!res.ok) {
      setError('Password updated but could not finalize — please refresh and try again.')
      setLoading(false)
      return
    }

    // Redirect to root — middleware will send them to their role dashboard
    router.push('/')
  }

  return (
    <div
      className="px-4 md:px-0"
      style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div className="card w-full md:w-[380px]">
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/safety_network_logo.png"
            alt="Safety Network"
            className="block mx-auto w-[120px] md:w-auto md:h-[52px] h-auto mb-4"
          />
          <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
            Set Your Password
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            You must set a new password before continuing.
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              style={INPUT_STYLE}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              style={INPUT_STYLE}
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#cc4444', marginBottom: 16, padding: '8px 10px', background: '#2a1a1a', borderRadius: 6 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ width: '100%', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Saving…' : 'Set Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
