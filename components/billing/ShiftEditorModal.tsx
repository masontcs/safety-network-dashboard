'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Combobox from '@/components/billing/Combobox'
import TechMultiSelect from '@/components/billing/TechMultiSelect'
import { JOB_TYPES, MEAL_TYPES } from '@/lib/billing/shiftConstants'

/**
 * Stage or publish a SHIFT — the dispatch unit. A staged shift is a draft (no ticket, no
 * tech notification); publishing generates the ticket + crew (job shift) or yard shifts, and
 * notifies techs to acknowledge. Existing-ticket assignment stays an immediate action.
 *
 *   Existing ticket → add tech(s) now (no staging).
 *   Job / New job   → stage or publish a job shift (publish makes the DTC ticket).
 *   Yard            → stage or publish a yard shift (no ticket).
 */

interface TechOpt { id: string; name: string }
interface TicketOpt { id: string; ticketNumber: string; jobNumber: string; jobName: string | null; customer: string | null; voided?: boolean }
interface ProfileOpt { id: string; name: string; code: string; branch: { name: string } | null; customer: { name: string } | null; billableEntityIds: string[] }
interface EntityOpt { entityId: string; code: string; name: string }
interface JobOpt { id: string; jobNumber: string; name: string | null; customer: string | null }
interface ActivityOpt { id: string; name: string }
interface CrewMember { technicianId: string; isLead: boolean }
interface TimelineRow { atTime: string; activityTypeId: string }

type Mode = 'ticket' | 'job' | 'newjob' | 'yard'

export default function ShiftEditorModal({
  date, technicianId, technicians, branchId, editShiftId = null, ticketsForDay, pickDate = false, onClose, onDone,
}: {
  date: string
  technicianId: string | null
  technicians: TechOpt[]
  branchId: string | null
  editShiftId?: string | null
  ticketsForDay: TicketOpt[]
  /** General-purpose dispatch: let the user choose the date here, and load that day's tickets. */
  pickDate?: boolean
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const editing = !!editShiftId
  // In general (pickDate) mode the date is chosen inside the modal; otherwise it's fixed by the cell.
  const [dateState, setDateState] = useState(date)
  const [dayTickets, setDayTickets] = useState<TicketOpt[]>(ticketsForDay)
  const [mode, setMode] = useState<Mode>(!pickDate && ticketsForDay.length > 0 ? 'ticket' : 'job')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(!editing)

  const [crew, setCrew] = useState<CrewMember[]>(technicianId ? [{ technicianId, isLead: true }] : [])
  const [ticketId, setTicketId] = useState('')
  const [jobId, setJobId] = useState('')

  // rich shift fields
  const [jobTypes, setJobTypes] = useState<string[]>([])
  const [timeline, setTimeline] = useState<TimelineRow[]>([])
  const [mealType, setMealType] = useState<'standard' | 'odmp'>('standard')
  const [perDiem, setPerDiem] = useState(false)
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<{ id: string; filename: string | null; url: string | null }[]>([])
  const [uploading, setUploading] = useState(false)

  // reference data
  const [jobs, setJobs] = useState<JobOpt[]>([])
  const [profiles, setProfiles] = useState<ProfileOpt[]>([])
  const [entities, setEntities] = useState<EntityOpt[]>([])
  const [activities, setActivities] = useState<ActivityOpt[]>([])

  // new-job fields
  const [profileId, setProfileId] = useState('')
  const [entityId, setEntityId] = useState('')
  const [jobName, setJobName] = useState('')
  const [certified, setCertified] = useState<boolean | null>(null)
  const [dir, setDir] = useState(''); const [contract, setContract] = useState(''); const [payClass, setPayClass] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [address, setAddress] = useState(''); const [city, setCity] = useState('')

  useEffect(() => {
    const j = (r: Response) => r.json()
    fetch('/api/billing/jobs').then(j).then((r) => { if (r.success) setJobs(r.data) }).catch(() => {})
    fetch('/api/billing/activity-types').then(j).then((r) => { if (r.success) setActivities(r.data) }).catch(() => {})
    Promise.all([fetch('/api/billing/profiles').then(j), fetch('/api/billing/entities').then(j)])
      .then(([p, e]) => { if (p.success) setProfiles(p.data); if (e.success) setEntities(e.data) }).catch(() => {})
  }, [])

  // General dispatch: load the chosen day's open tickets (the parent didn't pre-pass them).
  useEffect(() => {
    if (!pickDate) return
    const bq = branchId ? `&branchId=${branchId}` : ''
    fetch(`/api/billing/dispatch?week=${dateState}${bq}`).then((r) => r.json())
      .then((j) => {
        if (!j.success) return
        const day = (j.data.tickets as { id: string; ticketNumber: string; date: string; jobNumber: string; jobName: string | null; customer: string | null; voided?: boolean }[])
          .filter((t) => t.date === dateState)
          .map((t) => ({ id: t.id, ticketNumber: t.ticketNumber, jobNumber: t.jobNumber, jobName: t.jobName, customer: t.customer, voided: t.voided }))
        setDayTickets(day)
      }).catch(() => {})
  }, [pickDate, dateState, branchId])

  // Editing a staged shift — prefill everything.
  useEffect(() => {
    if (!editShiftId) return
    fetch(`/api/billing/shifts/${editShiftId}`).then((r) => r.json()).then((r) => {
      if (!r.success) { setErr(r.error); return }
      const s = r.data
      setMode(s.isYard ? 'yard' : 'job')
      setJobId(s.jobId ?? '')
      setJobTypes(s.jobTypes ?? [])
      setTimeline(s.timeline ?? [])
      setMealType(s.mealType ?? 'standard')
      setPerDiem(!!s.perDiemPreapproved)
      setNotes(s.notes ?? '')
      setCrew((s.crew ?? []).map((c: { technicianId: string; isLead: boolean }) => ({ technicianId: c.technicianId, isLead: c.isLead })))
      setLoaded(true)
    }).catch(() => { setErr('Could not load the shift.'); setLoaded(true) })
  }, [editShiftId])

  // Traffic-plan files (only for an existing shift — they attach to a shift id).
  useEffect(() => {
    if (!editShiftId) return
    fetch(`/api/billing/shifts/${editShiftId}/files`).then((r) => r.json()).then((j) => { if (j.success) setFiles(j.data) }).catch(() => {})
  }, [editShiftId])

  async function uploadFile(file: File) {
    if (!editShiftId || uploading) return
    setUploading(true); setErr(null)
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch(`/api/billing/shifts/${editShiftId}/files`, { method: 'POST', body: fd }).then((res) => res.json()).catch(() => ({ success: false }))
    setUploading(false)
    if (!r.success) { setErr(r.error ?? 'Upload failed'); return }
    const j = await fetch(`/api/billing/shifts/${editShiftId}/files`).then((res) => res.json()).catch(() => ({ success: false }))
    if (j.success) setFiles(j.data)
  }
  async function removeFile(id: string) {
    if (!editShiftId) return
    setFiles((f) => f.filter((x) => x.id !== id))
    await fetch(`/api/billing/shifts/${editShiftId}/files?fileId=${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const selProfile = useMemo(() => profiles.find((p) => p.id === profileId) ?? null, [profiles, profileId])
  const entityChoices = useMemo(() => entities.filter((e) => selProfile?.billableEntityIds.includes(e.entityId)), [entities, selProfile])

  function toggleTech(id: string) {
    setCrew((cur) => {
      const has = cur.find((c) => c.technicianId === id)
      if (has) {
        const next = cur.filter((c) => c.technicianId !== id)
        if (has.isLead && next.length && !next.some((c) => c.isLead)) next[0].isLead = true // keep a lead
        return next
      }
      return [...cur, { technicianId: id, isLead: cur.length === 0 }]
    })
  }
  function setLead(id: string) { setCrew((cur) => cur.map((c) => ({ ...c, isLead: c.technicianId === id }))) }
  function toggleJobType(t: string) { setJobTypes((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]) }
  function addTimelineRow() { setTimeline((cur) => [...cur, { atTime: '', activityTypeId: activities[0]?.id ?? '' }]) }
  function setTimelineRow(i: number, patch: Partial<TimelineRow>) { setTimeline((cur) => cur.map((r, ix) => ix === i ? { ...r, ...patch } : r)) }
  function removeTimelineRow(i: number) { setTimeline((cur) => cur.filter((_, ix) => ix !== i)) }

  async function post(url: string, b: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    return res.json()
  }
  async function patch(url: string, b: unknown) {
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    return res.json()
  }

  // Create the job first for new-job mode; returns its id or null (with err set).
  async function ensureJobId(): Promise<string | null> {
    if (mode === 'job') return jobId || (setErr('Pick a job.'), null)
    if (!profileId || !entityId) { setErr('Pick a billing profile and entity.'); return null }
    if (certified === null) { setErr('Answer whether this is a certified job.'); return null }
    if (certified && (!dir.trim() || !contract.trim() || !payClass.trim())) { setErr('Certified jobs need DIR #, contract #, and pay classification.'); return null }
    const jr = await post('/api/billing/jobs', {
      profileId, entityId, name: jobName.trim() || null, certified,
      dirNumber: certified ? dir.trim() : undefined, contractNumber: certified ? contract.trim() : undefined, payClassification: certified ? payClass.trim() : undefined,
      poNumber: poNumber.trim() || null, address: address.trim() || null, city: city.trim() || null,
    })
    if (!jr.success) { setErr(jr.error ?? 'Failed to create job'); return null }
    return (jr.data as { id: string }).id
  }

  // Create or update the shift; returns its id.
  async function saveShift(): Promise<string | null> {
    const payload = {
      shiftDate: dateState, mealType, perDiemPreapproved: perDiem, notes: notes.trim() || null,
      jobTypes, timeline: timeline.filter((t) => t.atTime && t.activityTypeId), crew,
    }
    if (editShiftId) {
      const r = await patch(`/api/billing/shifts/${editShiftId}`, payload)
      if (!r.success) { setErr(r.error ?? 'Failed to save'); return null }
      return editShiftId
    }
    let resolvedJobId: string | null = null
    if (mode === 'job' || mode === 'newjob') {
      resolvedJobId = await ensureJobId()
      if (!resolvedJobId) return null
    }
    const r = await post('/api/billing/shifts', { ...payload, jobId: resolvedJobId, branchId })
    if (!r.success) { setErr(r.error ?? 'Failed to stage shift'); return null }
    return (r.data as { id: string }).id
  }

  async function onStage() {
    if (busy) return
    if (crew.length === 0) { setErr('Pick at least one technician.'); return }
    setBusy(true); setErr(null)
    try {
      const id = await saveShift()
      if (id) onDone(editing ? 'Shift saved.' : 'Shift staged.')
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  async function onPublish() {
    if (busy) return
    if (crew.length === 0) { setErr('Pick at least one technician.'); return }
    setBusy(true); setErr(null)
    try {
      const id = await saveShift()
      if (!id) return
      const r = await post(`/api/billing/shifts/${id}/publish`, {})
      if (!r.success) return setErr(r.error ?? 'Failed to publish')
      onDone(r.data?.ticketNumber ? `Published — ticket ${r.data.ticketNumber} created.` : 'Shift published.')
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  async function onAssignExisting(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (crew.length === 0) { setErr('Pick at least one technician.'); return }
    if (!ticketId) { setErr('Pick a ticket.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await post('/api/billing/dispatch/assign', { mode: 'ticket', ticketId, technicianIds: crew.map((c) => c.technicianId), date: dateState })
      if (!r.success) return setErr(r.error ?? 'Failed')
      onDone('Dispatched to ticket.')
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  const openTickets = dayTickets.filter((t) => !t.voided)
  if (typeof document === 'undefined') return null
  const host = document.querySelector('.billing-root') ?? document.body
  const tab = (m: Mode, label: string) => (
    <button type="button" className={`bx-btn ${mode === m ? 'accent' : 'ghost'} sm`} onClick={() => setMode(m)}>{label}</button>
  )
  const isShiftMode = mode === 'job' || mode === 'newjob' || mode === 'yard'
  const dateLabel = new Date(dateState + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })

  return createPortal((
    <div onMouseDown={onClose} style={overlay}>
      <div onMouseDown={(e) => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="bx-cardhead" style={{ marginBottom: 6 }}>
          <h3>{editing ? 'Edit staged shift' : 'Dispatch'} — {dateLabel}</h3>
          <button className="bx-iconbtn" onClick={onClose} title="Close" style={{ marginLeft: 'auto' }}>✕</button>
        </div>

        {!loaded ? <div className="bx-sub" style={{ padding: 12 }}>Loading…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {/* Date — only in general dispatch; cell-based dispatch fixes the date. */}
          {pickDate && (
            <div>
              <label className="bx-lbl">Date</label>
              <input type="date" className="bx-f" style={{ width: '100%' }} value={dateState} onChange={(e) => { if (e.target.value) setDateState(e.target.value) }} />
            </div>
          )}

          {/* Technicians + lead — searchable multi-select */}
          <div>
            <label className="bx-lbl">Technician(s){crew.length > 1 ? ' · ★ sets the lead' : ''}</label>
            <TechMultiSelect technicians={technicians} crew={crew} onToggle={toggleTech} onSetLead={setLead} />
          </div>

          {!editing && (
            <div>
              <label className="bx-lbl">Dispatch to</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tab('ticket', 'Existing ticket')}
                {tab('job', 'Job → shift')}
                {tab('newjob', 'New job → shift')}
                {tab('yard', 'Yard')}
              </div>
            </div>
          )}

          {mode === 'ticket' && !editing && (
            <form onSubmit={onAssignExisting} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="bx-lbl">Ticket ({dateState})</label>
                {openTickets.length === 0
                  ? <div className="bx-note amber">No tickets on this day — pick a job or create one instead.</div>
                  : <Combobox value={ticketId} onChange={setTicketId} placeholder="Pick a ticket…"
                      options={openTickets.map((t) => ({ value: t.id, label: `${t.customer ?? t.jobName ?? t.jobNumber} · ${t.ticketNumber}`, hint: t.jobNumber }))} />}
              </div>
              {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="bx-btn accent" type="submit" disabled={busy}>{busy ? 'Working…' : 'Dispatch'}</button>
                <button className="bx-btn ghost" type="button" onClick={onClose}>Cancel</button>
              </div>
            </form>
          )}

          {mode === 'job' && !editing && (
            <div>
              <label className="bx-lbl">Job</label>
              <Combobox value={jobId} onChange={setJobId} placeholder="Pick a job…"
                options={jobs.map((jj) => ({ value: jj.id, label: `${jj.jobNumber}${jj.name ? ` — ${jj.name}` : ''}${jj.customer ? ` · ${jj.customer}` : ''}` }))} />
            </div>
          )}

          {mode === 'newjob' && !editing && (<>
            <div>
              <label className="bx-lbl">Billing profile</label>
              <Combobox value={profileId} onChange={(v) => { setProfileId(v); setEntityId('') }} placeholder="Pick a profile…"
                options={profiles.map((p) => ({ value: p.id, label: `${p.customer?.name ?? '—'} — ${p.name}${p.branch ? ` (${p.branch.name})` : ''}` }))} />
            </div>
            {profileId && (entityChoices.length === 0
              ? <div className="bx-note amber">This profile has no billable entities — configure a price list on it first.</div>
              : <div><label className="bx-lbl">Entity</label>
                  <select className="bx-f bx-select" value={entityId} onChange={(e) => setEntityId(e.target.value)} style={{ width: '100%' }}>
                    <option value="">Select…</option>{entityChoices.map((en) => <option key={en.entityId} value={en.entityId}>{en.code} — {en.name}</option>)}
                  </select></div>)}
            <div><label className="bx-lbl">Job name (optional)</label><input className="bx-f" style={{ width: '100%' }} value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="Northside Tower" /></div>
            <div>
              <label className="bx-lbl">Certified job?</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={`bx-btn ${certified === false ? 'accent' : 'ghost'} sm`} onClick={() => setCertified(false)}>No</button>
                <button type="button" className={`bx-btn ${certified === true ? 'accent' : 'ghost'} sm`} onClick={() => setCertified(true)}>Yes</button>
              </div>
            </div>
            {certified && (<>
              <div><label className="bx-lbl">DIR number</label><input className="bx-f" style={{ width: '100%' }} value={dir} onChange={(e) => setDir(e.target.value)} /></div>
              <div><label className="bx-lbl">Contract number</label><input className="bx-f" style={{ width: '100%' }} value={contract} onChange={(e) => setContract(e.target.value)} /></div>
              <div><label className="bx-lbl">Pay classification</label><input className="bx-f" style={{ width: '100%' }} value={payClass} onChange={(e) => setPayClass(e.target.value)} /></div>
            </>)}
            <div><label className="bx-lbl">PO # (optional)</label><input className="bx-f" style={{ width: '100%' }} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}><label className="bx-lbl">Address (optional)</label><input className="bx-f" style={{ width: '100%' }} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
              <div style={{ flex: 1 }}><label className="bx-lbl">City</label><input className="bx-f" style={{ width: '100%' }} value={city} onChange={(e) => setCity(e.target.value)} /></div>
            </div>
          </>)}

          {mode === 'yard' && (
            <div className="bx-sub">Yard shift — no ticket (unless prepping for a job). Publishing logs the crew to the yard for the day; yard time is payroll-only.</div>
          )}

          {/* Rich shift fields — for any shift (not the immediate existing-ticket assign) */}
          {isShiftMode && (<>
            <div>
              <label className="bx-lbl">Job type(s)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {JOB_TYPES.map((t) => (
                  <button key={t} type="button" className={`bx-btn ${jobTypes.includes(t) ? 'accent' : 'ghost'} sm`} onClick={() => toggleJobType(t)}>{t}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="bx-lbl">Timeline (plan — time + activity)</label>
              {timeline.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <input type="time" className="bx-f" value={row.atTime} onChange={(e) => setTimelineRow(i, { atTime: e.target.value })} style={{ width: 120 }} />
                  <select className="bx-f bx-select" value={row.activityTypeId} onChange={(e) => setTimelineRow(i, { activityTypeId: e.target.value })} style={{ flex: 1 }}>
                    {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button type="button" className="bx-iconbtn" title="Remove" onClick={() => removeTimelineRow(i)}>✕</button>
                </div>
              ))}
              <button type="button" className="bx-btn ghost sm" onClick={addTimelineRow}>+ Add timeline row</button>
            </div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <label className="bx-lbl">Meal type</label>
                <select className="bx-f bx-select" value={mealType} onChange={(e) => setMealType(e.target.value as 'standard' | 'odmp')}>
                  {MEAL_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="bx-lbl">Per diem</label>
                <button type="button" className={`bx-btn ${perDiem ? 'accent' : 'ghost'} sm`} onClick={() => setPerDiem((v) => !v)} style={{ display: 'block' }}>
                  {perDiem ? 'Pre-approved' : 'Off'}
                </button>
              </div>
            </div>

            <div><label className="bx-lbl">Notes (optional)</label><textarea className="bx-f" style={{ width: '100%', minHeight: 54 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

            <div>
              <label className="bx-lbl">Traffic plan{editShiftId ? '' : ' (stage first, then re-open to attach)'}</label>
              {editShiftId ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {files.map((f) => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {f.url ? <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>📎 {f.filename ?? 'View'}</a> : <span style={{ fontSize: 13 }}>📎 {f.filename ?? 'File'}</span>}
                      <button type="button" className="bx-iconbtn" title="Remove" onClick={() => removeFile(f.id)} style={{ marginLeft: 'auto' }}>✕</button>
                    </div>
                  ))}
                  <label className="bx-btn ghost sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
                    {uploading ? 'Uploading…' : '+ Add file (PDF or image)'}
                    <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} disabled={uploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
                  </label>
                </div>
              ) : <div className="bx-sub">Stage the shift, then re-open it from the board to attach traffic plans.</div>}
            </div>

            {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <button className="bx-btn accent" type="button" disabled={busy} onClick={onPublish}>{busy ? 'Working…' : 'Publish'}</button>
              <button className="bx-btn ghost" type="button" disabled={busy} onClick={onStage}>{editing ? 'Save draft' : 'Stage (draft)'}</button>
              <button className="bx-btn ghost" type="button" onClick={onClose}>Cancel</button>
            </div>
          </>)}
        </div>
        )}
      </div>
    </div>
  ), host)
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.34)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px 16px',
}
