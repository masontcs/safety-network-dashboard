'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Combobox from '@/components/billing/Combobox'

/**
 * Dispatch a tech to a day. Cascading choices, all in one place:
 *   1. Assign to an EXISTING ticket that day.
 *   2. Pick an existing JOB → generate a DTC ticket → assign.
 *   3. Create a JOB inline (full form) → generate a DTC ticket → assign.
 * The dispatched tech(s) are added to the ticket crew (first = lead if it has none).
 * (Yard shifts — no ticket — are a separate flow, added later.)
 */

interface TechOpt { id: string; name: string }
interface TicketOpt { id: string; ticketNumber: string; jobNumber: string; jobName: string | null; customer: string | null; feature: string; voided?: boolean }
interface ProfileOpt { id: string; name: string; code: string; branch: { name: string } | null; customer: { name: string } | null; billableEntityIds: string[] }
interface EntityOpt { entityId: string; code: string; name: string }
interface JobOpt { id: string; jobNumber: string; name: string | null; customer: string | null }

type Mode = 'ticket' | 'job' | 'newjob'

export default function DispatchAssignModal({
  date, technicianId, technicians, ticketsForDay, onClose, onDone,
}: {
  date: string
  technicianId: string | null
  technicians: TechOpt[]
  ticketsForDay: TicketOpt[]
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [mode, setMode] = useState<Mode>(ticketsForDay.length > 0 ? 'ticket' : 'job')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Who's being dispatched — preselect the row's tech; more can be added.
  const [techIds, setTechIds] = useState<string[]>(technicianId ? [technicianId] : [])

  const [ticketId, setTicketId] = useState('')
  const [jobId, setJobId] = useState('')

  // reference data for job pick / creation
  const [jobs, setJobs] = useState<JobOpt[]>([])
  const [profiles, setProfiles] = useState<ProfileOpt[]>([])
  const [entities, setEntities] = useState<EntityOpt[]>([])

  // new-job fields (mirror the job form)
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
    Promise.all([fetch('/api/billing/profiles').then(j), fetch('/api/billing/entities').then(j)])
      .then(([p, e]) => { if (p.success) setProfiles(p.data); if (e.success) setEntities(e.data) }).catch(() => {})
  }, [])

  const selProfile = useMemo(() => profiles.find((p) => p.id === profileId) ?? null, [profiles, profileId])
  const entityChoices = useMemo(() => entities.filter((e) => selProfile?.billableEntityIds.includes(e.entityId)), [entities, selProfile])

  function toggleTech(id: string) {
    setTechIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  }

  async function post(url: string, b: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    return res.json()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (techIds.length === 0) { setErr('Pick at least one technician.'); return }
    setBusy(true); setErr(null)
    try {
      if (mode === 'ticket') {
        if (!ticketId) { setErr('Pick a ticket.'); return }
        const r = await post('/api/billing/dispatch/assign', { mode: 'ticket', ticketId, technicianIds: techIds, date })
        if (!r.success) return setErr(r.error ?? 'Failed')
        onDone('Dispatched to ticket.')
      } else if (mode === 'job') {
        if (!jobId) { setErr('Pick a job.'); return }
        const r = await post('/api/billing/dispatch/assign', { mode: 'job', jobId, technicianIds: techIds, date })
        if (!r.success) return setErr(r.error ?? 'Failed')
        onDone(`Ticket ${r.data?.ticketNumber ?? ''} generated & dispatched.`)
      } else {
        // new job → job POST, then generate ticket + assign
        if (!profileId || !entityId) { setErr('Pick a billing profile and entity.'); return }
        if (certified === null) { setErr('Answer whether this is a certified job.'); return }
        if (certified && (!dir.trim() || !contract.trim() || !payClass.trim())) { setErr('Certified jobs need DIR #, contract #, and pay classification.'); return }
        const jr = await post('/api/billing/jobs', {
          profileId, entityId, name: jobName.trim() || null, certified,
          dirNumber: certified ? dir.trim() : undefined, contractNumber: certified ? contract.trim() : undefined, payClassification: certified ? payClass.trim() : undefined,
          poNumber: poNumber.trim() || null, address: address.trim() || null, city: city.trim() || null,
        })
        if (!jr.success) return setErr(jr.error ?? 'Failed to create job')
        const r = await post('/api/billing/dispatch/assign', { mode: 'job', jobId: (jr.data as { id: string }).id, technicianIds: techIds, date })
        if (!r.success) return setErr(r.error ?? 'Job created, but dispatch failed')
        onDone(`Job ${(jr.data as { jobNumber?: string }).jobNumber ?? ''} + ticket created & dispatched.`)
      }
    } catch {
      setErr('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const openTickets = ticketsForDay.filter((t) => !t.voided)
  if (typeof document === 'undefined') return null
  const host = document.querySelector('.billing-root') ?? document.body

  const tab = (m: Mode, label: string) => (
    <button type="button" className={`bx-btn ${mode === m ? 'accent' : 'ghost'} sm`} onClick={() => setMode(m)}>{label}</button>
  )

  return createPortal((
    <div onMouseDown={onClose} style={overlay}>
      <div onMouseDown={(e) => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="bx-cardhead" style={{ marginBottom: 6 }}>
          <h3>Dispatch — {new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}</h3>
          <button className="bx-iconbtn" onClick={onClose} title="Close" style={{ marginLeft: 'auto' }}>✕</button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {/* Technicians */}
          <div>
            <label className="bx-lbl">Technician(s)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {technicians.map((t) => (
                <button key={t.id} type="button"
                  className={`bx-btn ${techIds.includes(t.id) ? 'accent' : 'ghost'} sm`}
                  onClick={() => toggleTech(t.id)}>{t.name}</button>
              ))}
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className="bx-lbl">Dispatch to</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {tab('ticket', 'Existing ticket')}
              {tab('job', 'Job → new ticket')}
              {tab('newjob', 'New job → ticket')}
            </div>
          </div>

          {mode === 'ticket' && (
            <div>
              <label className="bx-lbl">Ticket ({date})</label>
              {openTickets.length === 0
                ? <div className="bx-note amber">No tickets on this day — pick a job or create one instead.</div>
                : <Combobox value={ticketId} onChange={setTicketId} placeholder="Pick a ticket…"
                    options={openTickets.map((t) => ({ value: t.id, label: `${t.customer ?? t.jobName ?? t.jobNumber} · ${t.ticketNumber}`, hint: t.jobNumber }))} />}
            </div>
          )}

          {mode === 'job' && (
            <div>
              <label className="bx-lbl">Job (generates a DTC ticket for {date})</label>
              <Combobox value={jobId} onChange={setJobId} placeholder="Pick a job…"
                options={jobs.map((jj) => ({ value: jj.id, label: `${jj.jobNumber}${jj.name ? ` — ${jj.name}` : ''}${jj.customer ? ` · ${jj.customer}` : ''}` }))} />
            </div>
          )}

          {mode === 'newjob' && (<>
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
              <label className="bx-lbl">Certified / prevailing wage?</label>
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
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}><label className="bx-lbl">PO # (optional)</label><input className="bx-f" style={{ width: '100%' }} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}><label className="bx-lbl">Address (optional)</label><input className="bx-f" style={{ width: '100%' }} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
              <div style={{ flex: 1 }}><label className="bx-lbl">City</label><input className="bx-f" style={{ width: '100%' }} value={city} onChange={(e) => setCity(e.target.value)} /></div>
            </div>
          </>)}

          {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="bx-btn accent" type="submit" disabled={busy}>{busy ? 'Working…' : 'Dispatch'}</button>
            <button className="bx-btn ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  ), host)
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.34)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px 16px',
}
