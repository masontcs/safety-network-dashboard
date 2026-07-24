'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Customers — identity only. Each holds one or more billing profiles, which is where
 * rates, terms and branch actually live. Click a customer to see its profiles; use
 * "+ New customer" to onboard one (the code is internal; QuickBooks matches on name).
 */

interface CustomerRow { id: string; code: string; name: string; isActive: boolean; profileCount: number }

export default function CustomersClient() {
  const router = useRouter()
  const [rows, setRows] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/billing/customers').then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setRows(j.data) })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setSaveErr(null)
    try {
      const res = await fetch('/api/billing/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), code: code.trim() }),
      })
      const j = await res.json()
      if (!j.success) { setSaveErr(j.error); return }
      router.push(`/billing/customers/${j.data.id}`) // land on the new customer to add a profile
    } catch { setSaveErr('Network error — please try again.') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="bx-h1">Customers</h1>
          <div className="bx-sub">Who you bill. Each customer holds one or more <b>billing profiles</b> — the profile is where rates, terms and branch actually live.</div>
        </div>
        <button className="bx-btn" onClick={() => { setAdding((v) => !v); setSaveErr(null) }}>
          {adding ? 'Cancel' : '+ New customer'}
        </button>
      </div>

      {err && <div className="bx-note amber">{err}</div>}

      {adding && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="bx-cardhead"><h3>New customer</h3></div>
          <div className="bx-sub" style={{ margin: '-6px 0 12px' }}>The code is internal only. QuickBooks matches on the name.</div>
          <form onSubmit={create} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div><label className="bx-lbl">Name</label><input className="bx-f" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Wiring Connections" style={{ width: 280 }} /></div>
            <div><label className="bx-lbl">Code</label><input className="bx-f" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WIRCON" style={{ width: 130 }} /></div>
            <button className="bx-btn accent" type="submit" disabled={saving || !name.trim() || !code.trim()}>{saving ? 'Creating…' : 'Create'}</button>
          </form>
          {saveErr && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{saveErr}</div>}
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="bx-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="bx-empty">No customers yet — use “+ New customer” to add one.</div>
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
