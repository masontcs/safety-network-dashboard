'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Combobox from '@/components/billing/Combobox'

/**
 * Quick-create from the topbar "+ New". Each mode asks only for the context it needs
 * (the parent), then creates the record and jumps to it — no generic landing pages.
 * customer: name+code · profile: pick customer · job: pick profile · ticket: pick job ·
 * proof/invoice: pick job, then open that job's invoice generator.
 */

export type QuickMode = 'customer' | 'profile' | 'job' | 'ticket' | 'proof' | 'invoice'

const TITLES: Record<QuickMode, string> = {
  customer: 'New customer', profile: 'New billing profile', job: 'New job',
  ticket: 'New ticket', proof: 'New proof', invoice: 'New invoice',
}

interface ProfileOpt { id: string; name: string; code: string; branch: { name: string } | null; customer: { name: string } | null; billableEntityIds: string[] }
interface EntityOpt { entityId: string; code: string; name: string }
interface JobOpt { id: string; jobNumber: string; name: string | null; customer: string | null }

export default function QuickCreateModal({ mode, onClose }: { mode: QuickMode; onClose: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // reference data, loaded per mode
  const [customers, setCustomers] = useState<{ id: string; name: string; code: string }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [terms, setTerms] = useState<{ id: string; name: string }[]>([])
  const [profiles, setProfiles] = useState<ProfileOpt[]>([])
  const [entities, setEntities] = useState<EntityOpt[]>([])
  const [jobs, setJobs] = useState<JobOpt[]>([])

  // fields
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [termId, setTermId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [entityId, setEntityId] = useState('')
  const [certified, setCertified] = useState<boolean | null>(null)
  const [dir, setDir] = useState(''); const [contract, setContract] = useState(''); const [payClass, setPayClass] = useState('')
  const [jobId, setJobId] = useState('')
  const [feature, setFeature] = useState<'add' | 'return' | 'dtc'>('add')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    const j = (r: Response) => r.json()
    if (mode === 'profile') {
      Promise.all([fetch('/api/billing/customers').then(j), fetch('/api/billing/reference').then(j)]).then(([c, ref]) => {
        if (c.success) setCustomers(c.data); if (ref.success) { setBranches(ref.data.branches); setTerms(ref.data.paymentTerms) }
      }).catch(() => {})
    } else if (mode === 'job') {
      Promise.all([fetch('/api/billing/profiles').then(j), fetch('/api/billing/entities').then(j)]).then(([p, e]) => {
        if (p.success) setProfiles(p.data); if (e.success) setEntities(e.data)
      }).catch(() => {})
    } else if (mode === 'ticket' || mode === 'proof' || mode === 'invoice') {
      fetch('/api/billing/jobs').then(j).then((js) => { if (js.success) setJobs(js.data) }).catch(() => {})
    }
  }, [mode])

  const selProfile = useMemo(() => profiles.find((p) => p.id === profileId) ?? null, [profiles, profileId])
  const entityChoices = useMemo(() => entities.filter((e) => selProfile?.billableEntityIds.includes(e.entityId)), [entities, selProfile])

  async function post(url: string, body: unknown): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return res.json()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      if (mode === 'customer') {
        const r = await post('/api/billing/customers', { name: name.trim(), code: code.trim() })
        if (!r.success) return setErr(r.error ?? 'Failed')
        router.push(`/billing/customers/${(r.data as { id: string }).id}`)
      } else if (mode === 'profile') {
        const r = await post('/api/billing/profiles', { customerId, name: name.trim(), code: code.trim(), branchId, paymentTermId: termId || null })
        if (!r.success) return setErr(r.error ?? 'Failed')
        router.push(`/billing/profiles/${(r.data as { id: string }).id}`)
      } else if (mode === 'job') {
        const r = await post('/api/billing/jobs', {
          profileId, entityId, name: name.trim() || null, certified,
          dirNumber: certified ? dir.trim() : undefined, contractNumber: certified ? contract.trim() : undefined, payClassification: certified ? payClass.trim() : undefined,
        })
        if (!r.success) return setErr(r.error ?? 'Failed')
        router.push(`/billing/jobs/${(r.data as { id: string }).id}`)
      } else if (mode === 'ticket') {
        const r = await post('/api/billing/tickets', { jobId, ticketDate: date, featureAdd: feature === 'add', featureReturn: feature === 'return', featureDtc: feature === 'dtc' })
        if (!r.success) return setErr(r.error ?? 'Failed')
        router.push(`/billing/tickets/${(r.data as { id: string }).id}`)
      } else { // proof | invoice → open the job's invoice generator
        router.push(`/billing/jobs/${jobId}?tab=invoices&generate=1`)
      }
      onClose()
    } catch {
      setErr('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  // Is the form ready to submit?
  const ready = (() => {
    if (mode === 'customer') return !!name.trim() && !!code.trim()
    if (mode === 'profile') return !!customerId && !!name.trim() && !!code.trim() && !!branchId
    if (mode === 'job') return !!profileId && !!entityId && certified !== null && (!certified || (!!dir.trim() && !!contract.trim() && !!payClass.trim()))
    if (mode === 'ticket') return !!jobId && !!date
    return !!jobId // proof/invoice
  })()

  const jobOptions = jobs.map((jj) => ({ value: jj.id, label: `${jj.jobNumber}${jj.name ? ` — ${jj.name}` : ''}${jj.customer ? ` · ${jj.customer}` : ''}` }))

  if (typeof document === 'undefined') return null

  // Portal OUT of the topbar (its backdrop-filter creates a containing block that clips
  // position:fixed children to a strip) but INTO .billing-root — that element hosts every
  // theme CSS var (--accent, --surface, --ink…) and the light/dark switch. Portaling to
  // <body> drops those vars, so .bx-btn.accent rendered white-on-transparent = invisible.
  // .billing-root has no transform/filter/contain, so a fixed overlay inside it still fills
  // the viewport (and isn't clipped by its overflow:hidden).
  const host = document.querySelector('.billing-root') ?? document.body
  return createPortal((
    <div onMouseDown={onClose} style={overlay}>
      <div onMouseDown={(e) => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 460, maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="bx-cardhead" style={{ marginBottom: 6 }}><h3>{TITLES[mode]}</h3>
          <button className="bx-iconbtn" onClick={onClose} title="Close" style={{ marginLeft: 'auto' }}>✕</button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {mode === 'customer' && (<>
            <Field label="Name"><input className="bx-f" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Wiring Connections" style={{ width: '100%' }} /></Field>
            <Field label="Code (internal)"><input className="bx-f" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WIRCON" style={{ width: '100%' }} /></Field>
          </>)}

          {mode === 'profile' && (<>
            <Field label="Customer"><Combobox value={customerId} onChange={setCustomerId} placeholder="Pick a customer…" options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} /></Field>
            <Field label="Profile name"><input className="bx-f" value={name} onChange={(e) => setName(e.target.value)} placeholder="Direct Bakersfield" style={{ width: '100%' }} /></Field>
            <Field label="Code"><input className="bx-f" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DIRECTBK" style={{ width: '100%' }} /></Field>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Branch" grow><select className="bx-f bx-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ width: '100%' }}><option value="">Select…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="Terms" grow><select className="bx-f bx-select" value={termId} onChange={(e) => setTermId(e.target.value)} style={{ width: '100%' }}><option value="">Customer default</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            </div>
          </>)}

          {mode === 'job' && (<>
            <Field label="Billing profile"><Combobox value={profileId} onChange={(v) => { setProfileId(v); setEntityId('') }} placeholder="Pick a profile…" options={profiles.map((p) => ({ value: p.id, label: `${p.customer?.name ?? '—'} — ${p.name}${p.branch ? ` (${p.branch.name})` : ''}` }))} /></Field>
            {profileId && (entityChoices.length === 0
              ? <div className="bx-note amber">This profile has no billable entities yet — configure a price list on it first.</div>
              : <Field label="Entity"><select className="bx-f bx-select" value={entityId} onChange={(e) => setEntityId(e.target.value)} style={{ width: '100%' }}><option value="">Select…</option>{entityChoices.map((en) => <option key={en.entityId} value={en.entityId}>{en.code} — {en.name}</option>)}</select></Field>)}
            <Field label="Job name (optional)"><input className="bx-f" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northside Tower" style={{ width: '100%' }} /></Field>
            <Field label="Certified / prevailing wage?">
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={`bx-btn ${certified === false ? 'accent' : 'ghost'} sm`} onClick={() => setCertified(false)}>No</button>
                <button type="button" className={`bx-btn ${certified === true ? 'accent' : 'ghost'} sm`} onClick={() => setCertified(true)}>Yes</button>
              </div>
            </Field>
            {certified && (<>
              <Field label="DIR number"><input className="bx-f" value={dir} onChange={(e) => setDir(e.target.value)} style={{ width: '100%' }} /></Field>
              <Field label="Contract number"><input className="bx-f" value={contract} onChange={(e) => setContract(e.target.value)} style={{ width: '100%' }} /></Field>
              <Field label="Pay classification"><input className="bx-f" value={payClass} onChange={(e) => setPayClass(e.target.value)} style={{ width: '100%' }} /></Field>
            </>)}
          </>)}

          {mode === 'ticket' && (<>
            <Field label="Job"><Combobox value={jobId} onChange={setJobId} placeholder="Pick a job…" options={jobOptions} /></Field>
            <Field label="Feature">
              <div style={{ display: 'flex', gap: 8 }}>
                {(['add', 'return', 'dtc'] as const).map((f) => (
                  <button key={f} type="button" className={`bx-btn ${feature === f ? 'accent' : 'ghost'} sm`} onClick={() => setFeature(f)} style={{ textTransform: 'capitalize' }}>{f === 'dtc' ? 'DTC' : f}</button>
                ))}
              </div>
            </Field>
            <Field label="Ticket date"><input className="bx-f" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%' }} /></Field>
          </>)}

          {(mode === 'proof' || mode === 'invoice') && (
            <Field label="Job"><Combobox value={jobId} onChange={setJobId} placeholder="Pick a job to bill…" options={jobOptions} /></Field>
          )}

          {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="bx-btn accent" type="submit" disabled={busy || !ready}>
              {busy ? 'Working…' : mode === 'proof' || mode === 'invoice' ? 'Continue →' : 'Create'}
            </button>
            <button className="bx-btn ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  ), host)
}

function Field({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return <div style={{ flex: grow ? 1 : undefined }}><label className="bx-lbl">{label}</label>{children}</div>
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.34)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 16px 16px',
}
