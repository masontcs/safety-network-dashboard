'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmployeeRow {
  id: string
  firstName: string
  lastName: string
  displayName: string
  isActive: boolean
  branchId: string | null
  branchName: string | null
  entities: string[]
  laborType: string | null
  lastPayrollDate: string | null
}

interface Props {
  basePath: string
  branches: { id: string; name: string }[]
  entities: { id: string; code: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtLaborType(lt: string | null): string {
  if (!lt) return '—'
  const map: Record<string, string> = {
    direct: 'Direct',
    admin_hourly: 'Admin Hourly',
    admin_salary: 'Admin Salary',
    corp_hourly: 'Corp Hourly',
    corp_salary: 'Corp Salary',
    hq_hourly: 'HQ Hourly',
    hq_salary: 'HQ Salary',
  }
  return map[lt] ?? lt
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  borderRadius: 12,
  border: '1px solid var(--border)',
  padding: 16,
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 400,
  color: 'var(--text-dim)',
  paddingBottom: 8,
  paddingRight: 12,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  userSelect: 'none',
}

const tdStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary)',
  padding: '9px 12px 9px 0',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  fontSize: 12,
  padding: '6px 12px',
  outline: 'none',
  fontFamily: 'inherit',
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  fontSize: 12,
  padding: '6px 10px',
  outline: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const pillStyle: React.CSSProperties = {
  background: '#1a2a1a',
  color: '#ff6b00',
  border: '1px solid #2a3a2a',
  borderRadius: 4,
  fontSize: 10,
  padding: '1px 6px',
  fontWeight: 500,
  display: 'inline-block',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmployeeListClient({ basePath, branches, entities }: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [branchId, setBranchId] = useState('')
  const [entityCode, setEntityCode] = useState('')
  const [laborType, setLaborType] = useState('')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('displayName')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const PAGE_SIZE = 50
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Debounce search
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }
  }, [search])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [branchId, entityCode, laborType])

  const fetchEmployees = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      search: debouncedSearch,
      branchId,
      entityCode,
      laborType,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy,
      sortDir,
    })
    fetch(`/api/employees?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error ?? 'Failed to load employees')
        setEmployees(json.data as EmployeeRow[])
        setTotal(json.total ?? json.data.length)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [debouncedSearch, branchId, entityCode, laborType, page, sortBy, sortDir])

  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(1)
  }

  function clearFilters() {
    setSearch('')
    setDebouncedSearch('')
    setBranchId('')
    setEntityCode('')
    setLaborType('')
    setPage(1)
  }

  function SortIndicator({ col }: { col: string }) {
    if (sortBy !== col) return <span style={{ color: 'var(--text-faint)', marginLeft: 3 }}>↕</span>
    return <span style={{ color: '#ff6b00', marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const hasFilters = search || branchId || entityCode || laborType

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      {/* Page title */}
      <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 20px 0' }}>
        Employees
      </h1>

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <span
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-dim)',
              fontSize: 13,
              pointerEvents: 'none',
            }}
          >
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees…"
            style={{ ...inputStyle, paddingLeft: 30, width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {/* Branch */}
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          style={selectStyle}
        >
          <option value="">All Branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        {/* Entity */}
        <select
          value={entityCode}
          onChange={(e) => setEntityCode(e.target.value)}
          style={selectStyle}
        >
          <option value="">All Entities</option>
          {entities.map((e) => (
            <option key={e.id} value={e.code}>{e.code}</option>
          ))}
        </select>

        {/* Labor Type */}
        <select
          value={laborType}
          onChange={(e) => setLaborType(e.target.value)}
          style={selectStyle}
        >
          <option value="">All Types</option>
          <option value="direct">Direct</option>
          <option value="admin_hourly">Admin Hourly</option>
          <option value="admin_salary">Admin Salary</option>
          <option value="corp">Corp</option>
          <option value="hq">HQ</option>
        </select>

        {/* Clear */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            style={{
              background: 'none',
              border: '1px solid var(--border-emphasis)',
              borderRadius: 8,
              color: 'var(--text-muted)',
              fontSize: 12,
              padding: '6px 12px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Count */}
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px 0' }}>
        {loading
          ? 'Loading…'
          : `Showing ${employees.length} of ${total} employee${total !== 1 ? 's' : ''}`}
      </p>

      {/* Error */}
      {error && (
        <p style={{ color: '#cc4444', fontSize: 13, marginBottom: 12 }}>{error}</p>
      )}

      {/* Table */}
      <div style={cardStyle}>
        {loading ? (
          <SkeletonRows />
        ) : employees.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            No employees match your filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th
                    style={thStyle}
                    onClick={() => handleSort('displayName')}
                  >
                    Name<SortIndicator col="displayName" />
                  </th>
                  <th
                    style={thStyle}
                    onClick={() => handleSort('branch')}
                  >
                    Branch<SortIndicator col="branch" />
                  </th>
                  <th style={{ ...thStyle, cursor: 'default' }}>Entities</th>
                  <th style={{ ...thStyle, cursor: 'default' }}>Labor Type</th>
                  <th style={{ ...thStyle, cursor: 'default' }}>Status</th>
                  <th
                    style={thStyle}
                    onClick={() => handleSort('lastPayrollDate')}
                  >
                    Last Payroll<SortIndicator col="lastPayrollDate" />
                  </th>
                  <th style={{ ...thStyle, cursor: 'default' }}></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, i) => (
                  <tr
                    key={emp.id}
                    style={{
                      borderTop: '1px solid var(--border)',
                      background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                    }}
                  >
                    {/* Name */}
                    <td style={tdStyle}>
                      <Link
                        href={`${basePath}/${emp.id}`}
                        style={{ color: '#ff6b00', textDecoration: 'none', fontWeight: 500 }}
                        onMouseOver={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseOut={(e) => (e.currentTarget.style.textDecoration = 'none')}
                      >
                        {emp.displayName}
                      </Link>
                    </td>

                    {/* Branch */}
                    <td style={{ ...tdStyle, color: '#ff6b00' }}>
                      {emp.branchName ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
                    </td>

                    {/* Entities */}
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {emp.entities.length > 0
                          ? emp.entities.map((code) => (
                              <span key={code} style={pillStyle}>{code}</span>
                            ))
                          : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </div>
                    </td>

                    {/* Labor Type */}
                    <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>
                      {fmtLaborType(emp.laborType)}
                    </td>

                    {/* Status */}
                    <td style={tdStyle}>
                      {emp.isActive ? (
                        <span
                          style={{
                            background: '#1a3a1a',
                            color: '#4caf50',
                            borderRadius: 4,
                            fontSize: 11,
                            padding: '2px 8px',
                          }}
                        >
                          Active
                        </span>
                      ) : (
                        <span
                          style={{
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-muted)',
                            borderRadius: 4,
                            fontSize: 11,
                            padding: '2px 8px',
                          }}
                        >
                          Inactive
                        </span>
                      )}
                    </td>

                    {/* Last Payroll */}
                    <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>
                      {fmtDate(emp.lastPayrollDate)}
                    </td>

                    {/* Action */}
                    <td style={tdStyle}>
                      <Link
                        href={`${basePath}/${emp.id}`}
                        style={{
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-emphasis)',
                          borderRadius: 6,
                          fontSize: 11,
                          padding: '4px 10px',
                          textDecoration: 'none',
                          display: 'inline-block',
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.borderColor = '#ff6b00'
                          e.currentTarget.style.color = '#ff6b00'
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.borderColor = 'var(--bg-tertiary)'
                          e.currentTarget.style.color = 'var(--text-secondary)'
                        }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 16,
              paddingTop: 12,
              borderTop: '1px solid var(--border)',
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            <span>
              Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                style={{
                  background: 'var(--bg-secondary)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  color: page <= 1 ? 'var(--text-faint)' : 'var(--text-secondary)',
                  cursor: page <= 1 ? 'default' : 'pointer',
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              >
                ← Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{
                  background: 'var(--bg-secondary)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  color: page >= totalPages ? 'var(--text-faint)' : 'var(--text-secondary)',
                  cursor: page >= totalPages ? 'default' : 'pointer',
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 36,
            background: 'var(--bg-secondary)',
            borderRadius: 6,
            opacity: 1 - i * 0.08,
          }}
        />
      ))}
    </div>
  )
}
