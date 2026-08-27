'use client'

import { useState } from 'react'
import type { TechShift } from '@/lib/tech/client'

const shortDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * A shift the tech must acknowledge before starting. Shows what they need to see up front —
 * meal type (esp. Approved ODMP = no lunch), 4-10 schedule, PW, per diem, job types, and the
 * traffic plan — then a single Accept. No decline: this is a "saw it" acknowledgement.
 */
export default function ShiftAckCard({ shift, onAck }: { shift: TechShift; onAck: () => void }) {
  const [busy, setBusy] = useState(false)
  const title = shift.isYard ? 'Yard shift' : (shift.customer ?? shift.jobName ?? shift.jobNumber ?? 'Shift')

  const badge = (text: string, tone: 'meal' | 'sched' | 'pw' | 'diem') => {
    const bg = tone === 'pw' ? '#fde8e8' : tone === 'sched' ? '#e7f0ff' : tone === 'diem' ? '#eaf7ec' : '#fff4e0'
    const fg = tone === 'pw' ? '#a11' : tone === 'sched' ? '#1451b4' : tone === 'diem' ? '#1a7a33' : '#8a5a00'
    return <span key={text} style={{ fontSize: 12, fontWeight: 700, background: bg, color: fg, padding: '2px 8px', borderRadius: 999 }}>{text}</span>
  }

  async function accept() {
    if (busy) return
    setBusy(true)
    onAck()
  }

  return (
    <div className="tech-card" style={{ borderLeft: '3px solid var(--tech-accent, #b8860b)' }}>
      <div className="tech-row">
        <span className="tech-num">{shortDate(shift.date)}</span>
        {shift.isLead && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tech-accent, #b8860b)' }}>LEAD</span>}
      </div>
      <div className="tech-jobname">{title}</div>
      {!shift.isYard && shift.jobNumber && <div className="tech-meta">{shift.jobNumber}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {badge(shift.mealLabel, 'meal')}
        {shift.shiftSchedule && badge(shift.shiftSchedule, 'sched')}
        {shift.prevailingWage && badge('PW', 'pw')}
        {shift.perDiemPreapproved && badge('Per diem', 'diem')}
      </div>

      {shift.jobTypes.length > 0 && (
        <div className="tech-meta" style={{ marginTop: 8 }}>{shift.jobTypes.join(' · ')}</div>
      )}

      {shift.files.length > 0 && (
        <div className="tech-meta" style={{ marginTop: 6 }}>
          📎 {shift.files.length} traffic plan file{shift.files.length > 1 ? 's' : ''} attached
        </div>
      )}

      <button className="tech-btn block" style={{ marginTop: 10 }} onClick={accept} disabled={busy}>
        {busy ? 'Acknowledging…' : 'Accept shift'}
      </button>
    </div>
  )
}
