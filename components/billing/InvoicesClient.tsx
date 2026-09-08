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

  // QuickBooks export panel
  const monthStart = new Date(); monthStart.setDate(1)
  const [showQb, setShowQb] = useState(false)
  const [qbStart, setQbStart] = useState(monthStart.toISOString().slice(0, 10))
  const [qbEnd, setQbEnd] = useState(new Date().toISOString().slice(0, 10))
  const [qbInclude, setQbInclude] = useState(false)
  const [qbEntities, setQbEntities] = useState<{ entityId: string; code: string; name: string; invoiceCount: number; totalCents: number }[] | null>(null)
  const [qbBusy, setQbBusy] = useState(false)
  const [qbErr, setQbErr] = useState<string | null>(null)

  const loadQbSummary = useCallback(() => {
    setQbBusy(true); setQbErr(null); setQbEntities(null)
    fetch(`/api/billing/invoices/qb-export/summary?start=${qbStart}&end=${qbEnd}&includeExported=${qbInclude ? '1' : '0'}`)
      .then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setQbEntities(j.data.entities) })
      .catch((e: Error) => setQbErr(e.message))
      .finally(() => setQbBusy(false))
  }, [qbStart, qbEnd, qbInclude])

  async function downloadQb(entityId: string, code: string) {
    setQbErr(null)
    try {
      const res = await fetch(`/api/billing/invoices/qb-export?entityId=${entityId}&start=${qbStart}&end=${qbEnd}&includeExported=${qbInclude ? '1' : '0'}&markExported=1`)
      if (!res.ok) { const j = await res.json().catch(() => ({})); setQbErr(j.error || 'Export failed'); return }
      const blob = await res.blob()
      const name = res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1] ?? `QuickBooks_${code}.iif`
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
      loadQbSummary(); load(true) // counts drop as invoices get stamped exported
    } catch { setQbErr('Network error — please try again.') }
  }

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
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Invoices</span>
        <button onClick={() => { setShowQb((v) => !v); if (!showQb) setTimeout(loadQbSummary, 0) }} style={{
          marginLeft: 'auto', background: showQb ? 'var(--text-primary)' : 'transparent', color: showQb ? 'var(--surface-2, #fff)' : 'var(--text-muted)',
          border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
        }}>Export to QuickBooks</button>
        <div style={{ display: 'flex', gap: 4 }}>
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

      {showQb && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Export to QuickBooks</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Issued invoices in the range, as one .iif per entity. Defaults to invoices not yet exported; downloading marks them exported.</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
            <div><label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>From</label>
              <input type="date" value={qbStart} onChange={(e) => setQbStart(e.target.value)} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '6px 9px', fontSize: 13, color: 'var(--text-primary)', fontFamily: 'inherit' }} /></div>
            <div><label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>To</label>
              <input type="date" value={qbEnd} onChange={(e) => setQbEnd(e.target.value)} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '6px 9px', fontSize: 13, color: 'var(--text-primary)', fontFamily: 'inherit' }} /></div>
            <label style={{ fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={qbInclude} onChange={(e) => setQbInclude(e.target.checked)} /> Include already-exported
            </label>
            <button onClick={loadQbSummary} disabled={qbBusy} style={{ background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '7px 14px', fontSize: 12.5, color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit' }}>{qbBusy ? 'Loading…' : 'Refresh'}</button>
          </div>

          {qbErr && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6, marginBottom: 10 }}>{qbErr}</div>}

          {qbEntities === null ? null
            : qbEntities.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No issued invoices to export in that range.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Entity', 'Invoices', 'Total', ''].map((h) => <th key={h} style={{ ...th, textAlign: h === 'Invoices' || h === 'Total' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {qbEntities.map((e) => (
                    <tr key={e.entityId}>
                      <td style={td}>{e.code}{e.name ? ` · ${e.name}` : ''}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.invoiceCount}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(e.totalCents)}</td>
                      <td style={{ ...td, textAlign: 'right' }}><button onClick={() => downloadQb(e.entityId, e.code)} className="btn-primary" style={{ padding: '5px 14px', fontSize: 12.5 }}>Download .iif</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

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
