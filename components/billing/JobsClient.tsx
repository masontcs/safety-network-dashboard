'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Skeleton from '@/components/ui/Skeleton'
import Combobox from '@/components/billing/Combobox'
import Select from '@/components/billing/Select'

/**
 * Jobs list + create. A job attaches to a billing profile (customer + branch
 * derived) and an entity the profile can bill under; its number is generated
 * per entity. "Certified?" must be answered up front.
 */

interface JobRow {
  id: string
  jobNumber: string
  name: string | null
  status: string
  certified: boolean
  entityCode: string
  branch: string
  customer: string | null
  profile: { id: string; name: string; code: string } | null
}
interface ProfileOpt {
  id: string
  name: string
  code: string
  branch: { id: string; name: string }
  customer: { name: string } | null
  billableEntityIds: string[]
}
interface EntityOpt { entityId: string; code: string; name: string }

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)',
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6,
  padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
}

function statusPill(s: string) {
  const map: Record<string, [string, string]> = {
    new: ['var(--pill-neutral-bg)', 'var(--pill-neutral-fg)'],
    in_progress: ['var(--pill-pending-bg)', 'var(--pill-pending-fg)'],
    on_hold: ['var(--pill-overdue-bg)', 'var(--pill-overdue-fg)'],
    completed: ['var(--pill-paid-bg)', 'var(--pill-paid-fg)'],
    closed: ['var(--pill-neutral-bg)', 'var(--pill-neutral-fg)'],
  }
  const [bg, fg] = map[s] ?? map.new
  return (
    <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 500, padding: '2px 9px', borderRadius: 999, textTransform: 'capitalize' }}>
      {s.replace('_', ' ')}
    </span>
  )
}

export default function JobsClient({ isAdmin }: { isAdmin: boolean }) {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [profiles, setProfiles] = useState<ProfileOpt[]>([])
  const [entities, setEntities] = useState<EntityOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const [showNew, setShowNew] = useState(false)
  const [pProfileId, setPProfileId] = useState('')
  const [pEntityId, setPEntityId] = useState('')
  const [pName, setPName] = useState('')
  const [pPo, setPPo] = useState('')
  // certified is intentionally a tri-state: null = unanswered (blocks create)
  const [pCertified, setPCertified] = useState<boolean | null>(null)
  const [pDir, setPDir] = useState('')
  const [pContract, setPContract] = useState('')
  const [pPayClass, setPPayClass] = useState('')
  const [pPayrollContact, setPPayrollContact] = useState('')
  const [pAddress, setPAddress] = useState('')
  const [pCity, setPCity] = useState('')
  const [pState, setPState] = useState('')
  const [pZip, setPZip] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/billing/jobs').then((r) => r.json()),
      fetch('/api/billing/profiles').then((r) => r.json()),
      fetch('/api/billing/entities').then((r) => r.json()),
    ])
      .then(([j, p, e]) => {
        if (!j.success) throw new Error(j.error)
        setJobs(j.data)
        if (p.success) setProfiles(p.data)
        if (e.success) setEntities(e.data)
        setFetchError(null)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter(
      (j) =>
        j.jobNumber.toLowerCase().includes(q) ||
        (j.name ?? '').toLowerCase().includes(q) ||
        (j.customer ?? '').toLowerCase().includes(q) ||
        (j.profile?.name ?? '').toLowerCase().includes(q)
    )
  }, [jobs, search])

  const selectedProfile = profiles.find((p) => p.id === pProfileId)
  // Only entities this profile can actually bill under.
  const entityChoices = entities.filter((e) => selectedProfile?.billableEntityIds.includes(e.entityId))

  function resetForm() {
    setPProfileId(''); setPEntityId(''); setPName(''); setPPo(''); setPCertified(null)
    setPDir(''); setPContract(''); setPPayClass(''); setPPayrollContact('')
    setPAddress(''); setPCity(''); setPState(''); setPZip('')
  }

  const canCreate =
    !!pProfileId && !!pEntityId && pCertified !== null &&
    (!pCertified || (pDir.trim() && pContract.trim() && pPayClass.trim())) && !busy

  async function createJob() {
    if (!canCreate) return
    setBusy(true); setActionError(null)
    try {
      const res = await fetch('/api/billing/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: pProfileId,
          entityId: pEntityId,
          name: pName || null,
          poNumber: pPo || null,
          certified: pCertified,
          dirNumber: pDir || null,
          contractNumber: pContract || null,
          payClassification: pPayClass || null,
          certPayrollContact: pPayrollContact || null,
          address: pAddress || null,
          city: pCity || null,
          state: pState || null,
          zip: pZip || null,
        }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      resetForm(); setShowNew(false); load()
    } catch { setActionError('Network error — please try again.') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Jobs</div>
        {isAdmin && (
          <button onClick={() => { setShowNew((v) => !v); setActionError(null) }} className="btn-primary" style={{ marginLeft: 'auto', padding: '8px 16px' }}>
            + New job
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -12 }}>
        A job attaches to a billing profile and an entity. Its number is generated per entity.
      </div>

      {actionError && (
        <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6 }}>{actionError}</div>
      )}

      {showNew && isAdmin && (
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16, color: 'var(--text-primary)' }}>New job</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Billing profile</label>
              <Combobox
                ariaLabel="Billing profile"
                value={pProfileId}
                onChange={(v) => { setPProfileId(v); setPEntityId('') }}
                options={profiles.map((p) => ({ value: p.id, label: `${p.customer?.name ?? '—'} — ${p.name} (${p.branch.name})` }))}
              />
            </div>
            <div>
              <label style={labelStyle}>Entity</label>
              <Select ariaLabel="Entity" value={pEntityId} onChange={setPEntityId} disabled={!selectedProfile}>
                <option value="">{selectedProfile ? 'Select…' : 'Pick a profile first'}</option>
                {entityChoices.map((e) => <option key={e.entityId} value={e.entityId}>{e.code}</option>)}
              </Select>
              {selectedProfile && entityChoices.length === 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6 }}>
                  This profile has no billable entities. Configure a price list on the profile first.
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Job name</label>
              <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Northside Tower" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>PO number</label>
              <input value={pPo} onChange={(e) => setPPo(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Certified — required tri-state gate */}
          <div style={{ marginTop: 18, padding: '12px 14px', background: 'var(--bg-nav)', borderRadius: 8, border: '1px solid var(--border-subtle, var(--border-emphasis))' }}>
            <label style={labelStyle}>Certified job? <span style={{ color: 'var(--danger)' }}>*</span></label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => setPCertified(false)} style={{ ...ghostBtn, ...(pCertified === false ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}>No</button>
              <button onClick={() => setPCertified(true)} style={{ ...ghostBtn, ...(pCertified === true ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}>Yes</button>
            </div>
            {pCertified === true && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 14 }}>
                <div><label style={labelStyle}>DIR #</label><input value={pDir} onChange={(e) => setPDir(e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Contract #</label><input value={pContract} onChange={(e) => setPContract(e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Pay classification</label><input value={pPayClass} onChange={(e) => setPPayClass(e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Certified payroll contact</label><input value={pPayrollContact} onChange={(e) => setPPayrollContact(e.target.value)} style={inputStyle} /></div>
              </div>
            )}
          </div>

          {/* Location */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 16 }}>
            <div><label style={labelStyle}>Address</label><input value={pAddress} onChange={(e) => setPAddress(e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>City</label><input value={pCity} onChange={(e) => setPCity(e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>State</label><input value={pState} onChange={(e) => setPState(e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>Zip</label><input value={pZip} onChange={(e) => setPZip(e.target.value)} style={inputStyle} /></div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={createJob} disabled={!canCreate} className="btn-primary" style={{ padding: '8px 18px', opacity: canCreate ? 1 : 0.5 }}>Create job</button>
            <button onClick={() => { setShowNew(false); resetForm() }} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search jobs…" style={{ ...inputStyle, maxWidth: 300 }} />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{filtered.length} of {jobs.length}</span>
        </div>

        {fetchError ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={42} />)}</div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 2px' }}>
            {jobs.length === 0 ? 'No jobs yet.' : 'No jobs match that search.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['Job #', 'Name', 'Customer', 'Profile', 'Entity', 'Status'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((j) => (
                  <tr key={j.id}>
                    <td style={tdStyle}>
                      <Link href={`/billing/jobs/${j.id}`} style={{ color: 'var(--accent)', fontWeight: 500, textDecoration: 'none', fontVariantNumeric: 'tabular-nums' }}>{j.jobNumber}</Link>
                      {j.certified && <span title="Certified" style={{ marginLeft: 6, fontSize: 10, color: 'var(--pill-pending-fg)' }}>CERT</span>}
                    </td>
                    <td style={tdStyle}>{j.name ?? '—'}</td>
                    <td style={tdStyle}>{j.customer ?? '—'}</td>
                    <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{j.profile?.name ?? '—'}</td>
                    <td style={tdStyle}>{j.entityCode}</td>
                    <td style={tdStyle}>{statusPill(j.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
