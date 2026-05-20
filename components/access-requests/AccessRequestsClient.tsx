'use client'

import { useState, useEffect } from 'react'
import Skeleton from '@/components/ui/Skeleton'
import BranchMultiSelect from '@/components/ui/BranchMultiSelect'
import type { SelectableBranch } from '@/components/ui/BranchMultiSelect'

type Branch = SelectableBranch

interface AccessRequest {
  id: string
  firstName: string
  lastName: string
  email: string
  username: string | null
  branchId: string | null
  branchName: string | null
  requestedRole: string
  notes: string | null
  status: 'pending' | 'approved' | 'archived' | 'denied'
  reviewedAt: string | null
  createdAt: string
}

const ROLE_LABELS: Record<string, string> = {
  branch_manager:   'Branch Manager',
  district_manager: 'District Manager',
  executive:        'Executive',
  ar_manager:       'AR Manager',
  ar_team:          'AR Team',
  office_team:      'Office Team',
  project_manager:  'Project Manager',
  sales:            'Sales',
  admin:            'Admin',
}

const APPROVABLE_ROLES = [
  { value: 'branch_manager',   label: 'Branch Manager' },
  { value: 'district_manager', label: 'District Manager' },
  { value: 'executive',        label: 'Executive' },
  { value: 'ar_manager',       label: 'AR Manager' },
  { value: 'ar_team',          label: 'AR Team' },
  { value: 'office_team',      label: 'Office Team' },
  { value: 'project_manager',  label: 'Project Manager' },
  { value: 'sales',            label: 'Sales' },
]

function fmtDate(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dateStr))
}

function StatusPill({ status }: { status: AccessRequest['status'] }) {
  const styles: Record<string, React.CSSProperties> = {
    pending:  { background: '#2a1a00', color: '#ff9800', border: '1px solid #3a2a00' },
    approved: { background: '#1a3a1a', color: '#4caf50', border: '1px solid #2a4a2a' },
    archived: { background: '#2a2a2a', color: '#555555', border: '1px solid #333333' },
    // legacy denied records
    denied:   { background: '#2a2a2a', color: '#555555', border: '1px solid #333333' },
  }
  const label = status === 'denied' ? 'Archived' : status.charAt(0).toUpperCase() + status.slice(1)
  return (
    <span style={{ ...(styles[status] ?? styles.archived), borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500 }}>
      {label}
    </span>
  )
}

type ModalState =
  | null
  | { type: 'review'; request: AccessRequest }
  | { type: 'archive'; request: AccessRequest }

export default function AccessRequestsClient() {
  const [requests, setRequests]     = useState<AccessRequest[]>([])
  const [branches, setBranches]     = useState<Branch[]>([])
  const [loading, setLoading]       = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [modal, setModal]           = useState<ModalState>(null)

  // Review modal state
  const [actionRole, setActionRole]         = useState('')
  const [actionBranchIds, setActionBranchIds] = useState<string[]>([])
  const [actionUsername, setActionUsername]   = useState('')
  const [tmpPassword, setTmpPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [copied, setCopied]                   = useState(false)
  const [actionSaving, setActionSaving]       = useState(false)
  const [actionError, setActionError]         = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/access-requests')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setRequests(json.data.requests)
        setBranches(json.data.branches)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [])

  function generatePassword(): string {
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const digits  = '0123456789'
    const special = '!@#$%'
    const all     = letters + digits + special
    let pwd = letters[Math.floor(Math.random() * letters.length)]
    pwd += digits[Math.floor(Math.random() * digits.length)]
    pwd += special[Math.floor(Math.random() * special.length)]
    for (let i = 3; i < 12; i++) pwd += all[Math.floor(Math.random() * all.length)]
    return pwd.split('').sort(() => Math.random() - 0.5).join('')
  }

  function handleGenerate() {
    const pwd = generatePassword()
    setTmpPassword(pwd)
    setConfirmPassword(pwd)
    setCopied(false)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(tmpPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openReview(req: AccessRequest) {
    setModal({ type: 'review', request: req })
    setActionRole(req.requestedRole)
    setActionBranchIds(req.branchId ? [req.branchId] : [])
    setActionUsername(req.username ?? '')
    setTmpPassword('')
    setConfirmPassword('')
    setCopied(false)
    setActionError(null)
  }

  function openArchive(req: AccessRequest) {
    setModal({ type: 'archive', request: req })
    setActionError(null)
  }

  function closeModal() {
    setModal(null)
    setActionBranchIds([])
    setActionUsername('')
    setTmpPassword('')
    setConfirmPassword('')
    setCopied(false)
    setActionError(null)
  }

  async function handleApprove() {
    if (!modal || modal.type !== 'review') return
    if (actionBranchIds.length === 0) { setActionError('At least one branch is required.'); return }
    if (tmpPassword.length < 8) { setActionError('Temporary password must be at least 8 characters.'); return }
    if (tmpPassword !== confirmPassword) { setActionError('Passwords do not match.'); return }
    setActionSaving(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/access-requests/${modal.request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          role: actionRole,
          branchIds: actionBranchIds,
          temporaryPassword: tmpPassword,
          username: actionUsername,
        }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setRequests((prev) =>
        prev.map((r) => r.id === modal.request.id ? { ...r, status: 'approved' as const } : r)
      )
      closeModal()
    } catch {
      setActionError('Network error — please try again.')
    } finally {
      setActionSaving(false)
    }
  }

  async function handleArchive() {
    if (!modal || modal.type !== 'archive') return
    setActionSaving(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/access-requests/${modal.request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deny' }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setRequests((prev) =>
        prev.map((r) => r.id === modal.request.id ? { ...r, status: 'archived' as const } : r)
      )
      closeModal()
    } catch {
      setActionError('Network error — please try again.')
    } finally {
      setActionSaving(false)
    }
  }

  const pending  = requests.filter((r) => r.status === 'pending')
  const reviewed = requests.filter((r) => r.status !== 'pending')

  if (fetchError) {
    return <div style={{ color: '#cc4444', fontSize: 13, padding: 16 }}>Failed to load: {fetchError}</div>
  }

  const selectStyle: React.CSSProperties = {
    background: '#2a2a2a',
    border: '1px solid #333333',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 12,
    color: '#cccccc',
    fontFamily: 'inherit',
    cursor: 'pointer',
    width: '100%',
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Access Requests</div>
          {!loading && pending.length > 0 && (
            <span style={{ background: '#ff6b00', color: '#ffffff', borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>
              {pending.length} pending
            </span>
          )}
        </div>

        {/* Pending table */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#cccccc' }}>Pending Review</span>
            <span style={{ fontSize: 11, color: '#555' }}>— click Review to approve or adjust the role &amp; branches before creating the account</span>
          </div>
          {loading ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map((i) => <Skeleton key={i} height={44} />)}
            </div>
          ) : pending.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: '#555555' }}>
              No pending requests.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Email', 'Username', 'Requested Branch', 'Requested Role', 'Submitted', 'Notes', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '9px 16px', fontWeight: 400, fontSize: 11, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #2a2a2a' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 500, color: '#ffffff', whiteSpace: 'nowrap' }}>
                      {r.firstName} {r.lastName}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: '#cccccc' }}>{r.email}</td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: '#888888', fontFamily: 'monospace' }}>
                      {r.username ?? <span style={{ color: '#555555' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: '#888888', whiteSpace: 'nowrap' }}>
                      {r.branchName ?? <span style={{ color: '#555555' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: '#888888', whiteSpace: 'nowrap' }}>
                      {ROLE_LABELS[r.requestedRole] ?? r.requestedRole}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: '#888888', whiteSpace: 'nowrap' }}>
                      {fmtDate(r.createdAt)}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: '#888888', maxWidth: 200 }}>
                      {r.notes ? (
                        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {r.notes}
                        </span>
                      ) : <span style={{ color: '#555555' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                        <button
                          onClick={() => openReview(r)}
                          className="btn-primary"
                          style={{ fontSize: 12, padding: '5px 14px' }}
                        >
                          Review →
                        </button>
                        {/* Archive: subtle — only for clearly erroneous/spam requests */}
                        <button
                          onClick={() => openArchive(r)}
                          title="Archive this request (not a block — they can re-apply)"
                          style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, color: '#444444', fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#666'; e.currentTarget.style.borderColor = '#444' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#444'; e.currentTarget.style.borderColor = '#2a2a2a' }}
                        >
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Reviewed table */}
        {!loading && reviewed.length > 0 && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', fontSize: 12, fontWeight: 500, color: '#cccccc' }}>
              Reviewed
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Email', 'Branch', 'Role Requested', 'Submitted', 'Status'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '9px 16px', fontWeight: 400, fontSize: 11, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #2a2a2a' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reviewed.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #2a2a2a', opacity: 0.7 }}>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: '#cccccc', whiteSpace: 'nowrap' }}>
                      {r.firstName} {r.lastName}
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 12, color: '#888888' }}>{r.email}</td>
                    <td style={{ padding: '10px 16px', fontSize: 12, color: '#888888', whiteSpace: 'nowrap' }}>
                      {r.branchName ?? '—'}
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 12, color: '#888888', whiteSpace: 'nowrap' }}>
                      {ROLE_LABELS[r.requestedRole] ?? r.requestedRole}
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 12, color: '#888888', whiteSpace: 'nowrap' }}>
                      {fmtDate(r.createdAt)}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal overlay ──────────────────────────────────────────────────────── */}
      {modal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div
            style={{
              background: '#1e1e1e',
              border: '1px solid #2a2a2a',
              borderRadius: 12,
              padding: 28,
              width: '100%',
              maxWidth: 500,
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            {/* ── Review & Approve modal ──────────────────────────────────────── */}
            {modal.type === 'review' && (
              <>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', marginBottom: 4 }}>
                  Review Request — {modal.request.firstName} {modal.request.lastName}
                </div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 16, lineHeight: 1.5 }}>
                  Adjust the role and branches below if what they requested isn&rsquo;t right, then create the account.
                </div>

                {/* What they requested — reference row */}
                <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 14px', marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>They requested</div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      <span style={{ color: '#ccc' }}>{ROLE_LABELS[modal.request.requestedRole] ?? modal.request.requestedRole}</span>
                      {modal.request.branchName && <span style={{ color: '#555' }}> · {modal.request.branchName}</span>}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Email</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{modal.request.email}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* Username */}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                      Username
                    </label>
                    <input
                      type="text"
                      value={actionUsername}
                      onChange={(e) => setActionUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      placeholder="e.g. jsmith"
                      maxLength={20}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      style={{ ...selectStyle, fontFamily: 'monospace', letterSpacing: '0.04em' }}
                    />
                    <div style={{ fontSize: 11, color: '#555555', marginTop: 4 }}>
                      3–20 chars · lowercase letters, numbers, underscores · used to log in
                    </div>
                  </div>

                  {/* Role — labelled as "Approved Role" to make clear it's what gets set */}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                      Approved Role
                      {actionRole !== modal.request.requestedRole && (
                        <span style={{ marginLeft: 8, color: '#ff6b00', fontWeight: 600 }}>changed</span>
                      )}
                    </label>
                    <select value={actionRole} onChange={(e) => setActionRole(e.target.value)} style={selectStyle}>
                      {APPROVABLE_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Branches */}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                      Approved Branches
                      {modal.request.branchId && !actionBranchIds.includes(modal.request.branchId) && (
                        <span style={{ marginLeft: 8, color: '#ff6b00', fontWeight: 600 }}>changed</span>
                      )}
                    </label>
                    <BranchMultiSelect
                      branches={branches}
                      selectedIds={actionBranchIds}
                      onChange={setActionBranchIds}
                      role={actionRole}
                    />
                  </div>

                  {/* Temporary password */}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                      Temporary Password
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        value={tmpPassword}
                        onChange={(e) => { setTmpPassword(e.target.value); setCopied(false) }}
                        placeholder="Min 8 characters"
                        style={{ ...selectStyle, flex: 1, fontFamily: 'monospace', letterSpacing: '0.05em' }}
                      />
                      <button
                        type="button"
                        onClick={handleCopy}
                        disabled={!tmpPassword}
                        style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 6, color: copied ? '#4caf50' : '#888888', fontSize: 11, padding: '0 10px', cursor: tmpPassword ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: tmpPassword ? 1 : 0.4 }}
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={handleGenerate}
                        style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 6, color: '#ff6b00', fontSize: 11, padding: '0 10px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                      >
                        Generate
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                      Confirm Password
                    </label>
                    <input
                      type="text"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      style={{ ...selectStyle, fontFamily: 'monospace', letterSpacing: '0.05em' }}
                    />
                  </div>

                  <div style={{ fontSize: 11, color: '#555555', lineHeight: 1.5, padding: '8px 10px', background: '#1a1a1a', borderRadius: 6, border: '1px solid #2a2a2a' }}>
                    Share this temporary password with the user. They will be required to change it on first login.
                  </div>

                  {actionError && (
                    <div style={{ fontSize: 12, color: '#cc4444', padding: '8px 10px', background: '#2a1a1a', borderRadius: 6 }}>
                      {actionError}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      onClick={handleApprove}
                      disabled={actionSaving || !actionRole || actionBranchIds.length === 0 || !tmpPassword}
                      className="btn-primary"
                      style={{ flex: 1, opacity: (actionSaving || actionBranchIds.length === 0 || !tmpPassword) ? 0.6 : 1 }}
                    >
                      {actionSaving ? 'Creating Account…' : 'Create Account'}
                    </button>
                    <button
                      onClick={closeModal}
                      style={{ flex: 1, background: '#2a2a2a', border: 'none', borderRadius: 8, color: '#888888', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ── Archive modal ───────────────────────────────────────────────── */}
            {modal.type === 'archive' && (
              <>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', marginBottom: 8 }}>
                  Archive Request
                </div>
                <div style={{ fontSize: 13, color: '#888888', marginBottom: 8, lineHeight: 1.6 }}>
                  This will remove <span style={{ color: '#ccc' }}>{modal.request.firstName} {modal.request.lastName}</span>&rsquo;s request from the pending queue.
                </div>
                <div style={{ fontSize: 12, color: '#555', marginBottom: 24, padding: '8px 10px', background: '#1a1a1a', borderRadius: 6, border: '1px solid #2a2a2a', lineHeight: 1.5 }}>
                  This does <strong style={{ color: '#888' }}>not</strong> block the person from re-applying or getting access in the future. Use this only for duplicate or clearly erroneous submissions.
                </div>

                {actionError && (
                  <div style={{ fontSize: 12, color: '#cc4444', marginBottom: 12 }}>{actionError}</div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleArchive}
                    disabled={actionSaving}
                    style={{ flex: 1, background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#888888', fontSize: 14, fontWeight: 500, padding: '9px 0', cursor: 'pointer', fontFamily: 'inherit', opacity: actionSaving ? 0.6 : 1 }}
                  >
                    {actionSaving ? 'Archiving…' : 'Archive Request'}
                  </button>
                  <button
                    onClick={closeModal}
                    style={{ flex: 1, background: '#2a2a2a', border: 'none', borderRadius: 8, color: '#888888', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
