'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Skeleton from '@/components/ui/Skeleton'
import JobTicketsSection from '@/components/billing/JobTicketsSection'

interface Job {
  id: string
  jobNumber: string
  name: string | null
  status: string
  certified: boolean
  dirNumber: string | null
  certPayrollContact: string | null
  contractNumber: string | null
  payClassification: string | null
  entityCode: string
  branch: string
  poNumber: string | null
  address: string | null
  crossStreets: string | null
  city: string | null
  county: string | null
  state: string | null
  zip: string | null
  taxExempt: boolean
  requireSignature: boolean
  enableSecondSignature: boolean
  ticketLaborMinimumMinutes: number | null
  notes: string | null
  dateOpened: string
  dateCompleted: string | null
  profile: { id: string; name: string; code: string } | null
  customer: string | null
  statuses: string[]
  isAdmin: boolean
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
}

export default function JobDetailClient({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  // editable fields
  const [name, setName] = useState('')
  const [status, setStatus] = useState('new')
  const [po, setPo] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [stateF, setStateF] = useState('')
  const [zip, setZip] = useState('')
  const [notes, setNotes] = useState('')
  const [reqSig, setReqSig] = useState(false)
  const [secondSig, setSecondSig] = useState(false)
  const [taxExempt, setTaxExempt] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/billing/jobs/${jobId}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        const j = json.data as Job
        setJob(j)
        setName(j.name ?? ''); setStatus(j.status); setPo(j.poNumber ?? '')
        setAddress(j.address ?? ''); setCity(j.city ?? ''); setStateF(j.state ?? ''); setZip(j.zip ?? '')
        setNotes(j.notes ?? ''); setReqSig(j.requireSignature); setSecondSig(j.enableSecondSignature); setTaxExempt(j.taxExempt)
        setFetchError(null)
      })
      .catch((e: Error) => setFetchError(e.message))
      .finally(() => setLoading(false))
  }, [jobId])

  useEffect(() => { load() }, [load])

  async function save() {
    if (saving || !job) return
    setSaving(true); setSaveError(null); setSaveOk(false)
    try {
      const res = await fetch(`/api/billing/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, status, poNumber: po, address, city, state: stateF, zip, notes,
          requireSignature: reqSig, enableSecondSignature: secondSig, taxExempt,
        }),
      })
      const json = await res.json()
      if (!json.success) { setSaveError(json.error); return }
      setSaveOk(true); setTimeout(() => setSaveOk(false), 3000); load()
    } catch { setSaveError('Network error — please try again.') }
    finally { setSaving(false) }
  }

  if (fetchError) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
  if (loading || !job) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><Skeleton height={40} /><Skeleton height={260} /></div>

  const isAdmin = job.isAdmin

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900 }}>
      <div>
        <Link href="/billing/jobs" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← Jobs</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{job.jobNumber}</span>
          {job.certified && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--pill-pending-fg)', background: 'var(--pill-pending-bg)', padding: '2px 8px', borderRadius: 999 }}>CERTIFIED</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          {job.name ?? '—'} · {job.customer ?? '—'} · {job.profile?.name ?? '—'} · {job.entityCode} · {job.branch}
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 16 }}>Details</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <div><label style={labelStyle}>Job name</label><input value={name} onChange={(e) => { setName(e.target.value); setSaveOk(false) }} disabled={!isAdmin} style={inputStyle} /></div>
          <div>
            <label style={labelStyle}>Status</label>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setSaveOk(false) }} disabled={!isAdmin} style={inputStyle}>
              {job.statuses.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>PO number</label><input value={po} onChange={(e) => { setPo(e.target.value); setSaveOk(false) }} disabled={!isAdmin} style={inputStyle} /></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 14 }}>
          <div><label style={labelStyle}>Address</label><input value={address} onChange={(e) => { setAddress(e.target.value); setSaveOk(false) }} disabled={!isAdmin} style={inputStyle} /></div>
          <div><label style={labelStyle}>City</label><input value={city} onChange={(e) => { setCity(e.target.value); setSaveOk(false) }} disabled={!isAdmin} style={inputStyle} /></div>
          <div><label style={labelStyle}>State</label><input value={stateF} onChange={(e) => { setStateF(e.target.value); setSaveOk(false) }} disabled={!isAdmin} style={inputStyle} /></div>
          <div><label style={labelStyle}>Zip</label><input value={zip} onChange={(e) => { setZip(e.target.value); setSaveOk(false) }} disabled={!isAdmin} style={inputStyle} /></div>
        </div>

        {job.certified && (
          <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--bg-nav)', borderRadius: 8, border: '1px solid var(--border-subtle, var(--border-emphasis))', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Certified details</div>
            DIR #: {job.dirNumber ?? '—'} · Contract #: {job.contractNumber ?? '—'} · Class: {job.payClassification ?? '—'}
            {job.certPayrollContact ? ` · Contact: ${job.certPayrollContact}` : ''}
          </div>
        )}

        <div style={{ display: 'flex', gap: 20, marginTop: 16, fontSize: 12.5, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: isAdmin ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={reqSig} disabled={!isAdmin} onChange={(e) => { setReqSig(e.target.checked); setSaveOk(false) }} /> Require signature
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: isAdmin ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={secondSig} disabled={!isAdmin} onChange={(e) => { setSecondSig(e.target.checked); setSaveOk(false) }} /> Second signature
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: isAdmin ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={taxExempt} disabled={!isAdmin} onChange={(e) => { setTaxExempt(e.target.checked); setSaveOk(false) }} /> Tax exempt
          </label>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Notes</label>
          <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setSaveOk(false) }} disabled={!isAdmin}
            rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        {saveError && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6, marginTop: 14 }}>{saveError}</div>}
        {saveOk && <div style={{ fontSize: 12, color: 'var(--alert-success-fg)', padding: '8px 10px', background: 'var(--alert-success-bg)', borderRadius: 6, marginTop: 14 }}>Saved.</div>}

        {isAdmin && (
          <button onClick={save} disabled={saving} className="btn-primary" style={{ marginTop: 16, padding: '8px 20px', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      <JobTicketsSection jobId={jobId} isAdmin={isAdmin} />
    </div>
  )
}
