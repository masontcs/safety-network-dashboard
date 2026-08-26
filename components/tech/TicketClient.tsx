'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { techApi, TechApiError, type TicketDetail } from '@/lib/tech/client'
import FeatureTags from '@/components/tech/FeatureTags'
import Sheet from '@/components/tech/Sheet'
import AddTimeSheet from '@/components/tech/AddTimeSheet'
import AddEquipmentSheet from '@/components/tech/AddEquipmentSheet'
import { useBroadcast } from '@/lib/realtime/useBroadcast'

type SheetKind = 'time' | 'equipment' | 'submit' | null

/** Screen 2 — one ticket. Read-only header + Labor / Equipment tabs. Lead-only submit. */
export default function TicketClient({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [t, setT] = useState<TicketDetail | null>(null)
  const [gone, setGone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'labor' | 'equipment'>('labor')
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    try {
      setErr(null)
      setT(await techApi.getTicket(ticketId))
    } catch (e) {
      if (e instanceof TechApiError && e.status === 404) { setGone(true); return }
      setErr(e instanceof TechApiError ? e.message : 'Could not load this ticket.')
    }
  }, [ticketId])

  useEffect(() => { load() }, [load])
  // Live: crew/assignment/void changes from the office reflect without a refresh. If the
  // office voids this ticket, the refetch 404s and the screen shows it's no longer available.
  useBroadcast('billing', 'changed', load)

  async function removeLabor(entryId: string) {
    if (!window.confirm('Remove this time entry?')) return
    try { await techApi.deleteLabor(ticketId, entryId); load() }
    catch (e) { setErr(e instanceof TechApiError ? e.message : 'Could not remove that entry.') }
  }
  async function removeEquipment(entryId: string) {
    if (!window.confirm('Remove this equipment?')) return
    try { await techApi.deleteEquipment(ticketId, entryId); load() }
    catch (e) { setErr(e instanceof TechApiError ? e.message : 'Could not remove that item.') }
  }
  async function doSubmit() {
    if (submitting) return
    setSubmitting(true)
    try {
      await techApi.submit(ticketId)
      router.push('/tech') // it's handed off — it leaves their world
    } catch (e) {
      setErr(e instanceof TechApiError ? e.message : 'Could not submit.')
      setSubmitting(false)
      setSheet(null)
    }
  }

  const bar = (
    <div className="tech-bar">
      <button className="tech-back" onClick={() => router.push('/tech')}>‹ Tickets</button>
    </div>
  )

  if (gone) {
    return (
      <>
        {bar}
        <div className="tech-page">
          <div className="tech-card">
            <div className="tech-empty">
              This ticket isn’t available anymore.<br />
              It may have been submitted or closed by the office.
            </div>
            <button className="tech-btn block" onClick={() => router.push('/tech')}>Back to my tickets</button>
          </div>
        </div>
      </>
    )
  }

  if (!t) {
    return (
      <>
        {bar}
        <div className="tech-page">
          {err ? <div className="tech-note err">{err}</div> : <div className="tech-skeleton" style={{ height: 220 }} />}
        </div>
      </>
    )
  }

  const crewLabor = t.labor // for a crew tech this is already only theirs
  const showSubmit = t.isLead

  return (
    <>
      {bar}
      <div className="tech-page">
        {err && <div className="tech-note err" role="alert">{err}</div>}

        {/* Read-only header — what the work is. They can't change any of it. */}
        <div className="tech-card">
          <div className="tech-row">
            <span className="tech-num">{t.ticketNumber}</span>
            <FeatureTags features={t.features} isLead={t.isLead} />
          </div>
          <div className="tech-jobname">{t.job?.name || t.job?.number || 'Job'}</div>
          <div className="tech-meta">
            {t.customer ? <>{t.customer}<br /></> : null}
            {t.site || 'No site address'}<br />
            {t.date}
          </div>
        </div>

        <div className="tech-tabs">
          <button className={`tech-tab ${tab === 'labor' ? 'on' : ''}`} onClick={() => setTab('labor')}>Labor</button>
          <button className={`tech-tab ${tab === 'equipment' ? 'on' : ''}`} onClick={() => setTab('equipment')}>Equipment</button>
        </div>

        {tab === 'labor' && (
          <div className="tech-card">
            <div className="tech-row" style={{ marginBottom: 6 }}>
              <span className="tech-lbl" style={{ margin: 0 }}>{t.isLead ? 'Crew time' : 'My time'}</span>
              <div className="tech-hours" style={{ marginLeft: 'auto' }}>
                <b>{t.myHours.toFixed(2)}</b><span>my hrs</span>
              </div>
            </div>

            {crewLabor.length === 0 && <div className="tech-empty">No time logged yet.</div>}
            {crewLabor.map((l) => (
              <div key={l.id} className="tech-item">
                <div className="body">
                  <div className="t1">{l.activity}{t.isLead && !l.mine ? ` · ${l.technicianName}` : ''}</div>
                  <div className="t2">{l.startTime}–{l.endTime}{l.crossesMidnight ? ' +1d' : ''}{l.enteredOnMyBehalf ? ' · entered by lead' : ''}</div>
                </div>
                <div className="r"><b>{l.hours.toFixed(2)}</b> h</div>
                {(l.mine || t.isLead) && <button className="tech-linkbtn" onClick={() => removeLabor(l.id)} aria-label="Remove">✕</button>}
              </div>
            ))}

            <button className="tech-btn ghost block" onClick={() => setSheet('time')}>+ Add time</button>
          </div>
        )}

        {tab === 'equipment' && (
          <div className="tech-card">
            <span className="tech-lbl">Equipment on this ticket</span>
            {t.equipment.length === 0 && <div className="tech-empty">No equipment recorded yet.</div>}
            {t.equipment.map((e) => (
              <div key={e.id} className="tech-item">
                <div className="body">
                  <div className="t1">{e.itemName}{e.variation ? ` · ${e.variation}` : ''}</div>
                  <div className="t2">
                    {e.itemCode}
                    {e.eventType ? <> · <span className={`tech-tag ${e.eventType === 'return' ? 'ret' : e.eventType === 'lost' ? 'dtc' : 'add'}`}>{e.eventType}</span></> : null}
                    {e.equipmentId ? ` · ${e.equipmentId}` : ''}
                  </div>
                </div>
                <div className="r"><b>{e.qty}</b></div>
                <button className="tech-linkbtn" onClick={() => removeEquipment(e.id)} aria-label="Remove">✕</button>
              </div>
            ))}

            <button className="tech-btn ghost block" onClick={() => setSheet('equipment')}>+ Add equipment</button>
          </div>
        )}

        {showSubmit && (
          <button className="tech-btn good" style={{ marginTop: 4 }} onClick={() => setSheet('submit')}>Submit ticket</button>
        )}
      </div>

      {sheet === 'time' && <AddTimeSheet destinations={[{ id: ticketId, kind: 'ticket', label: t.ticketNumber }]} onClose={() => setSheet(null)} onSaved={load} />}
      {sheet === 'equipment' && <AddEquipmentSheet ticketId={ticketId} features={t.features} onClose={() => setSheet(null)} onSaved={load} />}
      {sheet === 'submit' && (
        <Sheet title="Submit ticket" onClose={() => setSheet(null)}>
          <div className="tech-note info">This finalizes your edits and the items added. The ticket goes to the office and leaves your list. If they need more, they can send it back.</div>
          <button className="tech-btn good block" onClick={doSubmit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit ticket'}</button>
          <button className="tech-btn ghost block" onClick={() => setSheet(null)} disabled={submitting}>Cancel</button>
        </Sheet>
      )}
    </>
  )
}
