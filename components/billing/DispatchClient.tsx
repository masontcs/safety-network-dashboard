'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBranch } from '@/components/billing/BranchContext'
import ShiftEditorModal from '@/components/billing/ShiftEditorModal'
import { useBroadcast } from '@/lib/realtime/useBroadcast'

/**
 * Dispatch board — the concept's week grid: technicians as rows, Mon–Fri as columns,
 * ticket cards in the cell for (lead tech × ticket_date). Drag a card to another
 * driver row or day column to reassign the lead / move the date. Admin-only writes.
 */

interface Ticket {
  id: string; ticketNumber: string; date: string; leadTechId: string | null; crewTechIds: string[]
  feature: 'add' | 'return' | 'dtc'; jobNumber: string; jobName: string | null; customer: string | null; voided?: boolean
}
interface YardShift { id: string; technicianId: string; date: string }
interface StagedShift { id: string; date: string; isYard: boolean; crewTechIds: string[]; leadTechId: string | null; jobNumber: string | null; jobName: string | null; customer: string | null; jobTypes: string[] }
interface Board { weekStart: string; days: string[]; technicians: { id: string; name: string }[]; tickets: Ticket[]; yard: YardShift[]; isAdmin: boolean }

const addDays = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }
const dayLabel = (d: string) => { const dt = new Date(d + 'T00:00:00Z'); return dt.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }) }
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const featureClass = (f: Ticket['feature']) => (f === 'return' ? 'blue' : f === 'dtc' ? 'amber' : '')
const featureLabel = (f: Ticket['feature']) => (f === 'return' ? 'pickup' : f === 'dtc' ? 'DTC' : 'set up')

// Cards for the "no lead assigned" row live in a synthetic technician id.
const UNASSIGNED = '__unassigned__'

export default function DispatchClient() {
  const [board, setBoard] = useState<Board | null>(null)
  const [staged, setStaged] = useState<StagedShift[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [week, setWeek] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [toast, setToast] = useState<string | null>(null)
  const [dispatchCell, setDispatchCell] = useState<{ techId: string | null; date: string } | null>(null)
  const [editShiftId, setEditShiftId] = useState<string | null>(null)
  const drag = useRef<Ticket | null>(null)
  const router = useRouter()
  const { branchId } = useBranch()

  const load = useCallback((w: string, silent = false) => {
    if (!silent) setBoard(null) // a background ping refreshes in place — no blank flash
    const bq = branchId ? `&branchId=${branchId}` : ''
    fetch(`/api/billing/dispatch?week=${w}${bq}`).then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setBoard(j.data) })
      .catch((e: Error) => setErr(e.message))
    // Staged shifts (drafts) live alongside published tickets on the board.
    fetch(`/api/billing/shifts?week=${w}&status=staged${bq}`).then((r) => r.json())
      .then((j) => { if (j.success) setStaged(j.data) }).catch(() => {})
  }, [branchId])
  useEffect(() => { load(week) }, [week, load])
  // Live: refetch the instant anyone dispatches / reassigns / yards, or a ticket is
  // created or voided (a void greys / drops the card here).
  useBroadcast('billing', 'changed', () => load(week, true))

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
  const yardFor = (techId: string, day: string) =>
    (board?.yard ?? []).filter((y) => y.date === day && y.technicianId === techId)
  // Staged shifts show under each crew member (or Unassigned if no crew yet).
  const stagedFor = (techId: string, day: string) =>
    staged.filter((s) => s.date === day && (techId === UNASSIGNED ? s.crewTechIds.length === 0 : s.crewTechIds.includes(techId)))

  async function publishShift(id: string) {
    const res = await fetch(`/api/billing/shifts/${id}/publish`, { method: 'POST' }).then((r) => r.json()).catch(() => ({ success: false }))
    if (!res.success) { flash(res.error || 'Could not publish — reloading.'); load(week) }
    else flash(res.data?.ticketNumber ? `Published — ticket ${res.data.ticketNumber}.` : 'Shift published.')
  }
  async function deleteShift(id: string) {
    // Draft-only; optimistic. (Published shifts can't be deleted — void the ticket instead.)
    setStaged((s) => s.filter((x) => x.id !== id))
    const res = await fetch(`/api/billing/shifts/${id}`, { method: 'DELETE' }).then((r) => r.json()).catch(() => ({ success: false }))
    if (!res.success) { flash('Could not delete — reloading.'); load(week) }
    else flash('Staged shift deleted.')
  }

  async function removeYard(id: string) {
    setBoard((b) => b && { ...b, yard: b.yard.filter((y) => y.id !== id) })
    const res = await fetch(`/api/billing/dispatch/assign?yardShiftId=${id}`, { method: 'DELETE' })
      .then((r) => r.json()).catch(() => ({ success: false }))
    if (!res.success) { flash('Could not remove yard shift — reloading.'); load(week) }
    else flash('Yard shift removed.')
  }

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
                yardFor={yardFor}
                stagedFor={stagedFor}
                onRemoveYard={removeYard}
                onPublishShift={publishShift}
                onEditShift={(id) => setEditShiftId(id)}
                onDeleteShift={deleteShift}
                canDrag={!!board?.isAdmin}
                onDragStart={(t) => { drag.current = t }}
                onDrop={(techId, day) => { if (drag.current) { reassign(drag.current, techId, day); drag.current = null } }}
                onOpen={(t) => router.push(`/billing/tickets/${t.id}`)}
                onDispatch={(techId, day) => setDispatchCell({ techId: techId === UNASSIGNED ? null : techId, date: day })}
              />
            ))}
          </div>
        </div>
      </div>

      {board && board.tickets.length === 0 && (
        <div className="bx-empty" style={{ marginTop: 10 }}>No tickets scheduled this week.</div>
      )}

      {toast && <div className="bx-toast">{toast}</div>}

      {dispatchCell && board && (
        <ShiftEditorModal
          date={dispatchCell.date}
          technicianId={dispatchCell.techId}
          technicians={board.technicians}
          branchId={branchId ?? null}
          ticketsForDay={board.tickets
            .filter((t) => t.date === dispatchCell.date)
            .map((t) => ({ id: t.id, ticketNumber: t.ticketNumber, jobNumber: t.jobNumber, jobName: t.jobName, customer: t.customer, voided: t.voided }))}
          onClose={() => setDispatchCell(null)}
          onDone={(msg) => { setDispatchCell(null); flash(msg); load(week) }}
        />
      )}

      {editShiftId && board && (
        <ShiftEditorModal
          date={staged.find((s) => s.id === editShiftId)?.date ?? week}
          technicianId={null}
          technicians={board.technicians}
          branchId={branchId ?? null}
          editShiftId={editShiftId}
          ticketsForDay={[]}
          onClose={() => setEditShiftId(null)}
          onDone={(msg) => { setEditShiftId(null); flash(msg); load(week) }}
        />
      )}
    </div>
  )
}

function DispatchRow({ tech, days, loading, cardsFor, yardFor, stagedFor, onRemoveYard, onPublishShift, onEditShift, onDeleteShift, canDrag, onDragStart, onDrop, onOpen, onDispatch }: {
  tech: { id: string; name: string }; days: string[]; loading: boolean; canDrag: boolean
  cardsFor: (techId: string, day: string) => Ticket[]
  yardFor: (techId: string, day: string) => YardShift[]
  stagedFor: (techId: string, day: string) => StagedShift[]
  onRemoveYard: (id: string) => void
  onPublishShift: (id: string) => void; onEditShift: (id: string) => void; onDeleteShift: (id: string) => void
  onDragStart: (t: Ticket) => void; onDrop: (techId: string, day: string) => void; onOpen: (t: Ticket) => void
  onDispatch: (techId: string, day: string) => void
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
        const yard = loading ? [] : yardFor(tech.id, day)
        const stagedCards = loading ? [] : stagedFor(tech.id, day)
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
              // A voided ticket isn't work to schedule — show it greyed and don't let it drag.
              const dragThis = canDrag && (isUnassigned || isLead) && !t.voided
              return (
                <div
                  key={t.id}
                  className={`tk ${featureClass(t.feature)}`}
                  style={t.voided ? { opacity: 0.4, textDecoration: 'line-through' } : (!isUnassigned && !isLead ? { opacity: 0.72 } : undefined)}
                  draggable={dragThis}
                  onDragStart={dragThis ? () => onDragStart(t) : undefined}
                  onClick={() => onOpen(t)}
                  title={t.voided ? `${t.ticketNumber} · voided` : dragThis ? `${t.ticketNumber} · drag to reassign / open` : `${t.ticketNumber} · on crew · open`}
                >
                  <b>{(t.customer ?? t.jobName ?? t.jobNumber) + ' — ' + featureLabel(t.feature)}{t.voided ? ' · VOID' : !isUnassigned && isLead ? ' ·lead' : ''}</b>
                  <small>{t.jobName && t.customer ? t.jobName : t.jobNumber}</small>
                </div>
              )
            })}
            {yard.map((y) => (
              <div key={y.id} className="tk" style={{ background: 'var(--bg-secondary, #eee)', border: '1px solid var(--border, #ddd)', color: 'var(--text-secondary, #555)' }}
                title="Yard shift — no ticket">
                <b>YARD{canDrag ? '' : ''}</b>
                {canDrag && <small onClick={(e) => { e.stopPropagation(); onRemoveYard(y.id) }} style={{ cursor: 'pointer', color: 'var(--danger, #c0392b)' }}>remove</small>}
              </div>
            ))}
            {/* Staged shifts (drafts) — dashed, not yet published. Only the lead's cell shows actions. */}
            {stagedCards.map((s) => {
              const showActions = canDrag && (tech.id === UNASSIGNED || s.leadTechId === tech.id || (s.crewTechIds.length > 0 && s.crewTechIds[0] === tech.id && !s.leadTechId))
              return (
                <div key={s.id} className="tk" style={{ background: 'transparent', border: '1px dashed var(--accent, #b8860b)', color: 'var(--text-secondary, #555)' }}
                  title="Staged shift — not published yet">
                  <b>{(s.isYard ? 'YARD' : (s.customer ?? s.jobName ?? s.jobNumber ?? 'Shift'))} · STAGED</b>
                  <small>{s.isYard ? 'yard shift (draft)' : (s.jobTypes.length ? s.jobTypes.join(', ') : (s.jobNumber ?? ''))}</small>
                  {showActions && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                      <small onClick={(e) => { e.stopPropagation(); onPublishShift(s.id) }} style={{ cursor: 'pointer', color: 'var(--accent, #b8860b)', fontWeight: 600 }}>publish</small>
                      <small onClick={(e) => { e.stopPropagation(); onEditShift(s.id) }} style={{ cursor: 'pointer', color: 'var(--text-secondary, #555)' }}>edit</small>
                      <small onClick={(e) => { e.stopPropagation(); onDeleteShift(s.id) }} style={{ cursor: 'pointer', color: 'var(--danger, #c0392b)' }}>delete</small>
                    </div>
                  )}
                </div>
              )
            })}
            {canDrag && (
              <button
                type="button"
                className="dcell-add"
                onClick={() => onDispatch(tech.id, day)}
                title="Dispatch a tech to this day"
                style={{ width: '100%', marginTop: cards.length ? 4 : 0, background: 'transparent', border: '1px dashed var(--border, #d8d5cc)', borderRadius: 6, color: 'var(--dim, #999)', fontSize: 11, padding: '3px 0', cursor: 'pointer' }}
              >+ dispatch</button>
            )}
          </div>
        )
      })}
    </>
  )
}
