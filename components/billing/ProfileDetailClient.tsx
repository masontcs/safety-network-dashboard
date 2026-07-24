'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Skeleton from '@/components/ui/Skeleton'
import ProfileEntityConfigCard from '@/components/billing/ProfileEntityConfigCard'
import ProfileJobsTab from '@/components/billing/ProfileJobsTab'
import ProfileInvoicesTab from '@/components/billing/ProfileInvoicesTab'
import Tabs from '@/components/billing/Tabs'
import Select from '@/components/billing/Select'
import Toggle from '@/components/billing/Toggle'

/**
 * Billing profile detail. Two cards: the profile's own settings, and its
 * per-entity price-list configuration.
 */

interface Contact { id: string; name: string; email: string | null; phone: string | null; isInvoiceRecipient: boolean }
interface Profile {
  id: string
  code: string
  name: string
  isActive: boolean
  paymentTermId: string | null
  rentalMinimumEnabled: boolean
  rentalMinimumCents: number
  branch: { id: string; name: string }
  customer: { id: string; code: string; name: string } | null
  qbName: string
  contacts: Contact[]
  isAdmin: boolean
}
interface PaymentTerm { id: string; name: string }

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
}

export default function ProfileDetailClient({ profileId }: { profileId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [tab, setTab] = useState<'details' | 'jobs' | 'invoices'>('details')
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [termId, setTermId] = useState('')
  const [minEnabled, setMinEnabled] = useState(true)
  const [minDollars, setMinDollars] = useState('25.00')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/billing/profiles/${profileId}`).then((r) => r.json()),
      fetch('/api/billing/reference').then((r) => r.json()),
    ])
      .then(([p, r]) => {
        if (!p.success) throw new Error(p.error)
        if (!r.success) throw new Error(r.error)
        const prof = p.data as Profile
        setProfile(prof)
        setTerms(r.data.paymentTerms)
        setName(prof.name)
        setTermId(prof.paymentTermId ?? '')
        setMinEnabled(prof.rentalMinimumEnabled)
        setMinDollars((prof.rentalMinimumCents / 100).toFixed(2))
        setFetchError(null)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [profileId])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    if (saving) return
    const dollars = Number(minDollars)
    if (!Number.isFinite(dollars) || dollars < 0) { setSaveError('Rental minimum must be a valid amount'); return }
    setSaving(true); setSaveError(null); setSaveSuccess(false)
    try {
      const res = await fetch(`/api/billing/profiles/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          paymentTermId: termId || null,
          rentalMinimumEnabled: minEnabled,
          rentalMinimumCents: Math.round(dollars * 100), // integer cents, rounded once
        }),
      })
      const json = await res.json()
      if (!json.success) { setSaveError(json.error); return }
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
      load()
    } catch { setSaveError('Network error — please try again.') }
    finally { setSaving(false) }
  }

  if (fetchError) {
    return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
  }
  if (loading || !profile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 780 }}>
        <Skeleton height={32} /><Skeleton height={220} /><Skeleton height={260} />
      </div>
    )
  }

  const isAdmin = profile.isAdmin

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 860 }}>
      <div>
        <Link href={profile.customer ? `/billing/customers/${profile.customer.id}` : '/billing/customers'} className="bx-crumb">
          ← {profile.customer?.name ?? 'Customers'}
        </Link>
        <div className="bx-h1" style={{ marginTop: 2 }}>
          {profile.name}
          <span style={{ fontSize: 13, color: 'var(--text-dim)', marginLeft: 8, fontWeight: 400 }}>{profile.code}</span>
        </div>
        <div className="bx-sub" style={{ margin: '4px 0 0' }}>
          Billing profile · {profile.customer?.name ?? '—'} · {profile.branch.name}
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[{ id: 'details', label: 'Details' }, { id: 'jobs', label: 'Jobs' }, { id: 'invoices', label: 'Invoices' }]}
      />

      {tab === 'jobs' && <ProfileJobsTab profileId={profileId} />}
      {tab === 'invoices' && <ProfileInvoicesTab profileId={profileId} />}

      {tab === 'details' && (<>
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>Profile settings</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
          The QuickBooks name is derived from the customer and profile names — QB matches on it, so
          renaming this profile renames the customer QB sees.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Profile name</label>
              <input value={name} onChange={(e) => { setName(e.target.value); setSaveSuccess(false) }} disabled={!isAdmin} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Payment term</label>
              <Select ariaLabel="Payment term" value={termId} onChange={(v) => { setTermId(v); setSaveSuccess(false) }} disabled={!isAdmin}>
                <option value="">Use customer default</option>
                {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Rental minimum (applied per invoice)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 300 }}>
              <Toggle ariaLabel="Enable rental minimum" checked={minEnabled} disabled={!isAdmin}
                onChange={(v) => { setMinEnabled(v); setSaveSuccess(false) }} />
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>$</span>
              <input value={minDollars} disabled={!isAdmin || !minEnabled}
                onChange={(e) => { setMinDollars(e.target.value); setSaveSuccess(false) }}
                style={{ ...inputStyle, opacity: minEnabled ? 1 : 0.5 }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>
              Only applies to invoices that actually contain rentals.
            </div>
          </div>

          <div style={{ padding: '10px 14px', background: 'var(--bg-nav)', borderRadius: 8, border: '1px solid var(--border-subtle, var(--border-emphasis))' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
              QuickBooks name
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{profile.customer?.name ?? '—'} - {name}</div>
          </div>

          {saveError && (
            <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6 }}>{saveError}</div>
          )}
          {saveSuccess && (
            <div style={{ fontSize: 12, color: 'var(--alert-success-fg)', padding: '8px 10px', background: 'var(--alert-success-bg)', borderRadius: 6 }}>Saved successfully.</div>
          )}

          {isAdmin && (
            <button onClick={handleSave} disabled={saving || !name.trim()} className="btn-primary"
              style={{ alignSelf: 'flex-start', padding: '8px 20px', opacity: saving || !name.trim() ? 0.5 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <ProfileEntityConfigCard profileId={profileId} />
      </>)}
    </div>
  )
}
