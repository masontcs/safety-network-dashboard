'use client'

import { useEffect, useState } from 'react'
import Sheet from '@/components/tech/Sheet'
import { techApi, TechApiError, type ActivityType } from '@/lib/tech/client'
import { minutesToTime, segmentMinutes, minutesToHours } from '@/lib/billing/labor'

/**
 * "Add time" — pick WHERE it goes (a ticket the tech is on today, or their yard shift),
 * an activity, and a start/end stepped in 15-minute increments, with the derived hours
 * shown live. A note can be added (it rides through to the TSheets export). When there's
 * only one destination the picker is hidden. Times are the product; the server re-rounds.
 */
const STEP = 15
const DAY = 1440

export interface TimeDestination { id: string; kind: 'ticket' | 'yard'; label: string; date?: string }

export default function AddTimeSheet({ destinations, preselectId, onClose, onSaved }: {
  destinations: TimeDestination[]
  preselectId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [destId, setDestId] = useState(preselectId ?? destinations[0]?.id ?? '')
  const [activities, setActivities] = useState<ActivityType[]>([])
  const [activityId, setActivityId] = useState('')
  const [start, setStart] = useState(7 * 60)   // 07:00
  const [end, setEnd] = useState(15 * 60)       // 15:00
  // The entry's date. Defaults to the destination's date; the tech changes it for the
  // next-day portion of an overnight shift so it exports on the right day.
  const [workDate, setWorkDate] = useState<string>(destinations.find((d) => d.id === (preselectId ?? destinations[0]?.id))?.date ?? '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    techApi.listActivityTypes().then((a) => {
      setActivities(a)
      if (a.length) setActivityId((cur) => cur || a[0].id)
    }).catch(() => {})
  }, [])

  // Follow the chosen destination's date (a tech can still override for overnight).
  useEffect(() => { const d = destinations.find((x) => x.id === destId); if (d?.date) setWorkDate(d.date) }, [destId, destinations])

  const step = (v: number, dir: 1 | -1) => ((v + dir * STEP) % DAY + DAY) % DAY
  const mins = segmentMinutes(start, end)
  const hours = minutesToHours(mins)
  const crosses = end <= start

  async function save() {
    if (busy) return
    const dest = destinations.find((d) => d.id === destId)
    if (!dest) { setErr('Pick where this time goes.'); return }
    if (!activityId) { setErr('Pick an activity.'); return }
    setBusy(true); setErr(null)
    const body = { activityTypeId: activityId, startTime: minutesToTime(start), endTime: minutesToTime(end), notes: notes.trim() || undefined, workDate: workDate || undefined }
    try {
      if (dest.kind === 'ticket') await techApi.addLabor(dest.id, body)
      else await techApi.addYardTime(dest.id, body)
      onSaved()
      onClose()
    } catch (e) {
      setErr(e instanceof TechApiError ? e.message : 'Could not save your time.')
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add time" onClose={onClose}>
      {err && <div className="tech-note err" role="alert">{err}</div>}

      {destinations.length > 1 && (
        <div className="tech-field">
          <span className="tech-lbl">Goes to</span>
          <div className="tech-chips">
            {destinations.map((d) => (
              <button key={d.id} type="button" className={`tech-chip ${destId === d.id ? 'on' : ''}`} onClick={() => setDestId(d.id)}>{d.label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="tech-field">
        <span className="tech-lbl">Date{crosses ? ' · overnight — set the next day for the after-midnight part' : ''}</span>
        <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--tech-line, #d8d5cc)', fontSize: 16, fontFamily: 'inherit', background: 'var(--tech-surface, #fff)', color: 'inherit' }} />
      </div>

      <div className="tech-field">
        <span className="tech-lbl">Activity</span>
        <div className="tech-chips">
          {activities.map((a) => (
            <button key={a.id} type="button" className={`tech-chip ${activityId === a.id ? 'on' : ''}`} onClick={() => setActivityId(a.id)}>{a.name}</button>
          ))}
          {activities.length === 0 && <div className="tech-note info" style={{ width: '100%' }}>No activities configured — ask the office.</div>}
        </div>
      </div>

      <div className="tech-field">
        <span className="tech-lbl">Start</span>
        <TimeStepper value={start} onDown={() => setStart((v) => step(v, -1))} onUp={() => setStart((v) => step(v, 1))} />
      </div>

      <div className="tech-field">
        <span className="tech-lbl">End</span>
        <TimeStepper value={end} plusDay={crosses} onDown={() => setEnd((v) => step(v, -1))} onUp={() => setEnd((v) => step(v, 1))} />
      </div>

      <div className="tech-hoursreadout">= <b>{hours.toFixed(2)}</b> h{crosses ? ' (overnight)' : ''}</div>

      <div className="tech-field">
        <span className="tech-lbl">Note (optional)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Transit to Barstow"
          style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--tech-line, #d8d5cc)', fontSize: 16, fontFamily: 'inherit', background: 'var(--tech-surface, #fff)', color: 'inherit' }} />
      </div>

      <button className="tech-btn block" onClick={save} disabled={busy || !activityId || !destId}>{busy ? 'Saving…' : 'Save time'}</button>
    </Sheet>
  )
}

function TimeStepper({ value, plusDay, onDown, onUp }: { value: number; plusDay?: boolean; onDown: () => void; onUp: () => void }) {
  return (
    <div className="tech-stepper">
      <button type="button" onClick={onDown} aria-label="Earlier">−</button>
      <div className="val">{minutesToTime(value)}{plusDay && <span className="d">+1d</span>}</div>
      <button type="button" onClick={onUp} aria-label="Later">+</button>
    </div>
  )
}
