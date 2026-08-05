'use client'

import { useEffect, useState } from 'react'
import Sheet from '@/components/tech/Sheet'
import { techApi, TechApiError, type ActivityType } from '@/lib/tech/client'
import { minutesToTime, segmentMinutes, minutesToHours } from '@/lib/billing/labor'

/**
 * "Add time" — activity + a start/end time stepped in 15-minute increments, with the
 * derived hours shown live so the tech sees the math before saving. Cross-midnight is
 * marked +1d. Times are the product; the server re-rounds and re-derives to be safe.
 */
const STEP = 15
const DAY = 1440

export default function AddTimeSheet({ ticketId, onClose, onSaved }: { ticketId: string; onClose: () => void; onSaved: () => void }) {
  const [activities, setActivities] = useState<ActivityType[]>([])
  const [activityId, setActivityId] = useState('')
  const [start, setStart] = useState(7 * 60)   // 07:00
  const [end, setEnd] = useState(15 * 60)       // 15:00
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    techApi.listActivityTypes().then((a) => {
      setActivities(a)
      if (a.length) setActivityId((cur) => cur || a[0].id)
    }).catch(() => {})
  }, [])

  const step = (v: number, dir: 1 | -1) => ((v + dir * STEP) % DAY + DAY) % DAY
  const mins = segmentMinutes(start, end)
  const hours = minutesToHours(mins)
  const crosses = end <= start

  async function save() {
    if (busy) return
    if (!activityId) { setErr('Pick an activity.'); return }
    setBusy(true); setErr(null)
    try {
      await techApi.addLabor(ticketId, { activityTypeId: activityId, startTime: minutesToTime(start), endTime: minutesToTime(end) })
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

      <button className="tech-btn block" onClick={save} disabled={busy || !activityId}>{busy ? 'Saving…' : 'Save time'}</button>
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
