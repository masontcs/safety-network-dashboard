'use client'

import { useEffect, useState } from 'react'

/**
 * Portal home — what a customer sees first: their open jobs (with equipment still out)
 * and their issued invoices. View-only for now; request/self-service flows come later.
 */

interface Invoice { id: string; invoiceNumber: string; invoiceDate: string; throughDate: string; totalCents: number; jobNumber: string; jobName: string | null }
interface Job { id: string; jobNumber: string; name: string | null; status: string; dateOpened: string; location: string | null; onRentUnits: number }

const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const statusLabel = (s: string) => ({ new: 'New', in_progress: 'Active', on_hold: 'On hold' } as Record<string, string>)[s] ?? s

export default function PortalHome() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/portal/invoices').then((r) => r.json()),
      fetch('/api/portal/jobs').then((r) => r.json()),
    ]).then(([inv, jb]) => {
      if (!inv.success) throw new Error(inv.error)
      if (!jb.success) throw new Error(jb.error)
      setInvoices(inv.data); setJobs(jb.data)
    }).catch((e: Error) => setErr(e.message))
  }, [])

  if (err) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Something went wrong loading your account: {err}</div>

  return (
    <div>
      <h1 className="bx-h1">Your account</h1>
      <div className="bx-sub">Open jobs and invoices from Safety Network.</div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="bx-cardhead"><h3>Open jobs</h3></div>
        {jobs === null ? <div className="bx-empty">Loading…</div>
          : jobs.length === 0 ? <div className="bx-empty">No open jobs right now.</div>
          : (
            <table className="bx-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thL}>Job</th><th style={thL}>Location</th><th style={thL}>Status</th>
                  <th style={thR}>On rent</th><th style={thR}>Opened</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={tdL}><span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--dim)', fontSize: 12 }}>{j.jobNumber}</span>{j.name ? <span style={{ marginLeft: 8 }}>{j.name}</span> : null}</td>
                    <td style={tdL}>{j.location ?? '—'}</td>
                    <td style={tdL}><span className="tag t-amber">{statusLabel(j.status)}</span></td>
                    <td style={tdR}>{j.onRentUnits > 0 ? `${j.onRentUnits.toLocaleString()} units` : '—'}</td>
                    <td style={tdR}>{day(j.dateOpened)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <div className="card">
        <div className="bx-cardhead"><h3>Invoices</h3></div>
        {invoices === null ? <div className="bx-empty">Loading…</div>
          : invoices.length === 0 ? <div className="bx-empty">No invoices yet.</div>
          : (
            <table className="bx-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thL}>Invoice</th><th style={thL}>Job</th><th style={thL}>Date</th>
                  <th style={thL}>Through</th><th style={thR}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((v) => (
                  <tr key={v.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={tdL}><span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--accent)', fontWeight: 600, fontSize: 12.5 }}>{v.invoiceNumber}</span></td>
                    <td style={tdL}><span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--dim)', fontSize: 12 }}>{v.jobNumber}</span></td>
                    <td style={tdL}>{day(v.invoiceDate)}</td>
                    <td style={tdL}>{day(v.throughDate)}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{money(v.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}

const thBase: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--dim)', fontWeight: 600, padding: '4px 8px' }
const thL: React.CSSProperties = { ...thBase, textAlign: 'left' }
const thR: React.CSSProperties = { ...thBase, textAlign: 'right' }
const tdL: React.CSSProperties = { padding: '10px 8px', fontSize: 13, textAlign: 'left' }
const tdR: React.CSSProperties = { padding: '10px 8px', fontSize: 13, textAlign: 'right' }
