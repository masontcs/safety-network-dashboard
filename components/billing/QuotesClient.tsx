'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Combobox from '@/components/billing/Combobox'
import { useBranch } from '@/components/billing/BranchContext'

/** Quotes list, with a New-quote flow that starts from a billing profile. */

interface QuoteRow { id: string; quoteNumber: string; status: string; quoteDate: string; jobName: string | null; totalCents: number; customer: string | null; profile: string | null }
interface ProfileOpt { id: string; code: string; name: string; customer: { name: string } | null }

const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const stTag = (s: string) => ({ draft: 't-gray', sent: 't-amber', won: 't-green', lost: 't-red' }[s] || 't-gray')

export default function QuotesClient() {
  const router = useRouter()
  const [rows, setRows] = useState<QuoteRow[]>([])
  const [profiles, setProfiles] = useState<ProfileOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [profId, setProfId] = useState('')
  const [jobName, setJobName] = useState('')
  const [busy, setBusy] = useState(false)
  const { query } = useBranch()

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/billing/quotes' + query).then((r) => r.json()),
      fetch('/api/billing/profiles').then((r) => r.json()),
    ]).then(([qs, ps]) => {
      if (!qs.success) throw new Error(qs.error)
      setRows(qs.data)
      if (ps.success) setProfiles(ps.data)
      setErr(null)
    }).catch((e: Error) => setErr(e.message)).finally(() => setLoading(false))
  }, [query])
  useEffect(() => { load() }, [load])

  async function create() {
    if (!profId) { setErr('Pick a billing profile'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/billing/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: profId, jobName }) })
      const j = await res.json()
      if (!j.success) { setErr(j.error); return }
      router.push(`/billing/quotes/${j.data.id}`)
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h1 className="bx-h1">Quotes</h1>
        <button className="bx-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { setShowNew((v) => !v); setErr(null) }}>{showNew ? 'Cancel' : '+ New quote'}</button>
      </div>
      <div className="bx-sub">Build a bid off a price list, send it, and convert a win straight into a job.</div>

      {err && <div className="bx-note amber">{err}</div>}

      {showNew && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 320 }}>
            <label className="bx-lbl">Billing profile</label>
            <Combobox ariaLabel="Billing profile" value={profId} onChange={setProfId}
              options={profiles.map((p) => ({ value: p.id, label: `${p.customer?.name ?? '—'} — ${p.name}`, hint: p.code }))} />
          </div>
          <div><label className="bx-lbl">Job name (optional)</label><input className="bx-f" value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="Hwy 99 shoulder work" /></div>
          <button className="bx-btn accent" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Start quote'}</button>
        </div>
      )}

      <div className="card">
        {loading ? <div className="bx-empty">Loading…</div> : rows.length === 0 ? <div className="bx-empty">No quotes yet — start one above.</div> : (
          <table>
            <thead><tr><th>Quote</th><th>Customer</th><th>Job</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id} className="bx-rowlink" onClick={() => router.push(`/billing/quotes/${q.id}`)}>
                  <td className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{q.quoteNumber}</td>
                  <td>{q.customer ?? '—'}<span style={{ color: 'var(--dim)', marginLeft: 6, fontSize: 12 }}>{q.profile}</span></td>
                  <td style={{ color: 'var(--muted)' }}>{q.jobName ?? '—'}</td>
                  <td><span className={`tag ${stTag(q.status)}`}>{q.status}</span></td>
                  <td className="num money">{money(q.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
