'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import { formatCurrency } from '@/lib/utils/format'
import type { LaborType, Vendor } from '@/lib/supabase/database.types'
import type { Role } from '@/lib/supabase/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LegalName {
  entityCode: string
  entityName: string
  rawName: string
}

interface Assignment {
  entityId: string
  entityCode: string
  entityName: string
  payrollCode: string
  laborType: LaborType
  branchId: string | null
  branchName: string | null
}

interface EmployeeData {
  id: string
  firstName: string
  lastName: string
  displayName: string
  isActive: boolean
  legalNames: LegalName[]
  assignments: Assignment[]
}

interface PayrollRow {
  periodDate: string
  itemId: string | null
  itemName: string | null
  groupName: string | null
  hours: number | null
  rate: number | null
  amount: number
  entityCode: string
  laborType: LaborType
}

interface FuelRow {
  id: string
  transactionDate: string
  vendor: Vendor
  siteName: string | null
  siteCity: string | null
  siteState: string | null
  product: string | null
  gallons: number | null
  pricePerGallon: number | null
  totalWithTax: number
}

interface DetailData {
  employee: EmployeeData
  payrollHistory: PayrollRow[]
  fuelHistory: FuelRow[]
}

interface Props {
  employeeId: string
  role: Role
  returnPath: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPeriod(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function formatLaborType(lt: LaborType): string {
  switch (lt) {
    case 'direct': return 'Direct'
    case 'admin_hourly': return 'Admin Hourly'
    case 'admin_salary': return 'Admin Salary'
    case 'corp_hourly': return 'Corp Hourly'
    case 'corp_salary': return 'Corp Salary'
    case 'hq_hourly': return 'HQ Hourly'
    case 'hq_salary': return 'HQ Salary'
  }
}

function toWeekBucket(dateStr: string): string {
  // Returns ISO-week-aligned Saturday for grouping fuel transactions
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay() // 0=Sun ... 6=Sat
  const daysToSat = dow === 6 ? 0 : 6 - dow
  const sat = new Date(date)
  sat.setDate(date.getDate() + daysToSat)
  return sat.toISOString().slice(0, 10)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmployeeDetailClient({ employeeId, role, returnPath }: Props) {
  const router = useRouter()
  const isAdmin = role === 'admin'

  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit name state
  const [editing, setEditing] = useState(false)
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  // Fuel filter state
  const [vendorFilter, setVendorFilter] = useState<'all' | 'interstate' | 'flyers'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | '90d' | '1y'>('all')

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/employees/${employeeId}/detail`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error ?? 'Failed to load employee')
        setData(json.data as DetailData)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [employeeId])

  useEffect(() => { load() }, [load])

  // ── Derived payroll data ──────────────────────────────────────────────────

  const weeklyHours = useMemo<BarChartDataPoint[]>(() => {
    if (!data) return []
    const byPeriod: Record<string, number> = {}
    for (const row of data.payrollHistory) {
      if (row.hours == null) continue
      byPeriod[row.periodDate] = (byPeriod[row.periodDate] ?? 0) + row.hours
    }
    return Object.entries(byPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([date, value]) => ({ label: formatPeriod(date), value }))
  }, [data])

  const weeklyEarnings = useMemo<BarChartDataPoint[]>(() => {
    if (!data) return []
    const byPeriod: Record<string, number> = {}
    for (const row of data.payrollHistory) {
      byPeriod[row.periodDate] = (byPeriod[row.periodDate] ?? 0) + row.amount
    }
    return Object.entries(byPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([date, value]) => ({ label: formatPeriod(date), value }))
  }, [data])

  const groupBreakdown = useMemo<{ groupName: string; total: number; pct: number }[]>(() => {
    if (!data) return []
    const byGroup: Record<string, number> = {}
    const grandTotal = data.payrollHistory.reduce((s, r) => s + r.amount, 0)
    for (const row of data.payrollHistory) {
      const key = row.groupName ?? 'Uncategorized'
      byGroup[key] = (byGroup[key] ?? 0) + row.amount
    }
    return Object.entries(byGroup)
      .map(([groupName, total]) => ({
        groupName,
        total,
        pct: grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [data])

  const totalEarnings = useMemo(
    () => data?.payrollHistory.reduce((s, r) => s + r.amount, 0) ?? 0,
    [data]
  )
  const totalHours = useMemo(
    () => data?.payrollHistory.reduce((s, r) => s + (r.hours ?? 0), 0) ?? 0,
    [data]
  )

  // ── Derived fuel data ─────────────────────────────────────────────────────

  const filteredFuel = useMemo<FuelRow[]>(() => {
    if (!data) return []
    let rows = data.fuelHistory
    if (vendorFilter !== 'all') rows = rows.filter((r) => r.vendor === vendorFilter)
    if (dateFilter !== 'all') {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - (dateFilter === '90d' ? 90 : 365))
      const cutoffStr = cutoff.toISOString().slice(0, 10)
      rows = rows.filter((r) => r.transactionDate >= cutoffStr)
    }
    return rows
  }, [data, vendorFilter, dateFilter])

  const weeklyGallons = useMemo<BarChartDataPoint[]>(() => {
    const byWeek: Record<string, number> = {}
    for (const row of filteredFuel) {
      if (row.gallons == null) continue
      const bucket = toWeekBucket(row.transactionDate)
      byWeek[bucket] = (byWeek[bucket] ?? 0) + row.gallons
    }
    return Object.entries(byWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([date, value]) => ({ label: formatPeriod(date), value }))
  }, [filteredFuel])

  const totalFuelCost = useMemo(
    () => filteredFuel.reduce((s, r) => s + r.totalWithTax, 0),
    [filteredFuel]
  )
  const totalGallons = useMemo(
    () => filteredFuel.reduce((s, r) => s + (r.gallons ?? 0), 0),
    [filteredFuel]
  )

  // ── Edit name handlers ────────────────────────────────────────────────────

  function startEdit() {
    if (!data) return
    setEditFirst(data.employee.firstName)
    setEditLast(data.employee.lastName)
    setNameError(null)
    setEditing(true)
  }

  async function saveName() {
    const first = editFirst.trim()
    const last = editLast.trim()
    if (!first || !last) {
      setNameError('Both first and last name are required.')
      return
    }
    setSavingName(true)
    setNameError(null)
    try {
      const res = await fetch(`/api/employees/${employeeId}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: first, lastName: last }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Save failed')
      // Update local state
      setData((prev) =>
        prev
          ? {
              ...prev,
              employee: {
                ...prev.employee,
                firstName: json.data.firstName,
                lastName: json.data.lastName,
                displayName: json.data.displayName,
              },
            }
          : prev
      )
      setEditing(false)
    } catch (e) {
      setNameError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingName(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 32, background: '#2a2a2a', borderRadius: 8, width: 200, marginBottom: 12 }} />
        <div style={{ height: 24, background: '#2a2a2a', borderRadius: 8, width: 140, marginBottom: 24 }} />
        <div style={{ height: 120, background: '#1e1e1e', borderRadius: 12, marginBottom: 12 }} />
        <div style={{ height: 200, background: '#1e1e1e', borderRadius: 12 }} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24 }}>
        <button
          onClick={() => router.push(returnPath)}
          style={{ color: '#888888', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}
        >
          ← Back
        </button>
        <p style={{ color: '#cc4444', fontSize: 14 }}>{error ?? 'Employee not found.'}</p>
      </div>
    )
  }

  const { employee, payrollHistory, fuelHistory } = data
  const hasFuel = fuelHistory.length > 0

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Back */}
      <button
        onClick={() => router.push(returnPath)}
        style={{
          color: '#888888',
          fontSize: 13,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        ← Back
      </button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  placeholder="First name"
                  style={{
                    background: '#2a2a2a',
                    border: '1px solid #333333',
                    borderRadius: 8,
                    color: '#ffffff',
                    fontSize: 18,
                    fontWeight: 500,
                    padding: '6px 12px',
                    outline: 'none',
                    width: 160,
                  }}
                />
                <input
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  placeholder="Last name"
                  style={{
                    background: '#2a2a2a',
                    border: '1px solid #333333',
                    borderRadius: 8,
                    color: '#ffffff',
                    fontSize: 18,
                    fontWeight: 500,
                    padding: '6px 12px',
                    outline: 'none',
                    width: 160,
                  }}
                />
                <button
                  onClick={saveName}
                  disabled={savingName}
                  style={{
                    background: '#ff6b00',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '6px 16px',
                    fontSize: 13,
                    cursor: savingName ? 'not-allowed' : 'pointer',
                    opacity: savingName ? 0.7 : 1,
                  }}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  style={{
                    background: '#2a2a2a',
                    color: '#cccccc',
                    border: 'none',
                    borderRadius: 8,
                    padding: '6px 16px',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
              {nameError && <p style={{ color: '#cc4444', fontSize: 12, margin: 0 }}>{nameError}</p>}
              {/* Legal names shown read-only during edit */}
              {employee.legalNames.map((ln, i) => (
                <p key={i} style={{ margin: 0, fontSize: 11, color: '#555555' }}>
                  Legal name ({ln.entityCode}): {ln.rawName}
                </p>
              ))}
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', margin: '0 0 4px 0' }}>
                {employee.displayName}
                {!employee.isActive && (
                  <span style={{ marginLeft: 10, fontSize: 11, color: '#888888', fontWeight: 400 }}>
                    inactive
                  </span>
                )}
              </h1>
              {employee.legalNames.map((ln, i) => (
                <p key={i} style={{ margin: '0 0 2px 0', fontSize: 11, color: '#555555' }}>
                  Legal name ({ln.entityCode}): {ln.rawName}
                </p>
              ))}
            </>
          )}
        </div>

        {isAdmin && !editing && (
          <button
            onClick={startEdit}
            style={{
              background: '#2a2a2a',
              color: '#cccccc',
              border: '1px solid #333333',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Edit Name
          </button>
        )}
      </div>

      {/* Assignment pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
        {employee.assignments.map((a, i) => (
          <span key={i} style={{ display: 'flex', gap: 4 }}>
            {a.branchName && (
              <Pill color="orange">{a.branchName}</Pill>
            )}
            <Pill>{a.entityCode}</Pill>
            <Pill>{a.payrollCode}</Pill>
            <Pill>{formatLaborType(a.laborType)}</Pill>
          </span>
        ))}
      </div>

      {/* Summary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Total Earnings" value={formatCurrency(totalEarnings)} />
        <SummaryCard label="Total Hours" value={`${totalHours.toFixed(1)} hrs`} />
        <SummaryCard
          label="Avg Hourly Rate"
          value={
            totalHours > 0
              ? formatCurrency(totalEarnings / totalHours)
              : '—'
          }
        />
        <SummaryCard label="Fuel Cost" value={hasFuel ? formatCurrency(totalFuelCost) : '—'} />
      </div>

      {/* ── Payroll section ── */}
      <SectionHeader>Payroll History</SectionHeader>

      {payrollHistory.length === 0 ? (
        <p style={{ color: '#888888', fontSize: 13, marginBottom: 24 }}>No payroll records found.</p>
      ) : (
        <>
          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={cardStyle}>
              <p style={cardLabelStyle}>Hours per Week (last 13)</p>
              <BarChart
                data={weeklyHours}
                color="#ff6b00"
                height={130}
                formatValue={(v) => `${v.toFixed(1)} hrs`}
              />
            </div>
            <div style={cardStyle}>
              <p style={cardLabelStyle}>Earnings per Week (last 13)</p>
              <BarChart data={weeklyEarnings} color="#ff6b00" height={130} />
            </div>
          </div>

          {/* Rate history table */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <p style={{ ...cardLabelStyle, marginBottom: 12 }}>Rate History</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Period', 'Item', 'Group', 'Entity', 'Rate', 'Hours', 'Amount'].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payrollHistory.map((row, i) => (
                    <tr
                      key={i}
                      style={{
                        borderTop: '1px solid #2a2a2a',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}
                    >
                      <td style={tdStyle}>{formatPeriod(row.periodDate)}</td>
                      <td style={tdStyle}>{row.itemName ?? <span style={{ color: '#555555' }}>—</span>}</td>
                      <td style={{ ...tdStyle, color: '#888888' }}>{row.groupName ?? '—'}</td>
                      <td style={{ ...tdStyle, color: '#888888' }}>{row.entityCode}</td>
                      <td style={tdStyle}>{row.rate != null ? formatCurrency(row.rate) : '—'}</td>
                      <td style={tdStyle}>{row.hours != null ? row.hours.toFixed(2) : '—'}</td>
                      <td style={{ ...tdStyle, color: '#ff6b00' }}>{formatCurrency(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Group breakdown */}
          <div style={cardStyle}>
            <p style={{ ...cardLabelStyle, marginBottom: 12 }}>Pay Group Breakdown</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupBreakdown.map((g) => (
                <div key={g.groupName}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: '#cccccc' }}>{g.groupName}</span>
                    <span style={{ fontSize: 12, color: '#888888' }}>
                      {g.pct}% &nbsp;
                      <span style={{ color: '#ff6b00' }}>{formatCurrency(g.total)}</span>
                    </span>
                  </div>
                  <div style={{ height: 4, background: '#2a2a2a', borderRadius: 2 }}>
                    <div
                      style={{
                        height: 4,
                        width: `${g.pct}%`,
                        background: '#ff6b00',
                        borderRadius: 2,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Fuel section ── */}
      <SectionHeader style={{ marginTop: 32 }}>Fuel History</SectionHeader>

      {!hasFuel ? (
        <p style={{ color: '#888888', fontSize: 13 }}>No fuel transactions found for this employee.</p>
      ) : (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value as typeof vendorFilter)}
              style={selectStyle}
            >
              <option value="all">All Vendors</option>
              <option value="interstate">Interstate</option>
              <option value="flyers">Flyers</option>
            </select>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
              style={selectStyle}
            >
              <option value="all">All Time</option>
              <option value="1y">Last 12 Months</option>
              <option value="90d">Last 90 Days</option>
            </select>
          </div>

          {/* Fuel summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            <SummaryCard label="Total Transactions" value={String(filteredFuel.length)} />
            <SummaryCard label="Total Gallons" value={`${totalGallons.toFixed(0)} gal`} />
            <SummaryCard label="Total Cost" value={formatCurrency(totalFuelCost)} />
          </div>

          {/* Gallons chart */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <p style={cardLabelStyle}>Gallons per Week (last 13)</p>
            <BarChart
              data={weeklyGallons}
              color="#ff6b00"
              height={130}
              formatValue={(v) => `${v.toFixed(0)} gal`}
            />
          </div>

          {/* Location history table */}
          <div style={cardStyle}>
            <p style={{ ...cardLabelStyle, marginBottom: 12 }}>Transaction History</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Date', 'Vendor', 'Site', 'City, State', 'Product', 'Gallons', 'Cost'].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredFuel.map((row, i) => (
                    <tr
                      key={row.id}
                      style={{
                        borderTop: '1px solid #2a2a2a',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}
                    >
                      <td style={tdStyle}>{formatPeriod(row.transactionDate)}</td>
                      <td style={{ ...tdStyle, textTransform: 'capitalize' }}>{row.vendor}</td>
                      <td style={tdStyle}>{row.siteName ?? '—'}</td>
                      <td style={{ ...tdStyle, color: '#888888' }}>
                        {[row.siteCity, row.siteState].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td style={{ ...tdStyle, color: '#888888' }}>{row.product ?? '—'}</td>
                      <td style={tdStyle}>{row.gallons != null ? row.gallons.toFixed(3) : '—'}</td>
                      <td style={{ ...tdStyle, color: '#ff6b00' }}>{formatCurrency(row.totalWithTax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Pill({ children, color }: { children: React.ReactNode; color?: 'orange' }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 400,
        background: '#2a2a2a',
        color: color === 'orange' ? '#ff6b00' : '#cccccc',
        border: '1px solid #333333',
      }}
    >
      {children}
    </span>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={cardStyle}>
      <p style={cardLabelStyle}>{label}</p>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 500, color: '#ffffff' }}>{value}</p>
    </div>
  )
}

function SectionHeader({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <h2
      style={{
        fontSize: 14,
        fontWeight: 500,
        color: '#ffffff',
        margin: '0 0 12px 0',
        ...style,
      }}
    >
      {children}
    </h2>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#1e1e1e',
  borderRadius: 12,
  border: '1px solid #2a2a2a',
  padding: 16,
}

const cardLabelStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: 11,
  fontWeight: 400,
  color: '#888888',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 400,
  color: '#666666',
  paddingBottom: 8,
  paddingRight: 16,
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#cccccc',
  padding: '8px 16px 8px 0',
  whiteSpace: 'nowrap',
}

const selectStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #333333',
  borderRadius: 8,
  color: '#cccccc',
  fontSize: 12,
  padding: '5px 12px',
  cursor: 'pointer',
  outline: 'none',
}
