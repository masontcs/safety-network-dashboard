'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Select from '@/components/billing/Select'
import { BILLING_TYPE_LABELS, BILLING_TYPES } from '@/lib/billing/constants'

/**
 * The tickets list + "New ticket" form shown on a job's detail page. Tickets
 * always belong to a job, so this is their natural creation point.
 */

interface TicketRow {
  id: string
  ticketNumber: string
  date: string
  status: string
  recurring: boolean
  features: string[]
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '6px 9px', fontSize: 12.5, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }
const ghost: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }

export default function JobTicketsSection({ jobId, isAdmin }: { jobId: string; isAdmin: boolean }) {
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showNew, setShowNew] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [add, setAdd] = useState(true); const [ret, setRet] = useState(false); const [dtc, setDtc] = useState(false)
  const [billingType, setBillingType] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/billing/tickets?jobId=${jobId}`)
      .then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setTickets(j.data); setErr(null) })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [jobId])

  useEffect(() => { load() }, [load])

  async function create() {
    if (dtc && (add || ret)) { setErr('DTC cannot be combined with Add or Return'); return }
    if (!add && !ret && !dtc) { setErr('Pick at least one feature'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/billing/tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, ticketDate: date, featureAdd: add, featureReturn: ret, featureDtc: dtc, billingType: billingType || null }),
      })
      const json = await res.json()
      if (!json.success) { setErr(json.error); return }
      setShowNew(false); setDate(today); setAdd(true); setRet(false); setDtc(false); setBillingType(''); load()
    } catch { setErr('Network error — please try again.') }
    finally { setBusy(false) }
  }

  const statusColors: Record<string, string> = { active: 'var(--pill-neutral-fg)', in_review: 'var(--pill-pending-fg)', final_edit: 'var(--pill-paid-fg)', invoiced: 'var(--accent)' }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Tickets</div>
        {isAdmin && <button onClick={() => { setShowNew((v) => !v); setErr(null) }} style={{ ...ghost, marginLeft: 'auto' }}>+ New ticket</button>}
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6, marginBottom: 12 }}>{err}</div>}

      {showNew && isAdmin && (
        <div style={{ border: '1px solid var(--border-subtle, var(--border-emphasis))', borderRadius: 8, padding: 14, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={labelStyle}>Features</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {([['Add', add, () => { setAdd(!add); if (!add) setDtc(false) }], ['Return', ret, () => { setRet(!ret); if (!ret) setDtc(false) }], ['DTC', dtc, () => { const n = !dtc; setDtc(n); if (n) { setAdd(false); setRet(false) } }]] as const).map(([lbl, on, toggle]) => (
                <button key={lbl} onClick={toggle} style={{ ...ghost, ...(on ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 500 } : {}) }}>{lbl}</button>
              ))}
            </div>
          </div>
          <div style={{ width: 150 }}><label style={labelStyle}>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></div>
          <div style={{ minWidth: 180 }}>
            <label style={labelStyle}>Billing type</label>
            <Select ariaLabel="Billing type" value={billingType} onChange={setBillingType}>
              <option value="">Set later</option>
              {BILLING_TYPES.map((bt) => <option key={bt} value={bt}>{BILLING_TYPE_LABELS[bt]}</option>)}
            </Select>
          </div>
          <button onClick={create} disabled={busy} className="btn-primary" style={{ padding: '7px 16px', opacity: busy ? 0.5 : 1 }}>Create</button>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 2px' }}>Loading…</div>
      ) : tickets.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 2px' }}>No tickets yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {tickets.map((t) => (
            <Link key={t.id} href={`/billing/tickets/${t.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', borderRadius: 8, textDecoration: 'none', color: 'var(--text-primary)' }}>
              <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--accent)' }}>{t.ticketNumber}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{t.date}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.features.join(' + ') || '—'}</span>
              {t.recurring && <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--pill-pending-fg)' }}>RECURRING</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: statusColors[t.status], textTransform: 'capitalize' }}>{t.status.replace('_', ' ')}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
