'use client'

import { useState, useEffect } from 'react'
import MetricCard from '@/components/ui/MetricCard'
import WeeklyChart from '@/components/charts/WeeklyChart'
import { formatCurrency } from '@/lib/utils/format'
import type { TabProps } from './types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export default function PayrollTab({ role, data, branches, allocationOn, startDate, endDate }: TabProps) {
  const isAdminOrExec = role === 'admin' || role === 'executive'

  // Exec/admin: payroll bucketed by item group × branch (ties out to Total Payroll)
  type MatrixRow = { name: string; isEarnings: boolean; byBranch: Record<string, number>; total: number }
  type GroupMatrix = {
    branches: { id: string; name: string }[]
    groups: MatrixRow[]
    gross: { byBranch: Record<string, number>; total: number }
    employerTax: { byBranch: Record<string, number>; total: number }
    grandTotal: number
  }
  const [matrix, setMatrix] = useState<GroupMatrix | null>(null)
  useEffect(() => {
    if (!isAdminOrExec || !startDate || !endDate) { setMatrix(null); return }
    let cancelled = false
    fetch(`/api/payroll/group-matrix?startDate=${startDate}&endDate=${endDate}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.success) setMatrix(j.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isAdminOrExec, startDate, endDate])

  // Direct Labor / Admin Payroll detail sections — collapsible, collapsed by default
  const [directOpen, setDirectOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)

  const pay = data.payroll
  if (!pay) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>No payroll data for this period.</div>
  }

  const branchNameMap: Record<string, string> = {}
  for (const b of branches) branchNameMap[b.id] = b.name

  const overviewTotals = data.overview?.totals
  const corpOverhead = allocationOn && isAdminOrExec ? (overviewTotals?.corpOverhead ?? 0) : 0
  const hqOverhead = allocationOn && isAdminOrExec ? (overviewTotals?.hqOverhead ?? 0) : 0

  const directTotal = pay.total.direct
  const adminTotal = pay.total.admin
  const taxesTotal = pay.total.taxes
  const totalPayroll = directTotal + adminTotal + taxesTotal + corpOverhead + hqOverhead

  const weeklyChartData = pay.byWeek.map((w) => ({
    date: w.periodDate,
    taxes: w.taxes,
    admin: w.admin,
    direct: w.direct,
  }))

  const weeklySeries = [
    { key: 'taxes', label: 'Taxes', color: 'var(--text-faint)', stackId: 'a' },
    { key: 'admin', label: 'Admin Payroll', color: 'var(--text-muted)', stackId: 'a' },
    { key: 'direct', label: 'Direct Labor', color: '#ff6b00', stackId: 'a' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── KPI row ──────────────────────────────────────────────────────────── */}
      <div className="dash-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MetricCard label='Direct Labor' value={formatCurrency(directTotal)} />
        <MetricCard label='Admin Payroll' value={formatCurrency(adminTotal)} />
        <MetricCard label='Employer Taxes' value={formatCurrency(taxesTotal)} />
        <MetricCard
          label='Total Payroll'
          sub={allocationOn && isAdminOrExec ? 'Incl. Corp/HQ' : undefined}
          value={formatCurrency(totalPayroll)}
        />
      </div>

      {/* ── Payroll by group × branch (exec/admin), tied out to Total Payroll ── */}
      {isAdminOrExec && matrix && matrix.grandTotal > 0 && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Payroll by Group &amp; Branch</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Ties to Total Payroll</div>
          </div>
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ ...mTh, textAlign: 'left' }}>Group</th>
                  {matrix.branches.map((b) => <th key={b.id} style={mTh}>{b.name}</th>)}
                  <th style={mTh}>Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.groups.filter((g) => g.isEarnings).map((g) => (
                  <tr key={g.name}>
                    <td style={{ ...mTd, textAlign: 'left', color: 'var(--text-secondary)' }}>{g.name}</td>
                    {matrix.branches.map((b) => <td key={b.id} style={mTd}>{cell(g.byBranch[b.id])}</td>)}
                    <td style={{ ...mTd, color: 'var(--text-primary)' }}>{cell(g.total)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...mTd, textAlign: 'left', color: 'var(--text-primary)', fontWeight: 600 }}>Gross</td>
                  {matrix.branches.map((b) => <td key={b.id} style={{ ...mTd, color: 'var(--text-primary)', fontWeight: 600 }}>{cell(matrix.gross.byBranch[b.id])}</td>)}
                  <td style={{ ...mTd, color: '#ff6b00', fontWeight: 600 }}>{cell(matrix.gross.total)}</td>
                </tr>
                {matrix.groups.filter((g) => !g.isEarnings).map((g) => (
                  <tr key={g.name}>
                    <td style={{ ...mTd, textAlign: 'left', color: 'var(--text-secondary)' }}>{g.name}</td>
                    {matrix.branches.map((b) => <td key={b.id} style={mTd}>{cell(g.byBranch[b.id])}</td>)}
                    <td style={{ ...mTd, color: 'var(--text-primary)' }}>{cell(g.total)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...mTd, textAlign: 'left', color: 'var(--text-secondary)' }}>Employer Taxes</td>
                  {matrix.branches.map((b) => <td key={b.id} style={mTd}>{cell(matrix.employerTax.byBranch[b.id])}</td>)}
                  <td style={{ ...mTd, color: 'var(--text-primary)' }}>{cell(matrix.employerTax.total)}</td>
                </tr>
                <tr style={{ borderTop: '1px solid var(--border-emphasis)' }}>
                  <td style={{ ...mTd, textAlign: 'left', color: 'var(--text-primary)', fontWeight: 600 }}>Total Payroll</td>
                  {matrix.branches.map((b) => {
                    const total = (matrix.gross.byBranch[b.id] ?? 0)
                      + matrix.groups.filter((g) => !g.isEarnings).reduce((s, g) => s + (g.byBranch[b.id] ?? 0), 0)
                      + (matrix.employerTax.byBranch[b.id] ?? 0)
                    return <td key={b.id} style={{ ...mTd, color: 'var(--text-primary)', fontWeight: 600 }}>{cell(total)}</td>
                  })}
                  <td style={{ ...mTd, color: '#ff6b00', fontWeight: 600 }}>{cell(matrix.grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.4 }}>
            Employer taxes are split to each branch by the employee&rsquo;s wage allocation. Branch columns and the grand Total tie out to the Total Payroll KPI.
          </div>
        </div>
      )}

      {/* Corp/HQ overhead breakdown */}
      {allocationOn && isAdminOrExec && (corpOverhead > 0 || hqOverhead > 0) && (
        <div style={{
          background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: '12px 16px',
          display: 'flex', gap: 32, alignItems: 'center',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Corp/HQ Overhead</div>
          <Stat label='Corp Payroll' value={formatCurrency(corpOverhead)} />
          <Stat label='HQ Payroll (SN share)' value={formatCurrency(hqOverhead)} />
        </div>
      )}

      {/* ── Weekly payroll chart ──────────────────────────────────────────────── */}
      {pay.byWeek.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Weekly Payroll</div>
          <WeeklyChart
            data={weeklyChartData}
            dateKey="date"
            series={weeklySeries}
            height={180}
            formatValue={(v) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          />
        </div>
      )}

      {/* ── Direct labor detail — collapsible drill-down table ─────────────────── */}
      {pay.total.directDetail && pay.total.directDetail.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
          <button
            onClick={() => setDirectOpen((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left' }}
          >
            <span style={{ display: 'inline-block', fontSize: 13, color: 'var(--text-faint)', transition: 'transform 180ms ease', transform: directOpen ? 'rotate(90deg)' : 'rotate(0deg)', lineHeight: 1 }}>›</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Direct Labor</span>
          </button>
          {directOpen && (
            <div style={{ marginTop: 12 }}>
              <DrilldownTable rows={pay.total.directDetail} branchNameMap={branchNameMap} />
            </div>
          )}
        </div>
      )}

      {/* ── Admin payroll detail — admin/exec only, collapsible ────────────────── */}
      {isAdminOrExec && pay.total.adminDetail && pay.total.adminDetail.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
          <button
            onClick={() => setAdminOpen((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left' }}
          >
            <span style={{ display: 'inline-block', fontSize: 13, color: 'var(--text-faint)', transition: 'transform 180ms ease', transform: adminOpen ? 'rotate(90deg)' : 'rotate(0deg)', lineHeight: 1 }}>›</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Admin Payroll</span>
          </button>
          {adminOpen && (
            <div style={{ marginTop: 12 }}>
              <DrilldownTable rows={pay.total.adminDetail} branchNameMap={branchNameMap} />
            </div>
          )}
        </div>
      )}

      {/* Managers: admin + taxes as lump-sum lines */}
      {!isAdminOrExec && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Admin Payroll (lump sum)</span>
            <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{formatCurrency(adminTotal)}</span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Employer Taxes</span>
            <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{formatCurrency(taxesTotal)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

// ── Drill-down employee table ─────────────────────────────────────────────────

type EmpRow = {
  employeeId: string
  displayName: string
  laborType: string
  amount: number
  hours: number | null
  rate: number | null
  branchId?: string | null
  periodDate?: string
}

function DrilldownTable({ rows, branchNameMap }: { rows: EmpRow[]; branchNameMap: Record<string, string> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Group by employeeId + branchId (an employee can appear in multiple branches via allocation)
  const grouped = new Map<string, EmpRow[]>()
  for (const row of rows) {
    const key = `${row.employeeId}|${row.branchId ?? ''}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(row)
  }

  const employees = [...grouped.entries()]
    .map(([key, items]) => ({
      key,
      displayName: items[0].displayName,
      branchId: items[0].branchId,
      totalHours: items.reduce((s, r) => s + (r.hours ?? 0), 0),
      totalAmount: items.reduce((s, r) => s + r.amount, 0),
      items: [...items].sort((a, b) => (a.periodDate ?? '').localeCompare(b.periodDate ?? '')),
      multipleWeeks: items.length > 1,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)

  const grandTotal = employees.reduce((s, e) => s + e.totalAmount, 0)
  const grandHours = employees.reduce((s, e) => s + e.totalHours, 0)

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key) } else { next.add(key) }
      return next
    })
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ width: 20, padding: '0 4px 8px 0' }} />
            <th style={{ ...th, textAlign: 'left' }}>Employee</th>
            <th style={th}>Branch</th>
            <th style={th}>Hours</th>
            <th style={th}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            const isOpen = expanded.has(emp.key)
            return (
              <EmpGroup
                key={emp.key}
                emp={emp}
                isOpen={isOpen}
                onToggle={() => toggle(emp.key)}
                branchNameMap={branchNameMap}
              />
            )
          })}
          <tr style={{ borderTop: '1px solid var(--border-emphasis)' }}>
            <td />
            <td colSpan={2} style={{ ...td, textAlign: 'left', color: 'var(--text-muted)', padding: '8px 8px 6px 0' }}>
              Total
            </td>
            <td style={{ ...td, color: 'var(--text-secondary)', padding: '8px 8px 6px 8px' }}>
              {grandHours > 0 ? grandHours.toFixed(2) : '—'}
            </td>
            <td style={{ ...td, color: '#ff6b00', fontWeight: 500, padding: '8px 0 6px 8px' }}>
              {formatCurrency(grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function EmpGroup({ emp, isOpen, onToggle, branchNameMap }: {
  emp: {
    key: string
    displayName: string
    branchId?: string | null
    totalHours: number
    totalAmount: number
    items: EmpRow[]
    multipleWeeks: boolean
  }
  isOpen: boolean
  onToggle: () => void
  branchNameMap: Record<string, string>
}) {
  return (
    <>
      <tr
        onClick={emp.multipleWeeks ? onToggle : undefined}
        style={{
          borderBottom: isOpen ? 'none' : '1px solid var(--border)',
          cursor: emp.multipleWeeks ? 'pointer' : 'default',
          background: isOpen ? '#222222' : 'transparent',
        }}
      >
        {/* Chevron */}
        <td style={{ padding: '8px 4px 8px 0', color: 'var(--text-faint)', width: 20 }}>
          {emp.multipleWeeks && (
            <span style={{
              display: 'inline-block',
              fontSize: 12,
              transition: 'transform 180ms ease',
              transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              lineHeight: 1,
            }}>
              ›
            </span>
          )}
        </td>
        <td style={{ ...td, textAlign: 'left', color: 'var(--text-secondary)' }}>{emp.displayName}</td>
        <td style={{ ...td, color: 'var(--text-muted)' }}>
          {emp.branchId ? (branchNameMap[emp.branchId] ?? '—') : '—'}
        </td>
        <td style={td}>{emp.totalHours > 0 ? emp.totalHours.toFixed(2) : '—'}</td>
        <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{formatCurrency(emp.totalAmount)}</td>
      </tr>

      {isOpen && emp.items.map((item, i) => (
        <tr
          key={`${emp.key}-${i}`}
          style={{
            background: 'var(--bg-nav)',
            borderBottom: i < emp.items.length - 1 ? '1px solid #222222' : '1px solid var(--border)',
          }}
        >
          <td />
          <td style={{ ...td, textAlign: 'left', color: 'var(--text-dim)', paddingLeft: 20 }}>
            {item.periodDate ? `Week of ${fmtDate(item.periodDate)}` : '—'}
          </td>
          <td style={{ ...td, color: 'var(--text-faint)' }}>
            {item.rate !== null ? `$${item.rate.toFixed(2)}/hr` : '—'}
          </td>
          <td style={{ ...td, color: 'var(--text-muted)' }}>
            {item.hours !== null ? item.hours.toFixed(2) : '—'}
          </td>
          <td style={{ ...td, color: 'var(--text-muted)' }}>{formatCurrency(item.amount)}</td>
        </tr>
      ))}
    </>
  )
}

const th: React.CSSProperties = { textAlign: 'right', padding: '0 8px 8px 8px', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }
const td: React.CSSProperties = { textAlign: 'right', padding: '8px 8px', color: 'var(--text-secondary)' }

// Group × branch matrix table
const mTh: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }
const mTd: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
function cell(v: number | undefined): string {
  return v ? formatCurrency(v) : '—'
}
