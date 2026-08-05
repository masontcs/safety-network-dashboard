'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { TotalsBlock } from '@/components/billing/JobInvoicesSection'

interface Line { id: string; kind: string; description: string; lotDate: string | null; qty: number; units: number; unitRateCents: number; amountCents: number; taxable: boolean }
interface Totals {
  rentalSubtotalCents: number; salesSubtotalCents: number; otherSubtotalCents: number
  rentalMinimumAdjustmentCents: number; subtotalCents: number; taxableBaseCents: number; taxCents: number; totalCents: number
}
interface Invoice {
  id: string; invoiceNumber: string; jobId: string; jobNumber: string | null; jobName: string | null
  customer: string | null; profile: string | null; entityCode: string | null
  throughDate: string; invoiceDate: string; status: string; taxRatePct: number
  totals: Totals; lines: Line[]; isAdmin: boolean
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)' }
const td: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)', fontSize: 13 }
const ghost: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '7px 16px', fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }
const statusColor: Record<string, string> = { draft: 'var(--pill-neutral-fg)', issued: 'var(--pill-paid-fg)', void: 'var(--pill-overdue-fg)' }

export default function InvoiceDetailClient({ invoiceId }: { invoiceId: string }) {
  const [inv, setInv] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/billing/invoices/${invoiceId}`)
      .then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setInv(j.data); setErr(null) })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [invoiceId])
  useEffect(() => { load() }, [load])

  async function act(action: 'issue' | 'void') {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/billing/invoices/${invoiceId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const j = await res.json()
      if (!j.success) { setErr(j.error); return }
      setConfirmVoid(false); load()
    } catch { setErr('Network error — please try again.') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="card" style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 820 }}>Loading…</div>
  if (err && !inv) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {err}</div>
  if (!inv) return null

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/billing/invoices" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← Invoices</Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>{inv.invoiceNumber}</span>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: statusColor[inv.status] ?? 'var(--text-muted)' }}>{inv.status}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href={`/api/billing/invoices/${invoiceId}/pdf`} download style={{ ...ghost, textDecoration: 'none', color: 'var(--text-primary)' }}>Download PDF</a>
          {inv.isAdmin && (<>
            {inv.status === 'draft' && <button onClick={() => act('issue')} disabled={busy} className="btn-primary" style={{ padding: '7px 16px', opacity: busy ? 0.5 : 1 }}>Issue</button>}
            {inv.status !== 'void' && (confirmVoid
              ? <><span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Void this invoice?</span>
                  <button onClick={() => act('void')} disabled={busy} style={{ ...ghost, color: 'var(--danger)', borderColor: 'var(--danger)' }}>Yes, void</button>
                  <button onClick={() => setConfirmVoid(false)} style={ghost}>No</button></>
              : <button onClick={() => setConfirmVoid(true)} disabled={busy} style={{ ...ghost, color: 'var(--danger)' }}>Void</button>)}
          </>)}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, marginBottom: 18 }}>
        <Link href={`/billing/jobs/${inv.jobId}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{inv.jobNumber}</Link>
        {inv.jobName ? ` · ${inv.jobName}` : ''} · {inv.customer ?? '—'} · {inv.entityCode ?? '—'}
        {'  ·  '}invoice {inv.invoiceDate} · through {inv.throughDate} · tax {inv.taxRatePct}%
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6, marginBottom: 12 }}>{err}</div>}
      {inv.status === 'void' && <div style={{ fontSize: 12, color: 'var(--alert-warning-fg, #8a6d00)', background: 'var(--alert-warning-bg, #fbf3e4)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>This invoice is void. Its rentals are billable again and its charges can be re-invoiced.</div>}

      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Description', 'Qty', 'Rate', 'Amount'].map((h) => <th key={h} style={{ ...th, textAlign: ['Qty', 'Rate', 'Amount'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td style={td}>{l.description}<span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: 11, textTransform: 'uppercase' }}>{l.kind}</span></td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.qty}{l.units > 1 ? ` × ${l.units}` : ''}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.unitRateCents)}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <TotalsBlock t={inv.totals} />
      </div>
    </div>
  )
}
