'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string
  user_id: string | null
  user_display_name: string
  user_role: string
  action: string
  resource_type: string | null
  resource_id: string | null
  resource_label: string | null
  metadata: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

interface AuditUser {
  userId: string
  displayName: string
  role: string
}

// ── Action metadata ───────────────────────────────────────────────────────────

const ACTION_META: Record<string, { label: string; color: string }> = {
  'user.create':            { label: 'Created user',       color: '#4caf50' },
  'user.update':            { label: 'Updated user',       color: '#ff9800' },
  'access_request.approve': { label: 'Approved request',   color: '#4caf50' },
  'access_request.archive': { label: 'Archived request',   color: '#888888' },
  'import.payroll':         { label: 'Payroll import',     color: '#ff6b00' },
  'import.payroll.replace': { label: 'Replaced payroll',   color: '#cc4444' },
  'import.revenue':         { label: 'Revenue import',     color: '#ff6b00' },
  'import.fuel':            { label: 'Fuel import',        color: '#ff6b00' },
  'ar.note.add':            { label: 'Added note',         color: '#cccccc' },
  'ar.note.delete':         { label: 'Deleted note',       color: '#cc4444' },
  'ar.invoice.flag':        { label: 'Invoice flag',       color: '#ff9800' },
  'ar.customer.update':     { label: 'Customer update',    color: '#cccccc' },
  'payroll.view':           { label: 'Viewed payroll',     color: '#555555' },
}

const CATEGORY_OPTIONS = [
  { value: '',        label: 'All categories' },
  { value: 'users',   label: 'User management' },
  { value: 'requests', label: 'Access requests' },
  { value: 'imports', label: 'Imports' },
  { value: 'ar',      label: 'AR' },
  { value: 'payroll', label: 'Payroll' },
]

const PERIOD_OPTIONS = [
  { value: '1',   label: 'Last 24 hours' },
  { value: '7',   label: 'Last 7 days' },
  { value: '30',  label: 'Last 30 days' },
  { value: '90',  label: 'Last 90 days' },
  { value: '',    label: 'All time' },
]

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', executive: 'Executive', district_manager: 'District Mgr',
  branch_manager: 'Branch Mgr', ar_manager: 'AR Manager', ar_team: 'AR Team',
  office_team: 'Office Team', project_manager: 'Project Mgr', sales: 'Sales',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function resolveBranches(ids: unknown, branchMap: Record<string, string>): string {
  if (!Array.isArray(ids) || ids.length === 0) return '—'
  return ids.map((id) => branchMap[String(id)] ?? String(id).slice(0, 8) + '…').join(', ')
}

function MetaDetails({ metadata, action, branchMap }: { metadata: Record<string, unknown>; action: string; branchMap: Record<string, string> }) {
  if (!metadata || Object.keys(metadata).length === 0) return null

  const items: { label: string; value: string }[] = []

  if (action === 'user.create') {
    if (metadata.email) items.push({ label: 'Email', value: String(metadata.email) })
    if (metadata.role) items.push({ label: 'Role', value: ROLE_LABELS[String(metadata.role)] ?? String(metadata.role) })
    if (metadata.branchIds) items.push({ label: 'Branches', value: resolveBranches(metadata.branchIds, branchMap) })
  } else if (action === 'user.update') {
    const changes = metadata.changes as Record<string, unknown> | undefined
    if (changes) {
      if (changes.role) items.push({ label: 'New role', value: ROLE_LABELS[String(changes.role)] ?? String(changes.role) })
      if (typeof changes.isActive === 'boolean') items.push({ label: 'Active', value: changes.isActive ? 'Yes' : 'No' })
      if (changes.branchIds) items.push({ label: 'Branches', value: resolveBranches(changes.branchIds, branchMap) })
    }
  } else if (action === 'access_request.approve') {
    if (metadata.email) items.push({ label: 'Email', value: String(metadata.email) })
    if (metadata.requestedRole) items.push({ label: 'Requested', value: ROLE_LABELS[String(metadata.requestedRole)] ?? String(metadata.requestedRole) })
    if (metadata.approvedRole) items.push({ label: 'Approved as', value: ROLE_LABELS[String(metadata.approvedRole)] ?? String(metadata.approvedRole) })
    if (metadata.branchIds) items.push({ label: 'Branches', value: resolveBranches(metadata.branchIds, branchMap) })
  } else if (action === 'access_request.archive') {
    if (metadata.email) items.push({ label: 'Email', value: String(metadata.email) })
    if (metadata.requestedRole) items.push({ label: 'Requested', value: ROLE_LABELS[String(metadata.requestedRole)] ?? String(metadata.requestedRole) })
  } else if (action === 'import.payroll' || action === 'import.payroll.replace') {
    if (metadata.entityCode) items.push({ label: 'Entity', value: String(metadata.entityCode) })
    if (metadata.periodDate) items.push({ label: 'Period', value: String(metadata.periodDate) })
    if (metadata.transactionCount !== undefined) items.push({ label: 'Transactions', value: String(metadata.transactionCount) })
    if (metadata.replacedImportId) items.push({ label: 'Replaced', value: String(metadata.replacedImportId).slice(0, 8) + '…' })
  } else if (action === 'import.revenue') {
    if (metadata.periodDate) items.push({ label: 'Period', value: String(metadata.periodDate) })
    if (metadata.insertedCount !== undefined) items.push({ label: 'Records', value: String(metadata.insertedCount) })
  } else if (action === 'import.fuel') {
    if (metadata.vendor) items.push({ label: 'Vendor', value: String(metadata.vendor) })
    if (metadata.dateRangeStart) items.push({ label: 'From', value: String(metadata.dateRangeStart) })
    if (metadata.dateRangeEnd) items.push({ label: 'To', value: String(metadata.dateRangeEnd) })
    if (metadata.insertedCount !== undefined) items.push({ label: 'Records', value: String(metadata.insertedCount) })
  } else if (action === 'ar.note.add') {
    if (metadata.noteType) items.push({ label: 'Type', value: String(metadata.noteType) })
    if (metadata.snippet) items.push({ label: 'Note', value: String(metadata.snippet) })
  } else if (action === 'ar.invoice.flag') {
    if (metadata.from !== undefined) items.push({ label: 'Was', value: metadata.from ? String(metadata.from).replace(/_/g, ' ') : '—' })
    if (metadata.to !== undefined) items.push({ label: 'Now', value: metadata.to ? String(metadata.to).replace(/_/g, ' ') : '—' })
  } else if (action === 'ar.customer.update') {
    const changes = metadata.changes as Record<string, string> | undefined
    if (changes) {
      for (const [k, v] of Object.entries(changes)) {
        items.push({ label: k.replace(/_/g, ' '), value: String(v).replace(/_/g, ' ') })
      }
    }
  } else if (action === 'payroll.view') {
    if (metadata.startDate) items.push({ label: 'From', value: String(metadata.startDate) })
    if (metadata.endDate) items.push({ label: 'To', value: String(metadata.endDate) })
    if (metadata.branchId) items.push({ label: 'Branch', value: branchMap[String(metadata.branchId)] ?? String(metadata.branchId).slice(0, 8) + '…' })
  }

  if (items.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 4 }}>
      {items.map((item) => (
        <span key={item.label} style={{ fontSize: 11, color: '#666666' }}>
          <span style={{ color: '#444444' }}>{item.label}:</span>{' '}
          <span style={{ color: '#999999' }}>{item.value}</span>
        </span>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AuditClient() {
  const [logs, setLogs]         = useState<AuditLog[]>([])
  const [users, setUsers]       = useState<AuditUser[]>([])
  const [branchMap, setBranchMap] = useState<Record<string, string>>({})
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [page, setPage]         = useState(1)
  const limit = 50

  const [filterUserId,   setFilterUserId]   = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterPeriod,   setFilterPeriod]   = useState('30')

  const selectStyle: React.CSSProperties = {
    background: '#2a2a2a', border: '1px solid #333333', borderRadius: 6,
    padding: '6px 10px', fontSize: 12, color: '#cccccc',
    cursor: 'pointer', fontFamily: 'inherit',
  }

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (filterUserId)   params.set('userId',   filterUserId)
      if (filterCategory) params.set('category', filterCategory)
      if (filterPeriod) {
        const start = new Date()
        start.setDate(start.getDate() - parseInt(filterPeriod))
        params.set('startDate', start.toISOString().slice(0, 10))
      }

      const res  = await fetch(`/api/admin/audit?${params}`)
      const json = await res.json()
      if (json.success) {
        setLogs(json.data.logs)
        setTotal(json.data.total)
        setUsers(json.data.users)
      }
    } finally {
      setLoading(false)
    }
  }, [page, filterUserId, filterCategory, filterPeriod])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  // Load branches once for ID → name resolution
  useEffect(() => {
    fetch('/api/branches')
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, string> = {}
        for (const b of d.branches ?? d.data ?? []) {
          if (b.id && b.name) map[b.id] = b.name
        }
        setBranchMap(map)
      })
      .catch(() => {})
  }, [])

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [filterUserId, filterCategory, filterPeriod])

  const totalPages = Math.ceil(total / limit)

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', marginBottom: 2 }}>Audit Log</div>
          <div style={{ fontSize: 12, color: '#555555' }}>
            Track user actions across the platform
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#555555' }}>
          {total.toLocaleString()} event{total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)} style={selectStyle}>
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} style={selectStyle}>
          <option value=''>All users</option>
          {users.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.displayName} ({ROLE_LABELS[u.role] ?? u.role})
            </option>
          ))}
        </select>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={selectStyle}>
          {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {(filterUserId || filterCategory || filterPeriod !== '30') && (
          <button
            onClick={() => { setFilterUserId(''); setFilterCategory(''); setFilterPeriod('30') }}
            style={{ ...selectStyle, color: '#ff6b00', border: '1px solid #ff6b00', cursor: 'pointer' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#555555', fontSize: 13 }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#555555', fontSize: 13 }}>No events found</div>
        ) : (
          <div>
            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '160px 160px 1fr 140px',
              padding: '10px 16px',
              borderBottom: '1px solid #2a2a2a',
              fontSize: 11, color: '#444444', fontWeight: 400,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              <span>Time</span>
              <span>User</span>
              <span>Action / Resource</span>
              <span>IP</span>
            </div>

            {logs.map((log, idx) => {
              const meta = ACTION_META[log.action] ?? { label: log.action, color: '#666666' }
              return (
                <div
                  key={log.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 160px 1fr 140px',
                    padding: '12px 16px',
                    borderBottom: idx < logs.length - 1 ? '1px solid #1e1e1e' : 'none',
                    alignItems: 'start',
                    gap: 0,
                  }}
                >
                  {/* Time */}
                  <div>
                    <div style={{ fontSize: 12, color: '#cccccc' }}>{fmtTime(log.created_at)}</div>
                    <div style={{ fontSize: 11, color: '#444444', marginTop: 1 }}>{fmtRelative(log.created_at)}</div>
                  </div>

                  {/* User */}
                  <div>
                    <div style={{ fontSize: 12, color: '#cccccc', fontWeight: 500 }}>{log.user_display_name}</div>
                    <div style={{ fontSize: 11, color: '#444444', marginTop: 1 }}>
                      {ROLE_LABELS[log.user_role] ?? log.user_role}
                    </div>
                  </div>

                  {/* Action + resource */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: meta.color,
                        background: `${meta.color}18`,
                        padding: '2px 7px', borderRadius: 4,
                        border: `1px solid ${meta.color}30`,
                        whiteSpace: 'nowrap',
                      }}>
                        {meta.label}
                      </span>
                      {log.resource_label && (
                        <span style={{ fontSize: 12, color: '#cccccc' }}>{log.resource_label}</span>
                      )}
                    </div>
                    <MetaDetails metadata={log.metadata} action={log.action} branchMap={branchMap} />
                  </div>

                  {/* IP */}
                  <div style={{ fontSize: 11, color: '#444444', fontFamily: 'monospace', paddingTop: 2 }}>
                    {log.ip_address ?? '—'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
          <div style={{ fontSize: 12, color: '#555555' }}>
            Page {page} of {totalPages}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                ...selectStyle, padding: '5px 14px',
                opacity: page === 1 ? 0.4 : 1,
                cursor: page === 1 ? 'not-allowed' : 'pointer',
              }}
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{
                ...selectStyle, padding: '5px 14px',
                opacity: page === totalPages ? 0.4 : 1,
                cursor: page === totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
