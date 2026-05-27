'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Branch {
  id: string
  name: string
  is_revenue_generating: boolean
}

const ROLE_OPTIONS = [
  { value: 'branch_manager',   label: 'Branch Manager' },
  { value: 'district_manager', label: 'District Manager' },
  { value: 'executive',        label: 'Executive' },
  { value: 'ar_manager',       label: 'AR Manager' },
  { value: 'ar_team',          label: 'AR Team' },
  { value: 'office_team',      label: 'Office Team' },
  { value: 'project_manager',  label: 'Project Manager' },
  { value: 'sales',            label: 'Sales' },
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  padding: '9px 12px',
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-muted)',
  marginBottom: 6,
  fontWeight: 400,
}

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/

export default function RequestAccessClient({ branches }: { branches: Branch[] }) {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    username: '',
    branchId: '',
    requestedRole: '',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Validate username format before submitting
    const uname = form.username.trim().toLowerCase()
    if (!USERNAME_REGEX.test(uname)) {
      setError('Username must be 3–20 characters and contain only lowercase letters, numbers, or underscores.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, username: uname }),
      })
      const json = await res.json()
      if (!json.success) {
        setError(json.error ?? 'Something went wrong.')
        return
      }
      setSubmitted(true)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        backgroundImage: 'radial-gradient(circle, #1e1e1e 1px, transparent 1px)',
        backgroundSize: '28px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          padding: 32,
          width: '100%',
          maxWidth: 480,
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/safety_network_logo.png"
            alt="Safety Network"
            style={{ width: 120, height: 'auto', marginBottom: 20 }}
          />
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            Request Access
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Submit your details and an administrator will create your account
          </div>
        </div>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: '#1a3a1a',
                border: '1px solid #4caf50',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth={2.5}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              Request submitted!
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              You&rsquo;ll hear from us within 1 business day.
            </div>
            <Link
              href="/"
              style={{ display: 'inline-block', marginTop: 20, fontSize: 13, color: '#ff6b00', textDecoration: 'none' }}
            >
              ← Back to home
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Name row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>First Name *</label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => set('firstName', e.target.value)}
                  required
                  autoComplete="given-name"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Last Name *</label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => set('lastName', e.target.value)}
                  required
                  autoComplete="family-name"
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Work Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                required
                autoComplete="email"
                placeholder="you@safetynetwork.com"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Username *</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. jsmith or john_smith"
                maxLength={20}
                style={inputStyle}
              />
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                3–20 characters · lowercase letters, numbers, underscores only · used to log in
              </div>
            </div>

            <div>
              <label style={labelStyle}>Branch *</label>
              <select
                value={form.branchId}
                onChange={(e) => set('branchId', e.target.value)}
                required
                style={{ ...inputStyle, cursor: 'pointer', color: form.branchId ? '#ffffff' : '#555555' }}
              >
                <option value="" disabled>Select your branch</option>
                <optgroup label="— Operations —">
                  {branches.filter((b) => b.is_revenue_generating).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
                <optgroup label="— Corporate —">
                  {branches.filter((b) => !b.is_revenue_generating).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Role Requested *</label>
              <select
                value={form.requestedRole}
                onChange={(e) => set('requestedRole', e.target.value)}
                required
                style={{ ...inputStyle, cursor: 'pointer', color: form.requestedRole ? '#ffffff' : '#555555' }}
              >
                <option value="" disabled>Select a role</option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Notes <span style={{ color: 'var(--text-faint)' }}>(optional)</span></label>
              <textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
                placeholder="Anything else we should know?"
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>

            {error && (
              <div style={{ fontSize: 12, color: '#cc4444', padding: '8px 12px', background: '#2a1a1a', borderRadius: 6, border: '1px solid #3a2a2a' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary"
              style={{ width: '100%', padding: '11px 0', fontSize: 14, opacity: submitting ? 0.6 : 1, marginTop: 4 }}
            >
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>

            <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
              Already have an account?{' '}
              <Link href="/login" style={{ color: '#ff6b00', textDecoration: 'none' }}>
                Sign in →
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
