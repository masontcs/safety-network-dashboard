'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { techApi, TechApiError, type TicketListItem, type YardShift } from '@/lib/tech/client'
import SignOutButton from '@/components/tech/SignOutButton'
import FeatureTags from '@/components/tech/FeatureTags'
import AddTimeSheet, { type TimeDestination } from '@/components/tech/AddTimeSheet'
import { useBroadcast } from '@/lib/realtime/useBroadcast'

const shortDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Screen 1 — my active tickets + yard shifts. Tap a ticket to open it, or add time to any. */
export default function MyTicketsClient() {
  const [tickets, setTickets] = useState<TicketListItem[] | null>(null)
  const [yard, setYard] = useState<YardShift[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [addTime, setAddTime] = useState(false)

  const load = useCallback(async () => {
    try {
      setErr(null)
      const [tk, yd] = await Promise.all([techApi.listTickets(), techApi.listYard().catch(() => [])])
      setTickets(tk)
      setYard(yd)
    } catch (e) {
      setErr(e instanceof TechApiError ? e.message : 'Could not load your tickets.')
    }
  }, [])

  useEffect(() => { load() }, [load])
  // Live: the moment the office dispatches me, my list updates — no refresh.
  useBroadcast('dispatch', 'changed', load)

  // Every place a time entry can go today: each of my tickets, plus any yard shift.
  const destinations: TimeDestination[] = [
    ...(tickets ?? []).map((t) => ({ id: t.id, kind: 'ticket' as const, label: `${t.ticketNumber}${t.customer ? ` · ${t.customer}` : ''}` })),
    ...yard.map((y) => ({ id: y.id, kind: 'yard' as const, label: `Yard · ${shortDate(y.date)}` })),
  ]

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
        {err && (
          <div className="tech-note err" role="alert">
            {err} <button onClick={load} className="tech-linkbtn" style={{ color: 'inherit', textDecoration: 'underline' }}>Retry</button>
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
