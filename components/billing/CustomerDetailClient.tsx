'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

/**
 * A customer's profiles. The customer is identity; each profile below is a billing
 * arrangement (branch, terms, price list). Jobs attach to a profile, not here.
 */

interface Customer { id: string; code: string; name: string }
interface ProfileRow {
  id: string; code: string; name: string; isActive: boolean
  branch: { id: string; name: string } | null
  customer: { id: string } | null
  paymentTerm: string | null
  enabledEntityCount: number
  unconfiguredEntityCount: number
}

export default function CustomerDetailClient({ customerId }: { customerId: string }) {
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/billing/customers').then((r) => r.json()),
      fetch('/api/billing/profiles').then((r) => r.json()),
    ]).then(([cs, ps]) => {
      if (!cs.success) throw new Error(cs.error)
      const c = (cs.data as Customer[]).find((x) => x.id === customerId) ?? null
      setCustomer(c)
      if (ps.success) setProfiles((ps.data as ProfileRow[]).filter((p) => p.customer?.id === customerId))
      setErr(null)
    }).catch((e: Error) => setErr(e.message)).finally(() => setLoading(false))
  }, [customerId])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="card"><div className="bx-empty">Loading…</div></div>
  if (err) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {err}</div>
  if (!customer) return <div className="bx-empty">Customer not found.</div>

  return (
    <div style={{ maxWidth: 900 }}>
      <button className="bx-crumb" onClick={() => router.push('/billing/customers')}>← Customers</button>
      <h1 className="bx-h1">{customer.name}</h1>
      <div className="bx-sub">Customer · {customer.code} · identity only — billing lives on its profiles below</div>

      <div className="card">
        <div className="bx-cardhead">
          <h3>Billing profiles</h3>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--dim)' }}>{profiles.length}</span>
        </div>
        <div className="bx-sub" style={{ margin: '-6px 0 12px' }}>
          A customer can bill under several profiles — standard vs certified/prevailing-wage, a different branch, or a
          negotiated tier. Jobs attach to a <b>profile</b>, not the customer.
        </div>
        {profiles.length === 0 ? (
          <div className="bx-empty">No profiles for this customer yet.</div>
        ) : (
          <table>
            <thead><tr><th>Profile</th><th>Branch</th><th>Terms</th><th>Entities</th><th></th></tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="bx-rowlink" onClick={() => router.push(`/billing/profiles/${p.id}`)}>
                  <td><b>{p.name}</b> <span className="mono" style={{ color: 'var(--dim)' }}>{p.code}</span>{!p.isActive && <span className="tag t-gray" style={{ marginLeft: 8 }}>inactive</span>}</td>
                  <td>{p.branch?.name ?? '—'}</td>
                  <td>{p.paymentTerm ?? '—'}</td>
                  <td>
                    <span className="tag t-green">{p.enabledEntityCount} on</span>
                    {p.unconfiguredEntityCount > 0 && <span className="tag t-amber" style={{ marginLeft: 6 }}>{p.unconfiguredEntityCount} to set up</span>}
                  </td>
                  <td className="num" style={{ color: 'var(--dim)' }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PortalAccessCard customerId={customerId} />
    </div>
  )
}

interface PortalAccount { id: string; email: string; name: string | null; role: string; isActive: boolean; activated: boolean; lastLoginAt: string | null }

function PortalAccessCard({ customerId }: { customerId: string }) {
  const [accounts, setAccounts] = useState<PortalAccount[] | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/billing/portal-accounts?customerId=${customerId}`).then((r) => r.json())
      .then((j) => { if (j.success) setAccounts(j.data); else setError(j.error) })
      .catch((e: Error) => setError(e.message))
  }, [customerId])
  useEffect(() => { load() }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/billing/portal-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, email: email.trim(), name: name.trim() }),
      })
      const j = await res.json()
      if (!j.success) { setError(j.error); return }
      setEmail(''); setName(''); load()
    } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="bx-cardhead"><h3>Portal access</h3></div>
      <div className="bx-sub" style={{ margin: '-6px 0 12px' }}>
        People here can sign in at the customer portal to see this customer&apos;s open jobs and issued invoices —
        but only for profiles you&apos;ve switched on (toggle lives on each profile). They sign in with a magic link; no passwords.
      </div>

      {accounts === null ? <div className="bx-empty">Loading…</div>
        : accounts.length === 0 ? <div className="bx-empty">No portal logins yet.</div>
        : (
          <table>
            <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.email}</td>
                  <td>{a.name ?? '—'}</td>
                  <td><span className="tag t-gray">{a.role}</span></td>
                  <td>{!a.isActive ? <span className="tag t-red">disabled</span> : a.activated ? <span className="tag t-green">active</span> : <span className="tag t-amber">invited</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
        <div><label className="bx-lbl">Email</label><input className="bx-f" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@customer.com" style={{ width: 220 }} /></div>
        <div><label className="bx-lbl">Name (optional)</label><input className="bx-f" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" style={{ width: 180 }} /></div>
        <button className="bx-btn accent" type="submit" disabled={busy || !email.trim()}>{busy ? 'Adding…' : 'Add login'}</button>
      </form>
      {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
    </div>
  )
}
