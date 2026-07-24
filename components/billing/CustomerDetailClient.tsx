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
    </div>
  )
}
