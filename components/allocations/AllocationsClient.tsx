'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils/format'

interface AllocRow {
  id: string
  employee_id: string
  branch_id: string
  percentage: number
  effective_from: string
  effective_to: string | null
  status: string
  notes: string | null
  created_at: string
  displayName: string
  branchName: string
}

interface OverrideRow {
  id: string
  employee_id: string
  period_date: string
  branch_id: string
  percentage: number
  status: string
  notes: string | null
  created_at: string
  displayName: string
  branchName: string
}

interface AllocationsData {
  pendingAllocations: AllocRow[]
  pendingOverrides: OverrideRow[]
  activeAllocations: AllocRow[]
}

const cardStyle: React.CSSProperties = {
  background: '#1e1e1e',
  border: '1px solid #2a2a2a',
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  color: '#666',
  fontWeight: 400,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: '1px solid #2a2a2a',
}

const tdStyle: React.CSSProperties = {
  padding: '9px 12px',
  color: '#cccccc',
  fontSize: 12,
  borderBottom: '1px solid #1e1e1e',
}

function statusPill(status: string) {
  const approved = status === 'approved'
  return (
    <span style={{
      background: approved ? '#1a3a1a' : '#3a2a1a',
      color: approved ? '#4caf50' : '#ff9800',
      borderRadius: 4,
      padding: '2px 8px',
      fontSize: 11,
    }}>{status}</span>
  )
}

export default function AllocationsClient() {
  const router = useRouter()
  const [tab, setTab] = useState<'pending' | 'active'>('pending')
  const [data, setData] = useState<AllocationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/admin/allocations')
      .then((r) => r.json())
      .then((json) => { if (json.success) setData(json.data) })
      .catch(() => {/* non-critical */})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const approveAllocation = async (employeeId: string, allocationId: string) => {
    setActioning(allocationId)
    await fetch(`/api/employees/${employeeId}/allocations/${allocationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    setActioning(null)
    load()
  }

  const denyAllocation = async (employeeId: string, allocationId: string) => {
    setActioning(allocationId)
    await fetch(`/api/employees/${employeeId}/allocations/${allocationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'denied' }),
    })
    setActioning(null)
    load()
  }

  const approveOverride = async (employeeId: string, overrideId: string) => {
    setActioning(overrideId)
    await fetch(`/api/employees/${employeeId}/allocation-overrides/${overrideId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    setActioning(null)
    load()
  }

  const denyOverride = async (employeeId: string, overrideId: string) => {
    setActioning(overrideId)
    await fetch(`/api/employees/${employeeId}/allocation-overrides/${overrideId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'denied' }),
    })
    setActioning(null)
    load()
  }

  const pendingCount = data ? data.pendingAllocations.length + data.pendingOverrides.length : 0

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: '#ffffff', fontSize: 22, fontWeight: 500, margin: 0 }}>Employee Allocations</h1>
        <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>Manage branch cost splits for payroll and fuel reporting.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {(['pending', 'active'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: tab === t ? '#ff6b00' : '#2a2a2a',
              color: tab === t ? '#fff' : '#999',
              border: 'none',
              borderRadius: 8,
              padding: '6px 16px',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {t === 'pending' ? 'Pending' : 'Active'}
            {t === 'pending' && pendingCount > 0 && (
              <span style={{ background: '#cc4444', borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 500 }}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#888', fontSize: 14 }}>Loading…</p>
      ) : tab === 'pending' ? (
        <>
          {/* Pending default allocations */}
          <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Default Allocations</h2>
          {!data || data.pendingAllocations.length === 0 ? (
            <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>No pending default allocations.</p>
          ) : (
            <div style={cardStyle}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Employee', 'Branch', 'Pct', 'Effective From', 'Notes', 'Actions'].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.pendingAllocations.map((a) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
                      <td style={{ ...tdStyle, color: '#ff6b00', cursor: 'pointer' }} onClick={() => router.push(`/admin/employees/${a.employee_id}`)}>{a.displayName}</td>
                      <td style={tdStyle}>{a.branchName}</td>
                      <td style={tdStyle}>{a.percentage}%</td>
                      <td style={tdStyle}>{a.effective_from}</td>
                      <td style={{ ...tdStyle, color: '#888' }}>{a.notes ?? '—'}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => approveAllocation(a.employee_id, a.id)}
                            disabled={actioning === a.id}
                            style={{ background: '#1a3a1a', color: '#4caf50', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => denyAllocation(a.employee_id, a.id)}
                            disabled={actioning === a.id}
                            style={{ background: '#3a1a1a', color: '#cc4444', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                          >
                            Deny
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pending weekly overrides */}
          <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 500, marginBottom: 8, marginTop: 8 }}>Weekly Overrides</h2>
          {!data || data.pendingOverrides.length === 0 ? (
            <p style={{ color: '#888', fontSize: 13 }}>No pending weekly overrides.</p>
          ) : (
            <div style={cardStyle}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Employee', 'Period', 'Branch', 'Pct', 'Notes', 'Actions'].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.pendingOverrides.map((o) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
                      <td style={{ ...tdStyle, color: '#ff6b00', cursor: 'pointer' }} onClick={() => router.push(`/admin/employees/${o.employee_id}`)}>{o.displayName}</td>
                      <td style={tdStyle}>{o.period_date}</td>
                      <td style={tdStyle}>{o.branchName}</td>
                      <td style={tdStyle}>{o.percentage}%</td>
                      <td style={{ ...tdStyle, color: '#888' }}>{o.notes ?? '—'}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => approveOverride(o.employee_id, o.id)}
                            disabled={actioning === o.id}
                            style={{ background: '#1a3a1a', color: '#4caf50', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => denyOverride(o.employee_id, o.id)}
                            disabled={actioning === o.id}
                            style={{ background: '#3a1a1a', color: '#cc4444', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                          >
                            Deny
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Active Default Allocations</h2>
          {!data || data.activeAllocations.length === 0 ? (
            <p style={{ color: '#888', fontSize: 13 }}>No active allocations. All employees are 100% home branch.</p>
          ) : (
            <div style={cardStyle}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Employee', 'Branch', 'Pct', 'Effective From', 'Status'].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.activeAllocations.map((a) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
                      <td style={{ ...tdStyle, color: '#ff6b00', cursor: 'pointer' }} onClick={() => router.push(`/admin/employees/${a.employee_id}`)}>{a.displayName}</td>
                      <td style={tdStyle}>{a.branchName}</td>
                      <td style={tdStyle}>{a.percentage}%</td>
                      <td style={tdStyle}>{a.effective_from}</td>
                      <td style={tdStyle}>{statusPill(a.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
