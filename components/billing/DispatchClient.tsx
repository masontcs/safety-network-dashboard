'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBranch } from '@/components/billing/BranchContext'

/**
 * Dispatch board — the concept's week grid: technicians as rows, Mon–Fri as columns,
 * ticket cards in the cell for (lead tech × ticket_date). Drag a card to another
 * driver row or day column to reassign the lead / move the date. Admin-only writes.
 */

interface Ticket {
  id: string; ticketNumber: string; date: string; leadTechId: string | null; crewTechIds: string[]
  feature: 'add' | 'return' | 'dtc'; jobNumber: string; jobName: string | null; customer: string | null
}
interface Board { weekStart: string; days: string[]; technicians: { id: string; name: string }[]; tickets: Ticket[]; isAdmin: boolean }

const addDays = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }
const dayLabel = (d: string) => { const dt = new Date(d + 'T00:00:00Z'); return dt.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }) }
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const featureClass = (f: Ticket['feature']) => (f === 'return' ? 'blue' : f === 'dtc' ? 'amber' : '')
const featureLabel = (f: Ticket['feature']) => (f === 'return' ? 'pickup' : f === 'dtc' ? 'DTC' : 'set up')

// Cards for the "no lead assigned" row live in a synthetic technician id.
const UNASSIGNED = '__unassigned__'

export default function DispatchClient() {
  const [board, setBoard] = useState<Board | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [week, setWeek] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [toast, setToast] = useState<string | null>(null)
  const drag = useRef<Ticket | null>(null)
  const router = useRouter()
  const { branchId } = useBranch()

  const load = useCallback((w: string) => {
    setBoard(null)
    fetch(`/api/billing/dispatch?week=${w}${branchId ? `&branchId=${branchId}` : ''}`).then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setBoard(j.data) })
      .catch((e: Error) => setErr(e.message))
  }, [branchId])
  useEffect(() => { load(week) }, [week, load])

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2200) }

  async function reassign(t: Ticket, techId: string | null, date: string) {
    const technicianId = techId === UNASSIGNED ? null : techId
    if (t.leadTechId === (technicianId ?? null) && t.date === date) return
    // Optimistic: move the card locally, roll back on failure. The old lead stays on the
    // crew (demoted, not removed); the new lead joins the crew if not already on it.
    setBoard((b) => b && { ...b, tickets: b.tickets.map((x) => (x.id === t.id
      ? { ...x, leadTechId: technicianId, date, crewTechIds: technicianId && !x.crewTechIds.includes(technicianId) ? [...x.crewTechIds, technicianId] : x.crewTechIds }
      : x)) })
    const res = await fetch('/api/billing/dispatch', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: t.id, technicianId, ticketDate: date }),
    }).then((r) => r.json()).catch(() => ({ success: false, error: 'network' }))
    if (!res.success) { flash('Could not reassign — reloading.'); load(week) }
    else flash('Reassigned — driver notified.')
  }

  // A ticket appears under EVERY crew member assigned to it. Tickets with no crew at all
  // fall into the Unassigned row so nothing is hidden.
  const cardsFor = (techId: string, day: string) =>
    (board?.tickets ?? []).filter((t) => t.date === day && (techId === UNASSIGNED ? t.crewTechIds.length === 0 : t.crewTechIds.includes(techId)))

  const weekRangeLabel = board
    ? `${new Date(board.weekStart + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`
    : ''

  if (err) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load dispatch: {err}</div>

  // Technician rows plus an Unassigned row so nothing is hidden.
  const rows: { id: string; name: string }[] = [
    ...(board?.technicians ?? []),
    { id: UNASSIGNED, name: 'Unassigned' },
  ]
  const days = board?.days ?? Array.from({ length: 5 }, (_, i) => addDays(week, i))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="bx-h1">Dispatch</h1>
          <div className="bx-sub">
            Week of {weekRangeLabel || '…'}{board?.isAdmin ? ' · drag a ticket to another driver or day.' : ' · read-only.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="bx-btn ghost" onClick={() => setWeek(addDays(week, -7))}>‹ Prev</button>
          <button className="bx-btn ghost" onClick={() => setWeek(new Date().toISOString().slice(0, 10))}>This week</button>
          <button className="bx-btn ghost" onClick={() => setWeek(addDays(week, 7))}>Next ›</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14, padding: 0 }}>
        <div className="bx-board">
          <div className="bx-week">
            <div className="hcell">Driver</div>
            {days.map((d) => <div className="hcell" key={d}>{dayLabel(d)}</div>)}

            {rows.map((tech) => (
              <DispatchRow
                key={tech.id}
                tech={tech}
                days={days}
                loading={!board}
                cardsFor={cardsFor}
                canDrag={!!board?.isAdmin}
                onDragStart={(t) => { drag.current = t }}
                onDrop={(techId, day) => { if (drag.current) { reassign(drag.current, techId, day); drag.current = null } }}
                onOpen={(t) => router.push(`/billing/tickets/${t.id}`)}
              />
            ))}
          </div>
        </div>
      </div>

      {board && board.tickets.length === 0 && (
        <div className="bx-empty" style={{ marginTop: 10 }}>No tickets scheduled this week.</div>
      )}

      {toast && <div className="bx-toast">{toast}</div>}
    </div>
  )
}

function DispatchRow({ tech, days, loading, cardsFor, canDrag, onDragStart, onDrop, onOpen }: {
  tech: { id: string; name: string }; days: string[]; loading: boolean; canDrag: boolean
  cardsFor: (techId: string, day: string) => Ticket[]
  onDragStart: (t: Ticket) => void; onDrop: (techId: string, day: string) => void; onOpen: (t: Ticket) => void
}) {
  const [over, setOver] = useState<string | null>(null)
  const isUnassigned = tech.id === UNASSIGNED
  return (
    <>
      <div className="drv">
        {!isUnassigned && <span className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>{initials(tech.name)}</span>}
        <span style={{ color: isUnassigned ? 'var(--dim)' : 'inherit' }}>{tech.name}</span>
      </div>
      {days.map((day) => {
        const cards = loading ? [] : cardsFor(tech.id, day)
        return (
          <div
            key={day}
            className={`dcell${over === day ? ' over' : ''}`}
            onDragOver={canDrag ? (e) => { e.preventDefault(); setOver(day) } : undefined}
            onDragLeave={canDrag ? () => setOver(null) : undefined}
            onDrop={canDrag ? (e) => { e.preventDefault(); setOver(null); onDrop(tech.id, day) } : undefined}
          >
            {cards.map((t) => {
              // Only the lead's card (or an unassigned ticket) is draggable — dragging
              // reassigns the LEAD, so it must be unambiguous which instance you're moving.
              const isLead = t.leadTechId === tech.id
              const dragThis = canDrag && (isUnassigned || isLead)
              return (
                <div
                  key={t.id}
                  className={`tk ${featureClass(t.feature)}`}
                  style={!isUnassigned && !isLead ? { opacity: 0.72 } : undefined}
                  draggable={dragThis}
                  onDragStart={dragThis ? () => onDragStart(t) : undefined}
                  onClick={() => onOpen(t)}
                  title={dragThis ? `${t.ticketNumber} · drag to reassign / open` : `${t.ticketNumber} · on crew · open`}
                >
                  <b>{(t.customer ?? t.jobName ?? t.jobNumber) + ' — ' + featureLabel(t.feature)}{!isUnassigned && isLead ? ' ·lead' : ''}</b>
                  <small>{t.jobName && t.customer ? t.jobName : t.jobNumber}</small>
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
