'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { techApi, TechApiError, type TicketListItem } from '@/lib/tech/client'
import SignOutButton from '@/components/tech/SignOutButton'
import FeatureTags from '@/components/tech/FeatureTags'

/** Screen 1 — every ticket assigned to me that is active. Tap one to open it. */
export default function MyTicketsClient() {
  const [tickets, setTickets] = useState<TicketListItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setErr(null)
      setTickets(await techApi.listTickets())
    } catch (e) {
      setErr(e instanceof TechApiError ? e.message : 'Could not load your tickets.')
    }
  }, [])

  useEffect(() => { load() }, [load])

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
      </div>
    </>
  )
}
