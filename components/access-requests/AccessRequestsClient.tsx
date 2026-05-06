'use client'

import { useState, useEffect } from 'react'
import Skeleton from '@/components/ui/Skeleton'

interface Branch {
  id: string
  name: string
}

interface AccessRequest {
  id: string
  firstName: string
  lastName: string
  email: string
  branchId: string | null
  branchName: string | null
  requestedRole: string
  notes: string | null
  status: 'pending' | 'approved' | 'denied'
  reviewedAt: string | null
  createdAt: string
}

const ROLE_LABELS: Record<string, string> = {
  branch_manager: 'Branch Manager',
  district_manager: 'District Manager',
  executive: 'Executive',
}

const APPROVABLE_ROLES = [
  { value: 'branch_manager', label: 'Branch Manager' },
  { value: 'district_manager', label: 'District Manager' },
  { value: 'executive', label: 'Executive' },
]

function fmtDate(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dateStr))
}

function StatusPill({ status }: { status: AccessRequest['status'] }) {
  const styles: Record<string, React.CSSProperties> = {
    pending:  { background: '#2a1a00', color: '#ff9800', border: '1px solid #3a2a00' },
    approved: { background: '#1a3a1a', color: '#4caf50', border: '1px solid #2a4a2a' },
    denied:   { background: '#2a2a2a', color: '#666666', border: '1px solid #333333' },
  }
  return (
    <span style={{ ...styles[status], borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500 }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

type ModalState =
  | null
  | { type: 'approve'; request: AccessRequest }
  | { type: 'deny'; request: AccessRequest }

export default function AccessRequestsClient() {
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [actionRole, setActionRole] = useState('')
  const [actionBranchId, setActionBranchId] = useState('')
  const [actionSaving, setActionSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  function openApprove(req: AccessRequest) {
    setModal({ type: 'approve', request: req })
    setActionRole(req.requestedRole)
    setActionBranchId(req.branchId ?? (branches[0]?.id ?? ''))
    setActionError(null)
  }

  function openDeny(req: AccessRequest) {
    setModal({ type: 'deny', request: req })
    setActionError(null)
  }

  function closeModal() {
    setModal(null)
    setActionError(null)
  }

  async function handleApprove() {
    if (!modal || modal.type !== 'approve') return
    setActionSaving(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/access-requests/${modal.request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', role: actionRole, branchId: actionBranchId }),
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

  async function handleDeny() {
    if (!modal || modal.type !== 'deny') return
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
        prev.map((r) => r.id === modal.request.id ? { ...r, status: 'denied' as const } : r)
      )
      closeModal()
    } catch {
      setActionError('Network error — please try again.')
    } finally {
      setActionSaving(false)
    }
  }

  const pending = requests.filter((r) => r.status === 'pending')
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
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', fontSize: 12, fontWeight: 500, color: '#cccccc' }}>
            Pending Review
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
                  {['Name', 'Email', 'Branch', 'Role Requested', 'Submitted', 'Notes', ''].map((h) => (
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
                    <td style={{ padding: '11px 16px', fontSize: 12, color: '#cccccc', whiteSpace: 'nowrap' }}>
                      {r.branchName ?? <span style={{ color: '#555555' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: '#cccccc', whiteSpace: 'nowrap' }}>
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
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => openApprove(r)}
                          className="btn-primary"
                          style={{ fontSize: 12, padding: '5px 12px' }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => openDeny(r)}
                          style={{ background: 'none', border: '1px solid #333333', borderRadius: 6, color: '#888888', fontSize: 12, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Deny
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

      {/* Modal overlay */}
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
              maxWidth: 420,
            }}
          >
            {modal.type === 'approve' ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', marginBottom: 4 }}>
                  Approve Request
                </div>
                <div style={{ fontSize: 12, color: '#888888', marginBottom: 20 }}>
                  Creating an account for {modal.request.firstName} {modal.request.lastName} will send them an invite email.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Email</div>
                    <div style={{ fontSize: 13, color: '#cccccc' }}>{modal.request.email}</div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                      Role
                    </label>
                    <select value={actionRole} onChange={(e) => setActionRole(e.target.value)} style={selectStyle}>
                      {APPROVABLE_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                      Branch
                    </label>
                    <select value={actionBranchId} onChange={(e) => setActionBranchId(e.target.value)} style={selectStyle}>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>

                  {actionError && (
                    <div style={{ fontSize: 12, color: '#cc4444', padding: '8px 10px', background: '#2a1a1a', borderRadius: 6 }}>
                      {actionError}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      onClick={handleApprove}
                      disabled={actionSaving || !actionRole || !actionBranchId}
                      className="btn-primary"
                      style={{ flex: 1, opacity: actionSaving ? 0.6 : 1 }}
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
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', marginBottom: 8 }}>
                  Deny Request
                </div>
                <div style={{ fontSize: 13, color: '#888888', marginBottom: 24, lineHeight: 1.5 }}>
                  Are you sure you want to deny {modal.request.firstName} {modal.request.lastName}&rsquo;s request for {ROLE_LABELS[modal.request.requestedRole]} access?
                </div>

                {actionError && (
                  <div style={{ fontSize: 12, color: '#cc4444', marginBottom: 12 }}>{actionError}</div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleDeny}
                    disabled={actionSaving}
                    style={{ flex: 1, background: '#3a1a1a', border: '1px solid #4a2a2a', borderRadius: 8, color: '#cc4444', fontSize: 14, fontWeight: 500, padding: '9px 0', cursor: 'pointer', fontFamily: 'inherit', opacity: actionSaving ? 0.6 : 1 }}
                  >
                    {actionSaving ? 'Denying…' : 'Deny Request'}
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
