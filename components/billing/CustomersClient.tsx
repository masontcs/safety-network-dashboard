'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Customers — identity only. Each holds one or more billing profiles, which is where
 * rates, terms and branch actually live. Click a customer to see its profiles.
 */

interface CustomerRow { id: string; code: string; name: string; isActive: boolean; profileCount: number }

export default function CustomersClient() {
  const router = useRouter()
  const [rows, setRows] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/billing/customers').then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setRows(j.data) })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 className="bx-h1">Customers</h1>
      <div className="bx-sub">Who you bill. Each customer holds one or more <b>billing profiles</b> — the profile is where rates, terms and branch actually live.</div>

      {err && <div className="bx-note amber">{err}</div>}

      <div className="card">
        {loading ? (
          <div className="bx-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="bx-empty">No customers yet.</div>
        ) : (
          <table>
            <thead><tr><th>Customer</th><th>Code</th><th className="num">Profiles</th><th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="bx-rowlink" onClick={() => router.push(`/billing/customers/${c.id}`)}>
                  <td><b>{c.name}</b>{!c.isActive && <span className="tag t-gray" style={{ marginLeft: 8 }}>inactive</span>}</td>
                  <td className="mono" style={{ color: 'var(--muted)' }}>{c.code}</td>
                  <td className="num mono">{c.profileCount}</td>
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
