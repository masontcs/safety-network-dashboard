'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Combobox from '@/components/billing/Combobox'
import Select from '@/components/billing/Select'
import { useBranch } from '@/components/billing/BranchContext'

/**
 * Quotes list + New-quote flow. A quote is EITHER for an existing billing profile OR a
 * prospect — a company that isn't a customer yet. A prospect quote prices against a chosen
 * price list + tier and, when won, becomes a real customer + profile.
 */

interface QuoteRow { id: string; quoteNumber: string; status: string; quoteDate: string; jobName: string | null; totalCents: number; customer: string | null; profile: string | null; isProspect?: boolean }
interface ProfileOpt { id: string; code: string; name: string; customer: { name: string } | null }
interface PriceListOpt { id: string; name: string; entityCode: string; tiers: { id: string; name: string }[] }

const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const stTag = (s: string) => ({ draft: 't-gray', sent: 't-amber', won: 't-green', lost: 't-red' }[s] || 't-gray')

export default function QuotesClient() {
  const router = useRouter()
  const [rows, setRows] = useState<QuoteRow[]>([])
  const [profiles, setProfiles] = useState<ProfileOpt[]>([])
  const [priceLists, setPriceLists] = useState<PriceListOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [mode, setMode] = useState<'profile' | 'prospect'>('profile')
  const [busy, setBusy] = useState(false)
  const { query, branches, branchId } = useBranch()

  // existing-customer fields
  const [profId, setProfId] = useState('')
  const [jobName, setJobName] = useState('')

  // prospect fields
  const [company, setCompany] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [plId, setPlId] = useState('')
  const [tierId, setTierId] = useState('')
  const [pBranch, setPBranch] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/billing/quotes' + query).then((r) => r.json()),
      fetch('/api/billing/profiles').then((r) => r.json()),
      fetch('/api/billing/price-lists').then((r) => r.json()),
    ]).then(([qs, ps, pls]) => {
      if (!qs.success) throw new Error(qs.error)
      setRows(qs.data)
      if (ps.success) setProfiles(ps.data)
      if (pls.success) setPriceLists(pls.data)
      setErr(null)
    }).catch((e: Error) => setErr(e.message)).finally(() => setLoading(false))
  }, [query])
  useEffect(() => { load() }, [load])

  const selectedList = priceLists.find((p) => p.id === plId)

  async function create() {
    setBusy(true); setErr(null)
    try {
      let payload: Record<string, unknown>
      if (mode === 'profile') {
        if (!profId) { setErr('Pick a billing profile'); setBusy(false); return }
        payload = { profileId: profId, jobName }
      } else {
        const branch = pBranch || branchId || ''
        if (!company.trim()) { setErr('Enter the prospect company name'); setBusy(false); return }
        if (!plId || !tierId) { setErr('Pick a price list and tier'); setBusy(false); return }
        if (!branch) { setErr('Pick a branch'); setBusy(false); return }
        payload = {
          prospect: { company, contactName, contactEmail, contactPhone },
          priceListId: plId, tierId, branchId: branch, jobName,
        }
      }
      const res = await fetch('/api/billing/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await res.json()
      if (!j.success) { setErr(j.error); return }
      router.push(`/billing/quotes/${j.data.id}`)
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h1 className="bx-h1">Quotes</h1>
        <button className="bx-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { setShowNew((v) => !v); setErr(null) }}>{showNew ? 'Cancel' : '+ New quote'}</button>
      </div>
      <div className="bx-sub">Bid an existing customer or a brand-new prospect; win it to create the customer, then convert to a job.</div>

      {err && <div className="bx-note amber">{err}</div>}

      {showNew && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <button className={`bx-btn ${mode === 'profile' ? 'accent' : 'ghost'} sm`} onClick={() => { setMode('profile'); setErr(null) }}>Existing customer</button>
            <button className={`bx-btn ${mode === 'prospect' ? 'accent' : 'ghost'} sm`} onClick={() => { setMode('prospect'); setErr(null) }}>Prospect (new company)</button>
          </div>

          {mode === 'profile' ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ width: 320 }}>
                <label className="bx-lbl">Billing profile</label>
                <Combobox ariaLabel="Billing profile" value={profId} onChange={setProfId}
                  options={profiles.map((p) => ({ value: p.id, label: `${p.customer?.name ?? '—'} — ${p.name}`, hint: p.code }))} />
              </div>
              <div><label className="bx-lbl">Job name (optional)</label><input className="bx-f" value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="Hwy 99 shoulder work" /></div>
              <button className="bx-btn accent" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Start quote'}</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div><label className="bx-lbl">Company *</label><input className="bx-f" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Grading Inc." /></div>
              <div><label className="bx-lbl">Contact name</label><input className="bx-f" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jane Doe" /></div>
              <div><label className="bx-lbl">Contact email</label><input className="bx-f" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="jane@acme.com" /></div>
              <div><label className="bx-lbl">Contact phone</label><input className="bx-f" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="(661) 555-0143" /></div>
              <div>
                <label className="bx-lbl">Branch *</label>
                <Select ariaLabel="Branch" value={pBranch || branchId || ''} onChange={setPBranch}>
                  <option value="">Select…</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </div>
              <div>
                <label className="bx-lbl">Price list *</label>
                <Select ariaLabel="Price list" value={plId} onChange={(v) => { setPlId(v); setTierId('') }}>
                  <option value="">Select…</option>
                  {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.entityCode})</option>)}
                </Select>
              </div>
              <div>
                <label className="bx-lbl">Tier *</label>
                <Select ariaLabel="Tier" value={tierId} onChange={setTierId} disabled={!selectedList}>
                  <option value="">{selectedList ? 'Select…' : 'Pick a price list first'}</option>
                  {(selectedList?.tiers ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </div>
              <div><label className="bx-lbl">Job name (optional)</label><input className="bx-f" value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="Hwy 99 shoulder work" /></div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="bx-btn accent" onClick={create} disabled={busy} style={{ width: '100%' }}>{busy ? 'Creating…' : 'Start prospect quote'}</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        {loading ? <div className="bx-empty">Loading…</div> : rows.length === 0 ? <div className="bx-empty">No quotes yet — start one above.</div> : (
          <table className="bx-list">
            <thead><tr><th>Quote</th><th>Customer</th><th>Job</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id} className="bx-rowlink" onClick={() => router.push(`/billing/quotes/${q.id}`)}>
                  <td className="mono" data-label="Quote" style={{ color: 'var(--accent)', fontWeight: 600 }}>{q.quoteNumber}</td>
                  <td data-label="Customer">
                    {q.customer ?? '—'}
                    {q.isProspect && <span className="tag t-blue" style={{ marginLeft: 6 }}>prospect</span>}
                    {!q.isProspect && q.profile && <span style={{ color: 'var(--dim)', marginLeft: 6, fontSize: 12 }}>{q.profile}</span>}
                  </td>
                  <td data-label="Job" style={{ color: 'var(--muted)' }}>{q.jobName ?? '—'}</td>
                  <td data-label="Status"><span className={`tag ${stTag(q.status)}`}>{q.status}</span></td>
                  <td className="num money" data-label="Total">{money(q.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
