'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

/**
 * A job's invoices, plus generation right here on the job.
 *
 * Generate = a billing run: pick a through date, preview the computed lines (nothing is
 * written), then commit. The preview and the commit call the SAME server builder, so what
 * you approve is exactly what saves.
 */

interface InvoiceRow { id: string; invoiceNumber: string; invoiceDate: string; throughDate: string; status: string; totalCents: number }
interface PreviewLine { kind: string; description: string; qty: number; units: number; unitRateCents: number; amountCents: number }
interface Totals {
  rentalSubtotalCents: number; salesSubtotalCents: number; otherSubtotalCents: number
  rentalMinimumAdjustmentCents: number; subtotalCents: number; taxableBaseCents: number; taxCents: number; totalCents: number
}
interface Preview { lines: PreviewLine[]; totals: Totals; warnings: string[]; throughDate: string; taxRatePct: number }

const money = (c: number) => `$${(c / 100).toFixed(2)}`
const inputStyle: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '7px 9px', fontSize: 12.5, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }
const ghost: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '7px 14px', fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '7px 10px', borderBottom: '1px solid var(--border-emphasis)' }
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)', fontSize: 12.5 }
const statusColor: Record<string, string> = { draft: 'var(--pill-neutral-fg)', issued: 'var(--pill-paid-fg)', void: 'var(--pill-overdue-fg)' }

export default function JobInvoicesSection({ jobId, isAdmin, autoGenerate = false }: { jobId: string; isAdmin: boolean; autoGenerate?: boolean }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const [showGen, setShowGen] = useState(autoGenerate && isAdmin)
  const [through, setThrough] = useState(today)
  const [taxRate, setTaxRate] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/billing/invoices?jobId=${jobId}`)
      .then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setInvoices(j.data); setErr(null) })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [jobId])
  useEffect(() => { load() }, [load])

  const genBody = () => ({ jobId, throughDate: through, taxRatePct: taxRate.trim() === '' ? undefined : Number(taxRate) })

  async function runPreview() {
    setBusy(true); setErr(null); setPreview(null)
    try {
      const res = await fetch('/api/billing/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...genBody(), preview: true }) })
      const j = await res.json()
      if (!j.success) { setErr(j.error); return }
      setPreview(j.data)
    } catch { setErr('Network error — please try again.') }
    finally { setBusy(false) }
  }

  async function commit() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/billing/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(genBody()) })
      const j = await res.json()
      if (!j.success) { setErr(j.error); return }
      setShowGen(false); setPreview(null); setTaxRate(''); load()
    } catch { setErr('Network error — please try again.') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="card" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading invoices…</div>

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Invoices</div>
        {isAdmin && <button onClick={() => { setShowGen((v) => !v); setPreview(null); setErr(null) }} style={{ ...ghost, marginLeft: 'auto' }}>{showGen ? 'Cancel' : '+ Generate invoice'}</button>}
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6, marginBottom: 12 }}>{err}</div>}

      {showGen && isAdmin && (
        <div style={{ border: '1px solid var(--border-subtle, var(--border-emphasis))', borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: preview ? 14 : 0 }}>
            <div><label style={labelStyle}>Bill through</label><input type="date" value={through} onChange={(e) => { setThrough(e.target.value); setPreview(null) }} style={inputStyle} /></div>
            <div style={{ width: 120 }}><label style={labelStyle}>Tax rate %</label><input value={taxRate} placeholder="0" onChange={(e) => { setTaxRate(e.target.value); setPreview(null) }} style={{ ...inputStyle, width: '100%' }} /></div>
            <button onClick={runPreview} disabled={busy} style={ghost}>{busy && !preview ? 'Computing…' : 'Preview'}</button>
            {preview && <button onClick={commit} disabled={busy} className="btn-primary" style={{ padding: '8px 18px', opacity: busy ? 0.5 : 1 }}>Generate invoice</button>}
          </div>

          {preview && (
            <div style={{ borderTop: '1px solid var(--border-subtle, var(--border-emphasis))', paddingTop: 12 }}>
              {preview.warnings.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--alert-warning-fg, #8a6d00)', background: 'var(--alert-warning-bg, #fbf3e4)', border: '1px solid var(--pill-pending-fg)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
                  <strong>Check before generating:</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{preview.warnings.map((w, i) => <li key={i} style={{ marginBottom: 2 }}>{w}</li>)}</ul>
                </div>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Description', 'Qty', 'Rate', 'Amount'].map((h) => <th key={h} style={{ ...th, textAlign: ['Qty', 'Rate', 'Amount'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.lines.map((l, i) => (
                      <tr key={i}>
                        <td style={td}>{l.description}<span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: 11, textTransform: 'uppercase' }}>{l.kind}</span></td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.qty}{l.units > 1 ? ` × ${l.units}` : ''}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.unitRateCents)}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TotalsBlock t={preview.totals} />
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8 }}>Preview only — nothing is saved until you press Generate.</div>
            </div>
          )}
        </div>
      )}

      {invoices.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 2px' }}>No invoices for this job yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Invoice', 'Date', 'Through', 'Status', 'Total'].map((h) => <th key={h} style={{ ...th, textAlign: h === 'Total' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td style={td}><Link href={`/billing/invoices/${inv.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>{inv.invoiceNumber}</Link></td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{inv.invoiceDate}</td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{inv.throughDate}</td>
                <td style={td}><span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: statusColor[inv.status] ?? 'var(--text-muted)' }}>{inv.status}</span></td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{money(inv.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function TotalsBlock({ t }: { t: Totals }) {
  const row = (label: string, cents: number, o: { strong?: boolean; muted?: boolean } = {}) => cents === 0 && o.muted ? null : (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: o.strong ? 14 : 12.5, fontWeight: o.strong ? 600 : 400, color: o.muted ? 'var(--text-muted)' : 'var(--text-primary)', padding: '2px 0' }}>
      <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(cents)}</span>
    </div>
  )
  return (
    <div style={{ marginLeft: 'auto', maxWidth: 300, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-subtle, var(--border-emphasis))' }}>
      {row('Rental', t.rentalSubtotalCents, { muted: true })}
      {row('Rental minimum', t.rentalMinimumAdjustmentCents, { muted: true })}
      {row('Sales', t.salesSubtotalCents, { muted: true })}
      {row('Other charges', t.otherSubtotalCents, { muted: true })}
      {row('Subtotal', t.subtotalCents)}
      {row('Tax', t.taxCents, { muted: true })}
      {row('Total', t.totalCents, { strong: true })}
    </div>
  )
}
