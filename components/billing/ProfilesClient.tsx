'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Skeleton from '@/components/ui/Skeleton'
import Combobox from '@/components/billing/Combobox'
import Select from '@/components/billing/Select'
import Toggle from '@/components/billing/Toggle'
import { rowOpen } from '@/components/billing/rowOpen'

/**
 * Billing profiles list. Profiles are branch-owned and are where jobs attach —
 * the customer is derived. The QuickBooks name shown here is the exact string
 * QB matches on: "{customer} - {profile}".
 */

interface ProfileRow {
  id: string
  code: string
  name: string
  isActive: boolean
  branch: { id: string; name: string }
  customer: { id: string; code: string; name: string } | null
  paymentTerm: string | null
  qbName: string
  enabledEntityCount: number
  unconfiguredEntityCount: number
}

interface Reference {
  branches: { id: string; name: string; code: string }[]
  paymentTerms: { id: string; name: string; netDays: number }[]
  customers: { id: string; code: string; name: string; defaultPaymentTermId: string | null }[]
  isAdmin: boolean
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
}

export default function ProfilesClient() {
  const router = useRouter()
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [ref, setRef] = useState<Reference | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [showNewProfile, setShowNewProfile] = useState(false)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [pCustomerId, setPCustomerId] = useState('')
  const [pBranchId, setPBranchId] = useState('')
  const [pCode, setPCode] = useState('')
  const [pName, setPName] = useState('')
  const [pTermId, setPTermId] = useState('')
  const [pMinEnabled, setPMinEnabled] = useState(true)
  const [pMinDollars, setPMinDollars] = useState('25.00')

  const [cCode, setCCode] = useState('')
  const [cName, setCName] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/billing/profiles').then((r) => r.json()),
      fetch('/api/billing/reference').then((r) => r.json()),
    ])
      .then(([p, r]) => {
        if (!p.success) throw new Error(p.error)
        if (!r.success) throw new Error(r.error)
        setProfiles(p.data)
        setRef(r.data)
        setFetchError(null)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.qbName.toLowerCase().includes(q) ||
        (p.customer?.name ?? '').toLowerCase().includes(q) ||
        p.branch.name.toLowerCase().includes(q)
    )
  }, [profiles, search])

  async function createCustomer() {
    if (!cCode.trim() || !cName.trim() || busy) return
    setBusy(true); setActionError(null)
    try {
      const res = await fetch('/api/billing/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cCode, name: cName }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setCCode(''); setCName(''); setShowNewCustomer(false)
      load()
    } catch { setActionError('Network error — please try again.') }
    finally { setBusy(false) }
  }

  async function createProfile() {
    if (busy) return
    const dollars = Number(pMinDollars)
    if (!Number.isFinite(dollars) || dollars < 0) { setActionError('Rental minimum must be a valid amount'); return }
    setBusy(true); setActionError(null)
    try {
      const res = await fetch('/api/billing/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: pCustomerId,
          branchId: pBranchId,
          code: pCode,
          name: pName,
          paymentTermId: pTermId || null,
          rentalMinimumEnabled: pMinEnabled,
          // money is integer cents everywhere — round once, here
          rentalMinimumCents: Math.round(dollars * 100),
        }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setPCustomerId(''); setPBranchId(''); setPCode(''); setPName(''); setPTermId('')
      setPMinEnabled(true); setPMinDollars('25.00')
      setShowNewProfile(false)
      load()
    } catch { setActionError('Network error — please try again.') }
    finally { setBusy(false) }
  }

  const canCreateProfile = !!(pCustomerId && pBranchId && pCode.trim() && pName.trim()) && !busy
  const isAdmin = ref?.isAdmin ?? false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Billing Profiles</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {isAdmin && (
            <>
              <button onClick={() => { setShowNewCustomer((v) => !v); setShowNewProfile(false) }} style={ghostBtn}>
                + Customer
              </button>
              <button onClick={() => { setShowNewProfile((v) => !v); setShowNewCustomer(false) }} className="btn-primary" style={{ padding: '8px 16px' }}>
                + Billing profile
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -12 }}>
        Profiles are branch-owned. Jobs attach to a profile, not to a customer. Each profile picks a
        price list per entity.
      </div>

      {actionError && (
        <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6 }}>
          {actionError}
        </div>
      )}

      {showNewCustomer && ref && (
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, color: 'var(--text-primary)' }}>New customer</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
            The code is internal only. QuickBooks matches on the name.
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ width: 140 }}>
              <label style={labelStyle}>Code</label>
              <input value={cCode} onChange={(e) => setCCode(e.target.value)} placeholder="WIRCON" style={inputStyle} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={labelStyle}>Name</label>
              <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Wiring Connections" style={inputStyle} />
            </div>
            <button onClick={createCustomer} disabled={busy || !cCode.trim() || !cName.trim()} className="btn-primary" style={{ padding: '8px 18px', opacity: busy || !cCode.trim() || !cName.trim() ? 0.5 : 1 }}>
              Create
            </button>
            <button onClick={() => setShowNewCustomer(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      {showNewProfile && ref && (
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16, color: 'var(--text-primary)' }}>New billing profile</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Customer</label>
              <Combobox
                ariaLabel="Customer"
                value={pCustomerId}
                onChange={setPCustomerId}
                options={ref.customers.map((c) => ({ value: c.id, label: c.name, hint: c.code }))}
              />
              {ref.customers.length === 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>Create a customer first.</div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Branch</label>
              <Select ariaLabel="Branch" value={pBranchId} onChange={setPBranchId}>
                <option value="">Select…</option>
                {ref.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </Select>
            </div>
            <div>
              <label style={labelStyle}>Profile code</label>
              <input value={pCode} onChange={(e) => setPCode(e.target.value)} placeholder="JOCR" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Profile name</label>
              <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Joe Crew" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Payment term</label>
              <Select ariaLabel="Payment term" value={pTermId} onChange={setPTermId}>
                <option value="">Use customer default</option>
                {ref.paymentTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <div>
              <label style={labelStyle}>Rental minimum (per invoice)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34 }}>
                <Toggle ariaLabel="Enable rental minimum" checked={pMinEnabled} onChange={setPMinEnabled} />
                <input value={pMinDollars} onChange={(e) => setPMinDollars(e.target.value)} disabled={!pMinEnabled} placeholder="$" style={{ ...inputStyle, opacity: pMinEnabled ? 1 : 0.5 }} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={createProfile} disabled={!canCreateProfile} className="btn-primary" style={{ padding: '8px 18px', opacity: canCreateProfile ? 1 : 0.5 }}>
              Create profile
            </button>
            <button onClick={() => setShowNewProfile(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search profiles, customers, branches…"
            style={{ ...inputStyle, maxWidth: 320 }}
          />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {filtered.length} of {profiles.length}
          </span>
        </div>

        {fetchError ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={44} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 2px' }}>
            {profiles.length === 0 ? 'No billing profiles yet.' : 'No profiles match that search.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Profile', 'Customer', 'Branch', 'QuickBooks name', 'Term', 'Entities'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} {...rowOpen(() => router.push(`/billing/profiles/${p.id}`))} style={{ cursor: 'pointer' }}>
                    <td style={tdStyle}>
                      <Link href={`/billing/profiles/${p.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)', fontWeight: 500, textDecoration: 'none' }}>
                        {p.name}
                      </Link>
                      <span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: 12 }}>{p.code}</span>
                    </td>
                    <td style={tdStyle}>{p.customer?.name ?? '—'}</td>
                    <td style={tdStyle}>{p.branch.name}</td>
                    <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{p.qbName}</td>
                    <td style={tdStyle}>{p.paymentTerm ?? <span style={{ color: 'var(--text-dim)' }}>customer default</span>}</td>
                    <td style={tdStyle}>
                      {p.enabledEntityCount === 0 ? (
                        <span style={{ color: 'var(--text-dim)' }}>none configured</span>
                      ) : p.unconfiguredEntityCount > 0 ? (
                        <span style={{ color: 'var(--danger)' }}>
                          {p.unconfiguredEntityCount} missing price list
                        </span>
                      ) : (
                        <span>{p.enabledEntityCount} enabled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))',
  color: 'var(--text-primary)', verticalAlign: 'middle',
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6,
  padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
}
