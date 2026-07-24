'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Quote builder. Add item lines; the server prices them from the profile's price list on
 * Save (same resolver as tickets/invoices). A won quote converts to a job + first ticket.
 */

interface CatItem { id: string; code: string; name: string; category: string; salePriceCents: number | null; variations: { id: string; name: string }[] }
interface Line { key: string; kind: string; itemId: string | null; variationId: string | null; billingType: string | null; description: string; qty: number; units: number; amountCents: number }
interface Quote {
  id: string; quoteNumber: string; status: string; jobName: string | null; taxRatePct: number
  customer: string | null; profile: string | null; convertedJobId: string | null
  totals: { subtotalCents: number; taxCents: number; totalCents: number }
  lines: { id: string; kind: string; itemId: string | null; variationId: string | null; billingType: string | null; description: string; qty: number; units: number; amountCents: number }[]
  catalog: CatItem[]; isAdmin: boolean
}

const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const stTag = (s: string) => ({ draft: 't-gray', sent: 't-amber', won: 't-green', lost: 't-red' }[s] || 't-gray')
const kindOf: Record<string, string> = { Equipment: 'equipment', Labor: 'labor', 'Lump Sum': 'lump_sum', Misc: 'misc', Sale: 'sale' }
const CADENCES = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]
let tmp = 0; const nk = () => `k${++tmp}`

export default function QuoteDetailClient({ quoteId }: { quoteId: string }) {
  const router = useRouter()
  const [q, setQ] = useState<Quote | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [jobName, setJobName] = useState('')
  const [taxRate, setTaxRate] = useState('0')
  const [totals, setTotals] = useState({ subtotalCents: 0, taxCents: 0, totalCents: 0 })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/billing/quotes/${quoteId}`).then((r) => r.json()).then((j) => {
      if (!j.success) { setMsg(j.error); return }
      const d = j.data as Quote
      setQ(d); setJobName(d.jobName ?? ''); setTaxRate(String(d.taxRatePct)); setTotals(d.totals)
      setLines(d.lines.map((l) => ({ key: nk(), ...l })))
    })
  }, [quoteId])
  useEffect(() => { load() }, [load])

  const locked = q?.status === 'won'
  const cat = (id: string | null) => q?.catalog.find((c) => c.id === id)

  function addLine() { setLines((r) => [...r, { key: nk(), kind: 'equipment', itemId: null, variationId: null, billingType: 'daily', description: '', qty: 1, units: 1, amountCents: 0 }]); setMsg(null) }
  function patch(key: string, next: Partial<Line>) { setLines((r) => r.map((l) => l.key === key ? { ...l, ...next } : l)); setMsg(null) }
  function pickItem(key: string, itemId: string) {
    const c = cat(itemId)
    if (!c) return
    patch(key, { itemId, kind: kindOf[c.category] ?? 'equipment', description: c.name, variationId: null, billingType: c.category === 'Equipment' ? 'daily' : null })
  }

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/billing/quotes/${quoteId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobName, taxRatePct: Number(taxRate) || 0, lines: lines.map((l) => ({ kind: l.kind, itemId: l.itemId, variationId: l.variationId, billingType: l.billingType, description: l.description, qty: l.qty, units: l.units })) }),
      })
      const j = await res.json()
      if (!j.success) { setMsg(j.error); return }
      setTotals(j.data); setMsg('Saved & priced.'); load()
    } catch { setMsg('Network error.') } finally { setBusy(false) }
  }
  async function act(action: string, extra: object = {}) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/billing/quotes/${quoteId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
      const j = await res.json()
      if (!j.success) { setMsg(j.error); return }
      if (action === 'convert') { router.push(`/billing/jobs/${j.data.jobId}`); return }
      load()
    } catch { setMsg('Network error.') } finally { setBusy(false) }
  }

  if (!q) return <div className="card"><div className="bx-empty">Loading…</div></div>

  return (
    <div style={{ maxWidth: 900 }}>
      <button className="bx-crumb" onClick={() => router.push('/billing/quotes')}>← Quotes</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="bx-h1">{q.quoteNumber}</h1>
        <span className={`tag ${stTag(q.status)}`}>{q.status}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {!locked && <button className="bx-btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}
          {q.status === 'draft' && <button className="bx-btn ghost" onClick={() => act('status', { status: 'sent' })} disabled={busy}>Mark sent</button>}
          {(q.status === 'draft' || q.status === 'sent') && <button className="bx-btn accent" onClick={() => act('convert')} disabled={busy}>Convert to job →</button>}
          {q.convertedJobId && <button className="bx-btn ghost" onClick={() => router.push(`/billing/jobs/${q.convertedJobId}`)}>Open job →</button>}
        </span>
      </div>
      <div className="bx-sub">{q.customer ?? '—'} · {q.profile} · prices resolve from this profile's price list</div>

      {msg && <div className={`bx-note ${msg.includes('Saved') ? 'green' : 'amber'}`}>{msg}</div>}
      {locked && <div className="bx-note green">This quote was won and converted to a job — it's locked.</div>}

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}><label className="bx-lbl">Job name</label><input className="bx-f" style={{ width: '100%' }} value={jobName} disabled={locked} onChange={(e) => { setJobName(e.target.value); setMsg(null) }} /></div>
        <div style={{ width: 110 }}><label className="bx-lbl">Tax rate %</label><input className="bx-f" style={{ width: '100%' }} value={taxRate} disabled={locked} onChange={(e) => { setTaxRate(e.target.value); setMsg(null) }} /></div>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Item</th><th>Billing</th><th className="num">Qty</th><th className="num">Units</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const c = cat(l.itemId)
                return (
                  <tr key={l.key}>
                    <td>
                      <select className="bx-select bx-f" style={{ minWidth: 200 }} disabled={locked} value={l.itemId ?? ''} onChange={(e) => pickItem(l.key, e.target.value)}>
                        <option value="">Pick an item…</option>
                        {q.catalog.map((ci) => <option key={ci.id} value={ci.id}>{ci.code} — {ci.name}</option>)}
                      </select>
                      {c && c.variations.length > 0 && (
                        <select className="bx-select bx-f" style={{ marginTop: 6, minWidth: 140 }} disabled={locked} value={l.variationId ?? ''} onChange={(e) => patch(l.key, { variationId: e.target.value || null })}>
                          <option value="">— variation —</option>
                          {c.variations.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td>{l.kind === 'equipment' ? (
                      <select className="bx-select bx-f" style={{ width: 110 }} disabled={locked} value={l.billingType ?? 'daily'} onChange={(e) => patch(l.key, { billingType: e.target.value })}>
                        {CADENCES.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
                      </select>
                    ) : <span style={{ color: 'var(--dim)', fontSize: 12 }}>{l.kind}</span>}</td>
                    <td className="num"><input className="bx-f" style={{ width: 64, textAlign: 'right' }} disabled={locked} value={l.qty} onChange={(e) => patch(l.key, { qty: Number(e.target.value) || 0 })} /></td>
                    <td className="num"><input className="bx-f" style={{ width: 56, textAlign: 'right' }} disabled={locked} value={l.units} onChange={(e) => patch(l.key, { units: Number(e.target.value) || 1 })} /></td>
                    <td className="num money">{l.amountCents ? money(l.amountCents) : <span style={{ color: 'var(--dim)', fontWeight: 400 }}>save to price</span>}</td>
                    <td className="num">{!locked && <button className="bx-link" style={{ color: 'var(--dim)' }} onClick={() => setLines((r) => r.filter((x) => x.key !== l.key))}>✕</button>}</td>
                  </tr>
                )
              })}
              {lines.length === 0 && <tr><td colSpan={6} className="bx-empty">No lines yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {!locked && <button className="bx-btn ghost sm" style={{ marginTop: 10 }} onClick={addLine}>+ Add line</button>}

        <div style={{ marginLeft: 'auto', maxWidth: 280, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)', padding: '3px 0' }}><span>Subtotal</span><span className="mono">{money(totals.subtotalCents)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)', padding: '3px 0' }}><span>Tax</span><span className="mono">{money(totals.taxCents)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, borderTop: '1px solid var(--line-2)', marginTop: 6, paddingTop: 10 }}><span>Total</span><span className="mono">{money(totals.totalCents)}</span></div>
        </div>
      </div>
    </div>
  )
}
