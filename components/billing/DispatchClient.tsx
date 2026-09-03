'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBranch } from '@/components/billing/BranchContext'
import ShiftEditorModal from '@/components/billing/ShiftEditorModal'
import { useBroadcast } from '@/lib/realtime/useBroadcast'

/**
 * Dispatch board with multiple views:
 *   • Time range — Day / Week / Month (Month renders a calendar).
 *   • Group by  — Technician / Customer / Job type (regroups the rows on the Day & Week grids).
 *
 * Rows are the group; columns are the days in the range. Drag-to-reassign and per-cell "+ dispatch"
 * are technician-view only (they change a ticket's lead) — the other groupings are read/click views;
 * use the header "+ Dispatch" there. Admin-only writes.
 */

interface Ticket {
  id: string; ticketNumber: string; date: string; leadTechId: string | null; crewTechIds: string[]
  feature: 'add' | 'return' | 'dtc'; jobNumber: string; jobName: string | null; customer: string | null; profile: string | null; jobTypes: string[]; voided?: boolean
}
interface YardShift { id: string; technicianId: string; date: string }
interface StagedShift { id: string; date: string; isYard: boolean; crewTechIds: string[]; leadTechId: string | null; jobNumber: string | null; jobName: string | null; customer: string | null; jobTypes: string[] }
type Range = 'day' | 'week' | 'month'
type GroupBy = 'tech' | 'customer' | 'jobtype'
interface Board { range: Range; rangeStart: string; rangeEnd: string; days: string[]; technicians: { id: string; name: string }[]; tickets: Ticket[]; yard: YardShift[]; isAdmin: boolean }

const addDays = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }
const addMonths = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCMonth(dt.getUTCMonth() + n); return dt.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)
const dayCol = (d: string) => { const dt = new Date(d + 'T00:00:00Z'); return dt.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }) }
const dayLong = (d: string) => { const dt = new Date(d + 'T00:00:00Z'); return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) }
const monthLabel = (d: string) => { const dt = new Date(d + 'T00:00:00Z'); return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const featureClass = (f: Ticket['feature']) => (f === 'return' ? 'blue' : f === 'dtc' ? 'amber' : '')
const featureLabel = (f: Ticket['feature']) => (f === 'return' ? 'pickup' : f === 'dtc' ? 'DTC' : 'set up')

const UNASSIGNED = '__unassigned__'
const NO_CUSTOMER = '__nocustomer__'
const NO_JOBTYPE = '__nojobtype__'

export default function DispatchClient() {
  const [board, setBoard] = useState<Board | null>(null)
  const [staged, setStaged] = useState<StagedShift[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [range, setRange] = useState<Range>('week')
  const [groupBy, setGroupBy] = useState<GroupBy>('tech')
  const [anchor, setAnchor] = useState<string>(today())
  const [toast, setToast] = useState<string | null>(null)
  const [dispatchCell, setDispatchCell] = useState<{ techId: string | null; date: string } | null>(null)
  const [generalDispatch, setGeneralDispatch] = useState<{ date: string } | null>(null)
  const [editShiftId, setEditShiftId] = useState<string | null>(null)
  const drag = useRef<Ticket | null>(null)
  const router = useRouter()
  const { branchId } = useBranch()

  const load = useCallback((r: Range, a: string, silent = false) => {
    if (!silent) setBoard(null)
    const bq = branchId ? `&branchId=${branchId}` : ''
    fetch(`/api/billing/dispatch?range=${r}&date=${a}${bq}`).then((res) => res.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setBoard(j.data) })
      .catch((e: Error) => setErr(e.message))
    // Staged drafts for the anchor's week (they're near-term); shown on the grid where dates match.
    fetch(`/api/billing/shifts?week=${a}&status=staged${bq}`).then((res) => res.json())
      .then((j) => { if (j.success) setStaged(j.data) }).catch(() => {})
  }, [branchId])
  useEffect(() => { load(range, anchor) }, [range, anchor, load])
  useBroadcast('billing', 'changed', () => load(range, anchor, true))

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2200) }

  async function reassign(t: Ticket, techId: string | null, date: string) {
    const technicianId = techId === UNASSIGNED ? null : techId
    if (t.leadTechId === (technicianId ?? null) && t.date === date) return
    setBoard((b) => b && { ...b, tickets: b.tickets.map((x) => (x.id === t.id
      ? { ...x, leadTechId: technicianId, date, crewTechIds: technicianId && !x.crewTechIds.includes(technicianId) ? [...x.crewTechIds, technicianId] : x.crewTechIds }
      : x)) })
    const res = await fetch('/api/billing/dispatch', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: t.id, technicianId, ticketDate: date }),
    }).then((r) => r.json()).catch(() => ({ success: false }))
    if (!res.success) { flash('Could not reassign — reloading.'); load(range, anchor) }
    else flash('Reassigned — driver notified.')
  }

  async function publishShift(id: string) {
    const res = await fetch(`/api/billing/shifts/${id}/publish`, { method: 'POST' }).then((r) => r.json()).catch(() => ({ success: false }))
    if (!res.success) { flash(res.error || 'Could not publish — reloading.'); load(range, anchor) }
    else flash(res.data?.ticketNumber ? `Published — ticket ${res.data.ticketNumber}.` : 'Shift published.')
  }
  async function deleteShift(id: string) {
    setStaged((s) => s.filter((x) => x.id !== id))
    const res = await fetch(`/api/billing/shifts/${id}`, { method: 'DELETE' }).then((r) => r.json()).catch(() => ({ success: false }))
    if (!res.success) { flash('Could not delete — reloading.'); load(range, anchor) }
    else flash('Staged shift deleted.')
  }
  async function removeYard(id: string) {
    setBoard((b) => b && { ...b, yard: b.yard.filter((y) => y.id !== id) })
    const res = await fetch(`/api/billing/dispatch/assign?yardShiftId=${id}`, { method: 'DELETE' }).then((r) => r.json()).catch(() => ({ success: false }))
    if (!res.success) { flash('Could not remove yard shift — reloading.'); load(range, anchor) }
    else flash('Yard shift removed.')
  }

  // Prev/next step by the active range.
  const step = (dir: -1 | 1) => setAnchor((a) => range === 'month' ? addMonths(a, dir) : range === 'day' ? addDays(a, dir) : addDays(a, dir * 7))
  const days = board?.days ?? []
  const isTech = groupBy === 'tech'

  // Rows for the current grouping. Tech: technicians + Unassigned. Customer/Job type: the distinct
  // values present in this range (published + staged), plus a catch-all row so nothing hides.
  const rows = useMemo<{ key: string; label: string; sub?: string }[]>(() => {
    if (!board) return []
    if (groupBy === 'tech') return [...board.technicians.map((t) => ({ key: t.id, label: t.name })), { key: UNASSIGNED, label: 'Unassigned' }]
    if (groupBy === 'customer') {
      const set = new Map<string, string>()
      board.tickets.forEach((t) => { if (t.customer) set.set(t.customer, t.customer) })
      staged.forEach((s) => { if (s.customer) set.set(s.customer, s.customer) })
      const list = [...set.values()].sort((a, b) => a.localeCompare(b)).map((c) => ({ key: c, label: c }))
      return [...list, { key: NO_CUSTOMER, label: 'No customer' }]
    }
    const set = new Set<string>()
    board.tickets.forEach((t) => t.jobTypes.forEach((j) => set.add(j)))
    staged.forEach((s) => s.jobTypes.forEach((j) => set.add(j)))
    const list = [...set].sort((a, b) => a.localeCompare(b)).map((j) => ({ key: j, label: j }))
    return [...list, { key: NO_JOBTYPE, label: 'No job type' }]
  }, [board, staged, groupBy])

  // Membership tests for a row × day.
  const ticketIn = (t: Ticket, key: string) =>
    groupBy === 'tech' ? (key === UNASSIGNED ? t.crewTechIds.length === 0 : t.crewTechIds.includes(key))
    : groupBy === 'customer' ? (t.customer ?? NO_CUSTOMER) === key
    : (t.jobTypes.length ? t.jobTypes.includes(key) : key === NO_JOBTYPE)
  const stagedIn = (s: StagedShift, key: string) =>
    groupBy === 'tech' ? (key === UNASSIGNED ? s.crewTechIds.length === 0 : s.crewTechIds.includes(key))
    : groupBy === 'customer' ? (s.customer ?? NO_CUSTOMER) === key
    : (s.jobTypes.length ? s.jobTypes.includes(key) : key === NO_JOBTYPE)

  const cardsFor = (key: string, day: string) => (board?.tickets ?? []).filter((t) => t.date === day && ticketIn(t, key))
  const yardFor = (key: string, day: string) => (groupBy === 'tech' ? (board?.yard ?? []).filter((y) => y.date === day && y.technicianId === key) : [])
  const stagedFor = (key: string, day: string) => staged.filter((s) => s.date === day && stagedIn(s, key))

  if (err) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load dispatch: {err}</div>

  const rangeTitle = !board ? '…'
    : range === 'day' ? dayLong(anchor)
    : range === 'month' ? monthLabel(anchor)
    : `Week of ${new Date(board.rangeStart + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`

  const seg = (r: Range, label: string) => (
    <button type="button" className={`bx-btn ${range === r ? 'accent' : 'ghost'} sm`} onClick={() => setRange(r)}>{label}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 className="bx-h1">Dispatch</h1>
          <div className="bx-sub">
            {rangeTitle}{board?.isAdmin && isTech && range !== 'month' ? ' · drag a ticket to another driver or day.' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>{seg('day', 'Day')}{seg('week', 'Week')}{seg('month', 'Month')}</div>
          {range !== 'month' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
              Group by
              <select className="bx-f bx-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} style={{ padding: '5px 8px', fontSize: 12.5 }}>
                <option value="tech">Technician</option>
                <option value="customer">Customer</option>
                <option value="jobtype">Job type</option>
              </select>
            </label>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="bx-btn ghost" onClick={() => step(-1)}>‹</button>
            <button className="bx-btn ghost" onClick={() => setAnchor(today())}>Today</button>
            <button className="bx-btn ghost" onClick={() => step(1)}>›</button>
            {board?.isAdmin && <button className="bx-btn accent" onClick={() => setGeneralDispatch({ date: range === 'month' ? today() : anchor })}>+ Dispatch</button>}
          </div>
        </div>
      </div>

      {range === 'month'
        ? <MonthCalendar
            days={days} anchor={anchor} board={board} staged={staged} isAdmin={!!board?.isAdmin}
            onOpenTicket={(t) => router.push(`/billing/tickets/${t.id}`)}
            onDispatchDay={(d) => setGeneralDispatch({ date: d })}
            onPublishShift={publishShift} onEditShift={(id) => setEditShiftId(id)} onDeleteShift={deleteShift} />
        : (
          <div className="card" style={{ marginTop: 14, padding: 0 }}>
            <div className="bx-board">
              <div className="bx-week" style={{ gridTemplateColumns: `170px repeat(${days.length}, minmax(150px,1fr))`, minWidth: 170 + days.length * 150 }}>
                <div className="hcell">{groupBy === 'tech' ? 'Driver' : groupBy === 'customer' ? 'Customer' : 'Job type'}</div>
                {days.map((d) => <div className="hcell" key={d}>{dayCol(d)}</div>)}

                {rows.map((row) => (
                  <GridRow
                    key={row.key}
                    row={row}
                    days={days}
                    loading={!board}
                    groupBy={groupBy}
                    cardsFor={cardsFor}
                    yardFor={yardFor}
                    stagedFor={stagedFor}
                    onRemoveYard={removeYard}
                    onPublishShift={publishShift}
                    onEditShift={(id) => setEditShiftId(id)}
                    onDeleteShift={deleteShift}
                    canDrag={!!board?.isAdmin && isTech}
                    canDispatch={!!board?.isAdmin && isTech}
                    onDragStart={(t) => { drag.current = t }}
                    onDrop={(key, day) => { if (drag.current) { reassign(drag.current, key, day); drag.current = null } }}
                    onOpen={(t) => router.push(`/billing/tickets/${t.id}`)}
                    onDispatch={(key, day) => setDispatchCell({ techId: key === UNASSIGNED ? null : key, date: day })}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

      {board && board.tickets.length === 0 && staged.length === 0 && range !== 'month' && (
        <div className="bx-empty" style={{ marginTop: 10 }}>Nothing scheduled in this {range}.</div>
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
          onDone={(msg) => { setDispatchCell(null); flash(msg); load(range, anchor) }}
        />
      )}

      {generalDispatch && board && (
        <ShiftEditorModal
          date={generalDispatch.date}
          technicianId={null}
          technicians={board.technicians}
          branchId={branchId ?? null}
          pickDate
          ticketsForDay={[]}
          onClose={() => setGeneralDispatch(null)}
          onDone={(msg) => { setGeneralDispatch(null); flash(msg); load(range, anchor) }}
        />
      )}

      {editShiftId && board && (
        <ShiftEditorModal
          date={staged.find((s) => s.id === editShiftId)?.date ?? anchor}
          technicianId={null}
          technicians={board.technicians}
          branchId={branchId ?? null}
          editShiftId={editShiftId}
          ticketsForDay={[]}
          onClose={() => setEditShiftId(null)}
          onDone={(msg) => { setEditShiftId(null); flash(msg); load(range, anchor) }}
        />
      )}
    </div>
  )
}

/* ─── One grouped row (tech / customer / job type) across the day columns ───────────── */
function GridRow({ row, days, loading, groupBy, cardsFor, yardFor, stagedFor, onRemoveYard, onPublishShift, onEditShift, onDeleteShift, canDrag, canDispatch, onDragStart, onDrop, onOpen, onDispatch }: {
  row: { key: string; label: string }; days: string[]; loading: boolean; groupBy: GroupBy; canDrag: boolean; canDispatch: boolean
  cardsFor: (key: string, day: string) => Ticket[]
  yardFor: (key: string, day: string) => YardShift[]
  stagedFor: (key: string, day: string) => StagedShift[]
  onRemoveYard: (id: string) => void
  onPublishShift: (id: string) => void; onEditShift: (id: string) => void; onDeleteShift: (id: string) => void
  onDragStart: (t: Ticket) => void; onDrop: (key: string, day: string) => void; onOpen: (t: Ticket) => void
  onDispatch: (key: string, day: string) => void
}) {
  const [over, setOver] = useState<string | null>(null)
  const muted = row.key === UNASSIGNED || row.key === NO_CUSTOMER || row.key === NO_JOBTYPE
  return (
    <>
      <div className="drv">
        {groupBy === 'tech' && !muted && <span className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>{initials(row.label)}</span>}
        <span style={{ color: muted ? 'var(--dim)' : 'inherit' }}>{row.label}</span>
      </div>
      {days.map((day) => {
        const cards = loading ? [] : cardsFor(row.key, day)
        const yard = loading ? [] : yardFor(row.key, day)
        const stagedCards = loading ? [] : stagedFor(row.key, day)
        const hasContent = cards.length + yard.length + stagedCards.length > 0
        return (
          <div
            key={day}
            className={`dcell${over === day ? ' over' : ''}`}
            onDragOver={canDrag ? (e) => { e.preventDefault(); setOver(day) } : undefined}
            onDragLeave={canDrag ? () => setOver(null) : undefined}
            onDrop={canDrag ? (e) => { e.preventDefault(); setOver(null); onDrop(row.key, day) } : undefined}
          >
            {cards.map((t) => {
              const isLead = t.leadTechId === row.key
              const dragThis = canDrag && (row.key === UNASSIGNED || isLead) && !t.voided
              return (
                <div
                  key={t.id}
                  className={`tk ${featureClass(t.feature)}`}
                  style={t.voided ? { opacity: 0.4, textDecoration: 'line-through' } : (groupBy === 'tech' && row.key !== UNASSIGNED && !isLead ? { opacity: 0.72 } : undefined)}
                  draggable={dragThis}
                  onDragStart={dragThis ? () => onDragStart(t) : undefined}
                  onClick={() => onOpen(t)}
                  title={t.voided ? `${t.ticketNumber} · voided` : `${t.ticketNumber} · open`}
                >
                  <b>{(t.customer ?? t.jobName ?? t.jobNumber) + ' — ' + featureLabel(t.feature)}{t.voided ? ' · VOID' : (groupBy === 'tech' && row.key !== UNASSIGNED && isLead ? ' ·lead' : '')}</b>
                  <small>{groupBy === 'customer' ? (t.jobName ?? t.jobNumber) : groupBy === 'jobtype' ? (t.customer ?? t.jobNumber) : (t.jobName && t.customer ? t.jobName : t.jobNumber)}</small>
                </div>
              )
            })}
            {yard.map((y) => (
              <div key={y.id} className="tk" style={{ background: 'var(--bg-secondary, #eee)', border: '1px solid var(--border, #ddd)', color: 'var(--text-secondary, #555)' }} title="Yard shift — no ticket">
                <b>YARD</b>
                {canDrag && <small onClick={(e) => { e.stopPropagation(); onRemoveYard(y.id) }} style={{ cursor: 'pointer', color: 'var(--danger, #c0392b)' }}>remove</small>}
              </div>
            ))}
            {stagedCards.map((s) => {
              const showActions = canDispatch && (row.key === UNASSIGNED || s.leadTechId === row.key || (s.crewTechIds.length > 0 && s.crewTechIds[0] === row.key && !s.leadTechId) || groupBy !== 'tech')
              return (
                <div key={s.id} className="tk" style={{ background: 'transparent', border: '1px dashed var(--accent, #b8860b)', color: 'var(--text-secondary, #555)' }} title="Staged shift — not published yet">
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
            {canDispatch && (
              <button type="button" className="dcell-add" onClick={() => onDispatch(row.key, day)} title="Dispatch a tech to this day"
                style={{ alignSelf: 'center', margin: hasContent ? '4px auto 0' : 'auto', background: 'transparent', border: '1px dashed var(--border, #d8d5cc)', borderRadius: 6, color: 'var(--dim, #999)', fontSize: 11, padding: '3px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >+ dispatch</button>
            )}
          </div>
        )
      })}
    </>
  )
}

/* ─── Month calendar with a master–detail day agenda ─────────────────────────────────────
   Clicking a day opens an agenda panel that eases in on the RIGHT while the calendar shrinks to
   the left and STAYS interactive — so you can keep picking other days without closing the panel.
   The selected day is highlighted; ✕ collapses the panel. Selecting a day is local (range stays
   'month'). */
function MonthCalendar({ days, anchor, board, staged, isAdmin, onOpenTicket, onDispatchDay, onPublishShift, onEditShift, onDeleteShift }: {
  days: string[]; anchor: string; board: Board | null; staged: StagedShift[]; isAdmin: boolean
  onOpenTicket: (t: Ticket) => void; onDispatchDay: (d: string) => void
  onPublishShift: (id: string) => void; onEditShift: (id: string) => void; onDeleteShift: (id: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  // Collapse the panel whenever the month changes.
  useEffect(() => { setSelected(null) }, [anchor])

  // Pad the month to whole Mon–Sun weeks.
  const dow = (d: string) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7 // 0 = Mon
  const cells: (string | null)[] = []
  if (days.length) { for (let i = 0; i < dow(days[0]); i++) cells.push(null) }
  days.forEach((d) => cells.push(d))
  while (cells.length % 7 !== 0) cells.push(null)
  const t0 = today()

  const countFor = (d: string) => (board?.tickets.filter((t) => t.date === d && !t.voided).length ?? 0) + staged.filter((s) => s.date === d).length + (board?.yard.filter((y) => y.date === d).length ?? 0)
  const chipsFor = (d: string) => (board?.tickets.filter((t) => t.date === d && !t.voided) ?? []).slice(0, selected ? 2 : 3)

  const dayTickets = selected ? (board?.tickets.filter((t) => t.date === selected) ?? []) : []
  const dayStaged = selected ? staged.filter((s) => s.date === selected) : []
  const dayYard = selected ? (board?.yard.filter((y) => y.date === selected) ?? []) : []
  const techName = useMemo(() => new Map((board?.technicians ?? []).map((t) => [t.id, t.name])), [board])

  const PANEL_W = 400
  const weeks = cells.length / 7

  return (
    <div className="card" style={{ marginTop: 14, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 200px)' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch' }}>
        {/* Month — flexes down as the panel opens, stays clickable, fills the card height. */}
        <div style={{ flex: 1, minWidth: 0, padding: 18, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gridTemplateRows: `auto repeat(${weeks}, minmax(64px, 1fr))`, gap: 1, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
              <div key={w} style={{ background: 'var(--surface)', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{w}</div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={i} style={{ background: 'var(--bg, #faf9f7)' }} />
              const n = countFor(d)
              const chips = chipsFor(d)
              const isToday = d === t0
              const isSel = d === selected
              return (
                <button key={d} type="button" onClick={() => setSelected(d)}
                  style={{ textAlign: 'left', background: isSel ? 'var(--accent-soft)' : 'var(--surface)', padding: 8, border: 'none', borderTop: isToday ? '2px solid var(--accent)' : '2px solid transparent', boxShadow: isSel ? 'inset 0 0 0 2px var(--accent)' : 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}
                  title={`${dayLong(d)} — ${n} shift${n === 1 ? '' : 's'}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: isToday || isSel ? 700 : 500, color: isToday ? 'var(--accent)' : 'var(--ink)' }}>{new Date(d + 'T00:00:00Z').getUTCDate()}</span>
                    {n > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', background: 'var(--accent)', borderRadius: 999, padding: '0 6px', lineHeight: '16px' }}>{n}</span>}
                  </div>
                  {chips.map((t) => (
                    <span key={t.id} className={`tk ${featureClass(t.feature)}`} style={{ margin: 0, fontSize: 10.5, padding: '2px 5px', cursor: 'pointer' }}>
                      <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.customer ?? t.jobName ?? t.jobNumber}</b>
                    </span>
                  ))}
                  {n > chips.length && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>+{n - chips.length} more</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Day agenda — width eases from 0; inner fixed width keeps text from reflowing mid-anim.
            Fills the card height and scrolls internally when the day is busy. */}
        <div style={{ flexShrink: 0, width: selected ? PANEL_W : 0, opacity: selected ? 1 : 0, borderLeft: selected ? '1px solid var(--line)' : 'none', transition: 'width 300ms cubic-bezier(.4,0,.2,1), opacity 220ms ease', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: PANEL_W, padding: 18, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: 14.5 }}>{selected ? dayLong(selected) : ''}</h3>
              {isAdmin && selected && <button className="bx-btn accent sm" style={{ marginLeft: 'auto' }} onClick={() => onDispatchDay(selected)}>+ Dispatch</button>}
              <button className="bx-iconbtn" onClick={() => setSelected(null)} title="Close" style={{ marginLeft: isAdmin ? 0 : 'auto' }}>✕</button>
            </div>

            {selected && dayTickets.length === 0 && dayStaged.length === 0 && dayYard.length === 0 ? (
              <div className="bx-empty">Nothing scheduled this day.</div>
            ) : (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 2 }}>
                {dayTickets.map((t) => <AgendaTicketBox key={t.id} t={t} techName={techName} onOpen={() => onOpenTicket(t)} />)}
                {dayStaged.map((s) => <AgendaStagedBox key={s.id} s={s} techName={techName} isAdmin={isAdmin} onPublish={() => onPublishShift(s.id)} onEdit={() => onEditShift(s.id)} onDelete={() => onDeleteShift(s.id)} />)}
                {dayYard.map((y) => (
                  <div key={y.id} style={{ ...agendaBox, borderStyle: 'solid', color: 'var(--muted)' }} title="Yard shift — no ticket">
                    <div style={agendaTitle}><span>Yard shift</span><Feature label="yard" /></div>
                    <Field label="Tech" value={techName.get(y.technicianId) ?? '—'} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Box-style shift widgets for the day agenda ─────────────────────────────────────────── */
const agendaBox: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }
const agendaTitle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }

function Feature({ label }: { label: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    'set up': { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
    pickup: { bg: 'color-mix(in srgb, var(--blue) 14%, transparent)', fg: 'var(--blue)' },
    DTC: { bg: 'var(--warn-soft)', fg: 'var(--brand)' },
    yard: { bg: 'var(--bg-secondary, #eee)', fg: 'var(--muted)' },
    STAGED: { bg: 'transparent', fg: 'var(--accent)' },
  }
  const c = map[label] ?? { bg: 'var(--bg-secondary,#eee)', fg: 'var(--muted)' }
  return <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: c.fg, background: c.bg, border: label === 'STAGED' ? '1px dashed var(--accent)' : 'none', borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }}>{label}</span>
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.35 }}>
      <span style={{ color: 'var(--muted)', minWidth: 48, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function TechChips({ crewTechIds, leadTechId, techName }: { crewTechIds: string[]; leadTechId: string | null; techName: Map<string, string> }) {
  if (crewTechIds.length === 0) return <span style={{ fontSize: 12, color: 'var(--muted)' }}>No techs assigned</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {crewTechIds.map((id) => {
        const lead = id === leadTechId
        return (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, padding: '2px 8px', borderRadius: 999, background: lead ? 'var(--accent-soft)' : 'var(--bg-secondary, #f0efec)', color: lead ? 'var(--accent)' : 'var(--text-primary)', border: lead ? '1px solid var(--accent)' : '1px solid var(--line)' }}>
            {lead && <span aria-hidden>★</span>}{techName.get(id) ?? '—'}
          </span>
        )
      })}
    </div>
  )
}

function AgendaTicketBox({ t, techName, onOpen }: { t: Ticket; techName: Map<string, string>; onOpen: () => void }) {
  return (
    <div onClick={onOpen} title={`${t.ticketNumber} · open`}
      style={{ ...agendaBox, cursor: 'pointer', borderLeft: '3px solid var(--accent)', ...(t.voided ? { opacity: 0.5 } : {}) }}>
      <div style={agendaTitle}>
        <span style={t.voided ? { textDecoration: 'line-through' } : undefined}>{t.customer ?? t.profile ?? t.jobName ?? t.jobNumber}</span>
        <Feature label={t.voided ? 'yard' : featureLabel(t.feature)} />
      </div>
      {t.profile && <Field label="Profile" value={t.profile} />}
      <Field label="Job" value={`${t.jobNumber}${t.jobName ? ` · ${t.jobName}` : ''}`} />
      <Field label="Ticket" value={t.ticketNumber} />
      {t.jobTypes.length > 0 && <Field label="Type" value={t.jobTypes.join(', ')} />}
      <div style={{ borderTop: '1px solid var(--line)', margin: '2px 0 1px' }} />
      <TechChips crewTechIds={t.crewTechIds} leadTechId={t.leadTechId} techName={techName} />
    </div>
  )
}

function AgendaStagedBox({ s, techName, isAdmin, onPublish, onEdit, onDelete }: { s: StagedShift; techName: Map<string, string>; isAdmin: boolean; onPublish: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ ...agendaBox, border: '1px dashed var(--accent)' }} title="Staged shift — not published yet">
      <div style={agendaTitle}>
        <span>{s.isYard ? 'Yard shift' : (s.customer ?? s.jobName ?? s.jobNumber ?? 'Shift')}</span>
        <Feature label="STAGED" />
      </div>
      {!s.isYard && s.jobNumber && <Field label="Job" value={`${s.jobNumber}${s.jobName ? ` · ${s.jobName}` : ''}`} />}
      {s.jobTypes.length > 0 && <Field label="Type" value={s.jobTypes.join(', ')} />}
      <div style={{ borderTop: '1px solid var(--line)', margin: '2px 0 1px' }} />
      <TechChips crewTechIds={s.crewTechIds} leadTechId={s.leadTechId} techName={techName} />
      {isAdmin && (
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <button className="bx-btn accent sm" onClick={onPublish}>Publish</button>
          <button className="bx-btn ghost sm" onClick={onEdit}>Edit</button>
          <button className="bx-btn ghost sm" onClick={onDelete} style={{ color: 'var(--danger)' }}>Delete</button>
        </div>
      )}
    </div>
  )
}
