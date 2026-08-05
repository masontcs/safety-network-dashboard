'use client'

import { useState, useEffect, useCallback } from 'react'
import Skeleton from '@/components/ui/Skeleton'
import Select from '@/components/billing/Select'
import { rowOpen } from '@/components/billing/rowOpen'

/**
 * Labor time capture for a ticket (layer 1 — see v2-labor-model.md).
 *
 * Techs record TIMES, not hour sums — the grid derives every duration. Times are
 * normalised to the nearest quarter hour by the API, and a segment may cross
 * midnight (shown with a +1d marker). These entries are the source of truth;
 * billing rolls them up separately and never changes them.
 */

interface Entry {
  id: string
  startTime: string
  endTime: string
  crossesMidnight: boolean
  minutes: number
  hours: number
  technician: { id: string; name: string } | null
  activityType: { id: string; name: string } | null
}
interface Opt { id: string; name: string }

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '6px 9px', fontSize: 12.5, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
}
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--text-muted)', padding: '7px 10px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)',
}
const ghost: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6,
  padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
}
const hrs = (h: number) => `${h.toFixed(2)} h`

export default function TicketLaborTab({ ticketId, canEdit }: { ticketId: string; canEdit: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [techs, setTechs] = useState<Opt[]>([])
  const [acts, setActs] = useState<Opt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // add form
  const [nTech, setNTech] = useState('')
  const [nAct, setNAct] = useState('')
  const [nStart, setNStart] = useState('07:00')
  const [nEnd, setNEnd] = useState('15:30')

  // inline edit
  const [editId, setEditId] = useState<string | null>(null)
  const [eTech, setETech] = useState(''); const [eAct, setEAct] = useState('')
  const [eStart, setEStart] = useState(''); const [eEnd, setEEnd] = useState('')

  // `silent` (default, post-mutation) refreshes labor lines without flashing the skeleton.
  const load = useCallback((silent = true) => {
    if (!silent) setLoading(true)
    return fetch(`/api/billing/tickets/${ticketId}/labor`).then((r) => r.json()).then((l) => {
      if (!l.success) throw new Error(l.error)
      setEntries(l.data)
      setError(null)
    }).catch((e: Error) => setError(e.message)).finally(() => { if (!silent) setLoading(false) })
  }, [ticketId])

  // The technician dropdown is scoped to THIS ticket's crew (billing_ticket_assignments),
  // not every technician in the system — you only log time for people who were on the job.
  // Activity types are the global list. Both are static here, so fetch once.
  useEffect(() => {
    Promise.all([
      fetch(`/api/billing/tickets/${ticketId}/assignments`).then((r) => r.json()),
      fetch('/api/billing/activity-types').then((r) => r.json()),
    ]).then(([crew, a]) => {
      if (crew.success) {
        const opts = (crew.data as { technician: Opt | null }[])
          .map((c) => c.technician)
          .filter((t): t is Opt => !!t)
        setTechs(opts); setNTech((c) => c || opts[0]?.id || '')
      }
      if (a.success) { setActs(a.data); setNAct((c) => c || a.data[0]?.id || '') }
    }).catch(() => {})
  }, [ticketId])

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

  async function add() {
    if (!nTech || !nAct) { setMsg('Pick a technician and activity'); return }
    if (await call(`/api/billing/tickets/${ticketId}/labor`, 'POST', { technicianId: nTech, activityTypeId: nAct, startTime: nStart, endTime: nEnd })) load()
  }
  function startEdit(e: Entry) {
    setEditId(e.id); setETech(e.technician?.id ?? ''); setEAct(e.activityType?.id ?? ''); setEStart(e.startTime); setEEnd(e.endTime)
  }
  async function saveEdit() {
    if (await call(`/api/billing/tickets/${ticketId}/labor`, 'PATCH', { entryId: editId, technicianId: eTech, activityTypeId: eAct, startTime: eStart, endTime: eEnd })) { setEditId(null); load() }
  }
  async function remove(id: string) {
    if (await call(`/api/billing/tickets/${ticketId}/labor?entryId=${id}`, 'DELETE')) load()
  }

  if (error) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {error}</div>
  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={40} />)}</div>

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0)
  // Per-tech totals: crew shaping at billing time needs to know who worked how long.
  const byTech = new Map<string, number>()
  for (const e of entries) {
    const k = e.technician?.name ?? '—'
    byTech.set(k, (byTech.get(k) ?? 0) + e.minutes)
  }

  return (
    <div className="card">
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
        Time is entered as start/end — hours are calculated, never typed, and round to the nearest quarter hour.
        These entries are the record of what happened; billing sums them separately and never changes them.
      </div>

      {msg && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6, marginBottom: 14 }}>{msg}</div>}

      {entries.length > 0 ? (
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['Technician', 'Activity', 'Start', 'End', 'Hours', ''].map((h) => <th key={h} style={{ ...th, textAlign: h === 'Hours' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {entries.map((e) => editId === e.id ? (
                <tr key={e.id}>
                  <td style={td}><Select ariaLabel="Technician" value={eTech} onChange={setETech} style={inputStyle}>{techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></td>
                  <td style={td}><Select ariaLabel="Activity" value={eAct} onChange={setEAct} style={inputStyle}>{acts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></td>
                  <td style={td}><input type="time" step={900} value={eStart} onChange={(ev) => setEStart(ev.target.value)} style={{ ...inputStyle, width: 110 }} /></td>
                  <td style={td}><input type="time" step={900} value={eEnd} onChange={(ev) => setEEnd(ev.target.value)} style={{ ...inputStyle, width: 110 }} /></td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--text-dim)' }}>—</td>
                  <td style={td}><div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={saveEdit} disabled={busy} style={{ ...ghost, borderColor: 'var(--accent)', color: 'var(--accent)', padding: '4px 8px' }}>Save</button>
                    <button onClick={() => setEditId(null)} style={{ ...ghost, padding: '4px 8px' }}>✕</button>
                  </div></td>
                </tr>
              ) : (
                <tr key={e.id} {...rowOpen(canEdit ? () => startEdit(e) : undefined)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                  <td style={td}>{e.technician?.name ?? '—'}</td>
                  <td style={{ ...td, color: 'var(--text-secondary)' }}>{e.activityType?.name ?? '—'}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{e.startTime}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                    {e.endTime}
                    {e.crossesMidnight && <span title="Crosses midnight" style={{ marginLeft: 6, fontSize: 10, color: 'var(--pill-pending-fg)' }}>+1d</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{hrs(e.hours)}</td>
                  <td style={td}>{canEdit && <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={(ev) => { ev.stopPropagation(); startEdit(e) }} disabled={busy} style={{ ...ghost, padding: '4px 8px' }}>Edit</button>
                    <button onClick={(ev) => { ev.stopPropagation(); remove(e.id) }} disabled={busy} style={{ ...ghost, padding: '4px 8px' }}>✕</button>
                  </div>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ ...td, textAlign: 'right', color: 'var(--text-muted)', fontWeight: 500 }}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{hrs(totalMinutes / 60)}</td>
                <td style={td} />
              </tr>
            </tfoot>
          </table>

          {byTech.size > 1 && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: 'var(--text-muted)' }}>
              {[...byTech.entries()].map(([name, mins]) => (
                <span key={name}>{name}: <strong style={{ color: 'var(--text-secondary)' }}>{hrs(mins / 60)}</strong></span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14 }}>No time logged on this ticket yet.</div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle, var(--border-emphasis))', paddingTop: 14 }}>
          <div style={{ minWidth: 160 }}><label style={labelStyle}>Technician</label>
            <Select ariaLabel="Technician" value={nTech} onChange={setNTech} style={inputStyle}>
              {techs.length === 0 && <option value="">No crew assigned</option>}
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div style={{ minWidth: 140 }}><label style={labelStyle}>Activity</label>
            <Select ariaLabel="Activity" value={nAct} onChange={setNAct} style={inputStyle}>
              {acts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div style={{ width: 120 }}><label style={labelStyle}>Start</label><input type="time" step={900} value={nStart} onChange={(e) => setNStart(e.target.value)} style={inputStyle} /></div>
          <div style={{ width: 120 }}><label style={labelStyle}>End</label><input type="time" step={900} value={nEnd} onChange={(e) => setNEnd(e.target.value)} style={inputStyle} /></div>
          <button onClick={add} disabled={busy || !nTech || !nAct} style={{ ...ghost, height: 30 }}>+ Add time</button>
        </div>
      )}
    </div>
  )
}
