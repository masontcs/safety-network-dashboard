'use client'

import { useState, useEffect, useCallback } from 'react'
import Skeleton from '@/components/ui/Skeleton'
import Combobox from '@/components/billing/Combobox'

/**
 * Crew assignment on a ticket — who worked it and who's the LEAD.
 *
 * The lead is the crew member with is_lead, set per ticket so it can change day to day.
 * They're accountable for the whole crew's time being in and are the only one who can
 * submit the ticket from the tech app — so a crew with no lead is called out here.
 */

interface CrewRow { id: string; isLead: boolean; technician: { id: string; name: string } | null }
interface Tech { id: string; name: string }

const ghost: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6,
  padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
}

export default function TicketCrewCard({ ticketId, canEdit }: { ticketId: string; canEdit: boolean }) {
  const [crew, setCrew] = useState<CrewRow[]>([])
  const [techs, setTechs] = useState<Tech[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState('')

  // `silent` (default, post-mutation) refreshes the crew without flashing the skeleton.
  const load = useCallback((silent = true) => {
    if (!silent) setLoading(true)
    return fetch(`/api/billing/tickets/${ticketId}/assignments`).then((r) => r.json()).then((c) => {
      if (!c.success) throw new Error(c.error)
      setCrew(c.data)
      setError(null)
    }).catch((e: Error) => setError(e.message)).finally(() => { if (!silent) setLoading(false) })
  }, [ticketId])

  // Technician roster is static here — fetch once, not on every crew change.
  useEffect(() => {
    fetch('/api/billing/technicians').then((r) => r.json()).then((t) => { if (t.success) setTechs(t.data) }).catch(() => {})
  }, [])

  useEffect(() => { load(false) }, [load])

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json()
      if (!json.success) { setMsg(json.error); return false }
      return true
    } catch { setMsg('Network error — please try again.'); return false }
    finally { setBusy(false) }
  }

  const hasLead = crew.some((c) => c.isLead)

  async function add() {
    if (!pick) return
    // First person on an empty crew becomes the lead — a crew with no lead can't submit.
    if (await call(`/api/billing/tickets/${ticketId}/assignments`, 'POST', { technicianId: pick, isLead: crew.length === 0 })) { setPick(''); load() }
  }
  async function makeLead(id: string) {
    if (await call(`/api/billing/tickets/${ticketId}/assignments`, 'PATCH', { assignmentId: id })) load()
  }
  async function remove(id: string) {
    if (await call(`/api/billing/tickets/${ticketId}/assignments?assignmentId=${id}`, 'DELETE')) load()
  }

  if (loading) return <div className="card"><Skeleton height={90} /></div>
  if (error) return <div className="card" style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load crew: {error}</div>

  const assignedIds = new Set(crew.map((c) => c.technician?.id))
  const available = techs.filter((t) => !assignedIds.has(t.id))

  return (
    <div className="card">
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>Crew</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
        Who worked this ticket. The <strong>lead</strong> is accountable for everyone&apos;s time being in and is the
        only one who can submit it from the tech app.
      </div>

      {msg && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6, marginBottom: 12 }}>{msg}</div>}

      {crew.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14 }}>No crew assigned yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {crew.map((c) => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8,
              background: 'var(--bg-nav)', border: `1px solid ${c.isLead ? 'var(--accent)' : 'var(--border-subtle, var(--border-emphasis))'}`,
            }}>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: c.isLead ? 500 : 400 }}>{c.technician?.name ?? '—'}</span>
              {c.isLead && (
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft-bg)', padding: '1px 7px', borderRadius: 999 }}>LEAD</span>
              )}
              {canEdit && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {!c.isLead && <button onClick={() => makeLead(c.id)} disabled={busy} style={ghost}>Make lead</button>}
                  <button onClick={() => remove(c.id)} disabled={busy} style={ghost} title="Remove from crew">✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {crew.length > 0 && !hasLead && (
        <div style={{ fontSize: 12, color: 'var(--alert-warning-fg)', background: 'var(--alert-warning-bg)', padding: '8px 10px', borderRadius: 6, marginBottom: 14 }}>
          No lead assigned — nobody can submit this ticket from the tech app.
        </div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border-subtle, var(--border-emphasis))', paddingTop: 14 }}>
          <div style={{ flex: 1, maxWidth: 280 }}>
            <Combobox
              ariaLabel="Add technician to crew"
              placeholder={available.length ? 'Add a technician…' : 'All technicians assigned'}
              value={pick}
              onChange={setPick}
              disabled={available.length === 0}
              options={available.map((t) => ({ value: t.id, label: t.name }))}
            />
          </div>
          <button onClick={add} disabled={busy || !pick} style={{ ...ghost, height: 32, opacity: pick ? 1 : 0.5 }}>+ Add to crew</button>
        </div>
      )}
    </div>
  )
}
