'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { techApi, TechApiError, type TicketListItem, type YardShift, type TechShift } from '@/lib/tech/client'
import SignOutButton from '@/components/tech/SignOutButton'
import NotificationsToggle from '@/components/tech/NotificationsToggle'
import FeatureTags from '@/components/tech/FeatureTags'
import AddTimeSheet, { type TimeDestination } from '@/components/tech/AddTimeSheet'
import ShiftAckCard from '@/components/tech/ShiftAckCard'
import { useBroadcast } from '@/lib/realtime/useBroadcast'

const shortDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Screen 1 — my active tickets + yard shifts. Tap a ticket to open it, or add time to any. */
export default function MyTicketsClient() {
  const [tickets, setTickets] = useState<TicketListItem[] | null>(null)
  const [yard, setYard] = useState<YardShift[]>([])
  const [shifts, setShifts] = useState<TechShift[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [addTime, setAddTime] = useState(false)

  const load = useCallback(async () => {
    try {
      setErr(null)
      const [tk, yd, sh] = await Promise.all([
        techApi.listTickets(),
        techApi.listYard().catch(() => []),
        techApi.listShifts().catch(() => []),
      ])
      setTickets(tk)
      setYard(yd)
      setShifts(sh)
    } catch (e) {
      setErr(e instanceof TechApiError ? e.message : 'Could not load your tickets.')
    }
  }, [])

  async function acknowledge(id: string) {
    // Optimistic — mark it acknowledged locally, then confirm.
    setShifts((s) => s.map((x) => x.id === id ? { ...x, acknowledged: true } : x))
    try { await techApi.acknowledgeShift(id) } catch { load() }
  }

  useEffect(() => { load() }, [load])
  // Live: the moment the office dispatches me — or voids a ticket I'm on — my list
  // updates, no refresh. (load doesn't blank existing data, so it refreshes in place.)
  useBroadcast('billing', 'changed', load)

  // Every place a time entry can go today: each of my tickets, plus any yard shift.
  const destinations: TimeDestination[] = [
    ...(tickets ?? []).map((t) => ({ id: t.id, kind: 'ticket' as const, label: `${t.ticketNumber}${t.customer ? ` · ${t.customer}` : ''}`, date: t.date })),
    ...yard.map((y) => ({ id: y.id, kind: 'yard' as const, label: `Yard · ${shortDate(y.date)}`, date: y.date })),
  ]

  const toAck = shifts.filter((s) => !s.acknowledged)

  return (
    <>
      <div className="tech-bar">
        <div>
          <h1>My Tickets</h1>
          <div className="sub">Assigned to you today</div>
        </div>
        <div className="spacer" />
        <SignOutButton />
      </div>

      <div className="tech-page">
        <NotificationsToggle />
        {err && (
          <div className="tech-note err" role="alert">
            {err} <button onClick={load} className="tech-linkbtn" style={{ color: 'inherit', textDecoration: 'underline' }}>Retry</button>
          </div>
        )}

        {toAck.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="tech-lbl" style={{ marginBottom: 6 }}>Shifts to acknowledge</div>
            {toAck.map((s) => <ShiftAckCard key={s.id} shift={s} onAck={() => acknowledge(s.id)} />)}
          </div>
        )}

        {tickets === null && !err && (
          <>
            {[0, 1, 2].map((i) => <div key={i} className="tech-skeleton" style={{ height: 96, marginBottom: 12 }} />)}
          </>
        )}

        {tickets !== null && tickets.length === 0 && (
          <div className="tech-card">
            <div className="tech-empty">
              No tickets assigned to you right now.<br />
              When the office assigns you, they’ll show up here.
            </div>
          </div>
        )}

        {tickets !== null && destinations.length > 0 && (
          <button className="tech-btn block" style={{ marginBottom: 12 }} onClick={() => setAddTime(true)}>+ Add time</button>
        )}

        {tickets?.map((t) => (
          <Link key={t.id} href={`/tech/tickets/${t.id}`} className="tech-card tech-ticketcard">
            <div className="tech-row">
              <span className="tech-num">{t.ticketNumber}</span>
              <FeatureTags features={t.features} isLead={t.isLead} />
              <div className="tech-hours">
                <b>{t.myHours.toFixed(2)}</b>
                <span>my hrs</span>
              </div>
            </div>
            <div className="tech-jobname">{t.job?.name || t.job?.number || 'Job'}</div>
            <div className="tech-meta">
              {t.customer ? <>{t.customer}<br /></> : null}
              {t.site || 'No site address'}
            </div>
          </Link>
        ))}

        {yard.map((y) => (
          <div key={y.id} className="tech-card">
            <div className="tech-row">
              <span className="tech-num">Yard</span>
              <div className="tech-hours" style={{ marginLeft: 'auto' }}>
                <b>{y.myHours.toFixed(2)}</b><span>my hrs</span>
              </div>
            </div>
            <div className="tech-meta">{shortDate(y.date)} · yard shift (no ticket)</div>
          </div>
        ))}
      </div>

      {addTime && (
        <AddTimeSheet destinations={destinations} onClose={() => setAddTime(false)} onSaved={load} />
      )}
    </>
  )
}
