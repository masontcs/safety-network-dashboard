'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Combobox from '@/components/billing/Combobox'

/**
 * Shift detail drawer — slides in from the right when a dispatched shift (published ticket) is
 * clicked on the board. Lets the office make quick adjustments in place — move the date, add or
 * remove crew, change the lead — without leaving dispatch. "Open full ticket" goes to the ticket
 * for deeper edits (charges, labor, photos). Admin-only writes; a voided ticket is read-only.
 */

interface Ticket {
  id: string; ticketNumber: string; date: string; feature: 'add' | 'return' | 'dtc'
  jobNumber: string; jobName: string | null; customer: string | null; profile: string | null; jobTypes: string[]; voided?: boolean
}
interface CrewRow { id: string; isLead: boolean; technician: { id: string; name: string } | null }

const featureLabel = (f: Ticket['feature']) => (f === 'return' ? 'pickup' : f === 'dtc' ? 'DTC' : 'set up')
const dayLong = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export default function ShiftDetailDrawer({ ticket, technicians, isAdmin, onOpenFull, onClose, onChanged }: {
  ticket: Ticket
  technicians: { id: string; name: string }[]
  isAdmin: boolean
  onOpenFull: () => void
  onClose: () => void
  onChanged: () => void
}) {
  const [entered, setEntered] = useState(false)
  const [crew, setCrew] = useState<CrewRow[] | null>(null)
  const [date, setDate] = useState(ticket.date)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const editable = isAdmin && !ticket.voided

  useEffect(() => { const id = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(id) }, [])
  const close = useCallback(() => { setEntered(false); setTimeout(onClose, 240) }, [onClose])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, [close])

  const loadCrew = useCallback(() => {
    fetch(`/api/billing/tickets/${ticket.id}/assignments`).then((r) => r.json()).then((j) => { if (j.success) setCrew(j.data) }).catch(() => {})
  }, [ticket.id])
  useEffect(() => { loadCrew() }, [loadCrew])

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      const j = await res.json()
      if (!j.success) { setErr(j.error ?? 'Something went wrong'); return false }
      return true
    } catch { setErr('Network error — please try again.'); return false }
    finally { setBusy(false) }
  }

  async function addTech(technicianId: string) {
    if (!technicianId) return
    if (await call(`/api/billing/tickets/${ticket.id}/assignments`, 'POST', { technicianId, isLead: (crew ?? []).length === 0 })) { loadCrew(); onChanged() }
  }
  async function makeLead(assignmentId: string) {
    if (await call(`/api/billing/tickets/${ticket.id}/assignments`, 'PATCH', { assignmentId })) { loadCrew(); onChanged() }
  }
  async function removeTech(assignmentId: string) {
    if (await call(`/api/billing/tickets/${ticket.id}/assignments?assignmentId=${assignmentId}`, 'DELETE')) { loadCrew(); onChanged() }
  }
  async function changeDate(newDate: string) {
    if (!newDate || newDate === ticket.date) { setDate(newDate); return }
    setDate(newDate)
    if (await call('/api/billing/dispatch', 'PATCH', { ticketId: ticket.id, ticketDate: newDate })) onChanged()
    else setDate(ticket.date)
  }

  const crewIds = new Set((crew ?? []).map((c) => c.technician?.id).filter(Boolean) as string[])
  const addable = technicians.filter((t) => !crewIds.has(t.id))

  if (typeof document === 'undefined') return null
  const host = document.querySelector('.billing-root') ?? document.body

  return createPortal((
    <div style={{ position: 'fixed', inset: 0, zIndex: 120 }}>
      {/* Backdrop */}
      <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.32)', opacity: entered ? 1 : 0, transition: 'opacity 240ms ease' }} />
      {/* Panel */}
      <div style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 'min(440px, 92vw)', background: 'var(--surface)', borderLeft: '1px solid var(--line)', boxShadow: '-16px 0 40px -20px rgba(0,0,0,.4)', transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 260ms cubic-bezier(.4,0,.2,1)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ticket.customer ?? ticket.profile ?? ticket.jobName ?? ticket.jobNumber}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ticket.ticketNumber} · {featureLabel(ticket.feature)}</div>
          </div>
          <button className="bx-iconbtn" onClick={close} title="Close">✕</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {ticket.voided && <div className="bx-note amber" style={{ fontSize: 12.5 }}>This ticket is voided — read only.</div>}

          {/* Details */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ticket.profile && <Field label="Profile" value={ticket.profile} />}
            {ticket.customer && <Field label="Customer" value={ticket.customer} />}
            <Field label="Job" value={`${ticket.jobNumber}${ticket.jobName ? ` · ${ticket.jobName}` : ''}`} />
            <Field label="Ticket" value={ticket.ticketNumber} />
            {ticket.jobTypes.length > 0 && <Field label="Type" value={ticket.jobTypes.join(', ')} />}
          </section>

          {/* Date */}
          <section>
            <label className="bx-lbl">Date</label>
            {editable
              ? <input type="date" className="bx-f" style={{ width: '100%' }} value={date} onChange={(e) => changeDate(e.target.value)} disabled={busy} />
              : <div style={{ fontSize: 13 }}>{dayLong(ticket.date)}</div>}
          </section>

          {/* Crew */}
          <section>
            <label className="bx-lbl">Crew{crew && crew.length > 1 ? ' · ★ sets the lead' : ''}</label>
            {crew === null ? <div className="bx-sub">Loading…</div> : crew.length === 0 ? <div className="bx-sub" style={{ marginBottom: 8 }}>No techs assigned yet.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {crew.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: c.isLead ? 'var(--accent-soft)' : 'var(--surface)' }}>
                    {editable && (
                      <button type="button" title={c.isLead ? 'Lead' : 'Make lead'} onClick={() => !c.isLead && makeLead(c.id)} disabled={busy}
                        style={{ border: 'none', background: 'transparent', cursor: c.isLead ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, color: c.isLead ? 'var(--accent)' : 'var(--dim,#bbb)' }}>★</button>
                    )}
                    <span style={{ flex: 1, fontSize: 13, fontWeight: c.isLead ? 600 : 400 }}>{c.technician?.name ?? '—'}{c.isLead ? ' · lead' : ''}</span>
                    {editable && <button type="button" className="bx-iconbtn" title="Remove from crew" onClick={() => removeTech(c.id)} disabled={busy} style={{ fontSize: 12 }}>✕</button>}
                  </div>
                ))}
              </div>
            )}
            {editable && addable.length > 0 && (
              <Combobox value="" onChange={addTech} placeholder="Add a technician…" ariaLabel="Add a technician"
                options={addable.map((t) => ({ value: t.id, label: t.name }))} />
            )}
          </section>

          {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '14px 18px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
          <button className="bx-btn accent" onClick={onOpenFull}>Open full ticket ↗</button>
          <button className="bx-btn ghost" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  ), host)
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.4 }}>
      <span style={{ color: 'var(--muted)', minWidth: 60, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}
