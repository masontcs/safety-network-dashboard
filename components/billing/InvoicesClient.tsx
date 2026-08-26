'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useBranch } from '@/components/billing/BranchContext'
import { useBroadcast } from '@/lib/realtime/useBroadcast'

/** All invoices, newest first, filterable by status. Generation happens on a job. */

interface InvoiceRow { id: string; invoiceNumber: string; invoiceDate: string; throughDate: string; status: string; totalCents: number; jobNumber: string | null }

const money = (c: number) => `$${(c / 100).toFixed(2)}`
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)' }
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)', fontSize: 13 }
const statusColor: Record<string, string> = { draft: 'var(--pill-neutral-fg)', issued: 'var(--pill-paid-fg)', void: 'var(--pill-overdue-fg)' }
const FILTERS = ['all', 'draft', 'issued', 'void'] as const

export default function InvoicesClient() {
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const { query } = useBranch()

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true) // a background ping refreshes rows in place — no flash
    fetch('/api/billing/invoices' + query)
      .then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setRows(j.data); setErr(null) })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [query])
  useEffect(() => { load() }, [load])
  // Live: a generated or voided invoice updates this list without a refresh.
  useBroadcast('billing', 'changed', () => load(true))

  const shown = useMemo(() => filter === 'all' ? rows : rows.filter((r) => r.status === filter), [rows, filter])

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Invoices</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? 'var(--text-primary)' : 'transparent',
              color: filter === f ? 'var(--surface-2, #fff)' : 'var(--text-muted)',
              border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
            }}>{f}</button>
          ))}
        </div>
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6, marginBottom: 12 }}>{err}</div>}

      <div className="card">
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 2px' }}>
            {rows.length === 0 ? 'No invoices yet. Open a job and generate one from its Invoices tab.' : 'No invoices with that status.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Invoice', 'Job', 'Date', 'Through', 'Status', 'Total'].map((h) => <th key={h} style={{ ...th, textAlign: h === 'Total' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((inv) => (
                <tr key={inv.id}>
                  <td style={td}><Link href={`/billing/invoices/${inv.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>{inv.invoiceNumber}</Link></td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{inv.jobNumber ?? '—'}</td>
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
    </div>
  )
}
