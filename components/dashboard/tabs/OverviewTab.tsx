'use client'

import MetricCard from '@/components/ui/MetricCard'
import WeeklyChart from '@/components/charts/WeeklyChart'
import { formatCurrency, formatPercent } from '@/lib/utils/format'
import type { TabProps } from './types'

function r(n: number) { return Math.round(n * 100) / 100 }

export default function OverviewTab({ role, data, branches, selectedBranchId, allocationOn }: TabProps) {
  const isAdminOrExec = role === 'admin' || role === 'executive'

  let revenue = 0
  let directPayroll = 0
  let adminPayroll = 0
  let taxes = 0
  let fuel = 0
  let grossProfit = 0
  let gpPct = 0
  let corpOverhead = 0
  let hqOverhead = 0
  let allocatedFuel = 0

  const byBranch = isAdminOrExec ? (data.overview?.byBranch ?? []) : []
  const selectedBranch = selectedBranchId ? byBranch.find((b) => b.branchId === selectedBranchId) : null

  if (isAdminOrExec && data.overview) {
    // When a specific branch is selected, use that branch's data instead of all-branch totals
    const src = selectedBranch ?? data.overview.totals
    if (selectedBranch) {
      revenue = selectedBranch.revenue
      directPayroll = selectedBranch.directPayroll
      adminPayroll = selectedBranch.adminPayroll
      taxes = selectedBranch.employerTaxes
      fuel = selectedBranch.fuel
      grossProfit = selectedBranch.grossProfit
      gpPct = selectedBranch.gpPct
      corpOverhead = allocationOn ? (selectedBranch.corpOverhead ?? 0) : 0
      hqOverhead = allocationOn ? (selectedBranch.hqOverhead ?? 0) : 0
      allocatedFuel = allocationOn ? (selectedBranch.allocatedFuel ?? 0) : 0
    } else {
      const t = data.overview.totals
      revenue = t.revenue
      directPayroll = t.directPayroll
      adminPayroll = t.adminPayroll
      taxes = t.employerTaxes
      fuel = t.fuel
      grossProfit = t.grossProfit
      gpPct = t.gpPct
      corpOverhead = allocationOn ? (t.corpOverhead ?? 0) : 0
      hqOverhead = allocationOn ? (t.hqOverhead ?? 0) : 0
      allocatedFuel = allocationOn ? (t.allocatedFuel ?? 0) : 0
    }
    void src
  } else if (data.revenue && data.payroll && data.fuelSummary) {
    revenue = data.revenue.totalRevenue
    directPayroll = data.payroll.total.direct
    adminPayroll = data.payroll.total.admin
    taxes = data.payroll.total.taxes
    fuel = data.fuelSummary.totalWithTax
    const totalCost = directPayroll + adminPayroll + taxes + fuel
    grossProfit = r(revenue - totalCost)
    gpPct = revenue > 0 ? r((grossProfit / revenue) * 100) : 0
  }

  const totalPayroll = r(directPayroll + adminPayroll + taxes + corpOverhead + hqOverhead)
  const totalFuel = r(fuel + allocatedFuel)
  const adjGrossProfit = r(revenue - totalPayroll - totalFuel)
  const adjGpPct = revenue > 0 ? r((adjGrossProfit / revenue) * 100) : 0

  const displayGP = allocationOn ? adjGrossProfit : grossProfit
  const displayGpPct = allocationOn ? adjGpPct : gpPct

  // Build the weekly trend periods. When a branch is selected, reconstruct from branch's
  // per-period arrays so the chart reflects only that branch's data.
  const periods = (() => {
    if (!isAdminOrExec) return []
    if (selectedBranch) {
      const revMap = new Map(selectedBranch.revenueByPeriod.map((p) => [p.periodDate, p.revenue]))
      const payMap = new Map(selectedBranch.payrollByPeriod.map((p) => [p.periodDate, p.payroll]))
      const fuelMap = new Map(selectedBranch.fuelByPeriod.map((p) => [p.periodDate, p.fuel]))
      const allDates = new Set([...revMap.keys(), ...payMap.keys(), ...fuelMap.keys()])
      return [...allDates].sort().map((periodDate) => ({
        periodDate,
        revenue: revMap.get(periodDate) ?? 0,
        directPayroll: payMap.get(periodDate) ?? 0,
        adminPayroll: 0,
        employerTaxes: 0,
        fuel: fuelMap.get(periodDate) ?? 0,
      }))
    }
    return data.overview?.byPeriod ?? []
  })()
  const branchNameMap: Record<string, string> = {}
  for (const b of branches) branchNameMap[b.id] = b.name

  // ── Manager-specific derived data ─────────────────────────────────────────
  const avgPpg = !isAdminOrExec && data.fuelSummary && data.fuelSummary.totalGallons > 0
    ? data.fuelSummary.totalWithTax / data.fuelSummary.totalGallons
    : null

  // Merge weekly data from individual endpoints for managers
  const managerWeeklyPeriods = (() => {
    if (isAdminOrExec) return []
    const revByDate = new Map<string, number>()
    for (const t of data.revenue?.transactions ?? []) {
      revByDate.set(t.period_date, (revByDate.get(t.period_date) ?? 0) + t.total_revenue)
    }
    const payByDate = new Map<string, { direct: number; admin: number; taxes: number }>()
    for (const w of data.payroll?.byWeek ?? []) {
      payByDate.set(w.periodDate, { direct: w.direct, admin: w.admin, taxes: w.taxes })
    }
    const fuelByDate = new Map<string, number>()
    for (const w of data.fuelByWeek ?? []) {
      fuelByDate.set(w.weekEndDate, w.totalCost)
    }
    const allDates = new Set([...revByDate.keys(), ...payByDate.keys(), ...fuelByDate.keys()])
    return [...allDates].sort().map((date) => {
      const pay = payByDate.get(date)
      return {
        date,
        revenue: revByDate.get(date) ?? 0,
        payroll: pay ? pay.direct + pay.admin + pay.taxes : 0,
        fuel: fuelByDate.get(date) ?? 0,
      }
    })
  })()

  // Branch breakdown for district managers (from revenue transactions + payroll detail)
  const managerByBranch = (() => {
    if (isAdminOrExec) return []
    const revByBranch = new Map<string, number>()
    for (const t of data.revenue?.transactions ?? []) {
      revByBranch.set(t.branch_id, (revByBranch.get(t.branch_id) ?? 0) + t.total_revenue)
    }
    const directByBranch = new Map<string, number>()
    for (const item of data.payroll?.total.directDetail ?? []) {
      if (item.branchId) {
        directByBranch.set(item.branchId, (directByBranch.get(item.branchId) ?? 0) + item.amount)
      }
    }
    const branchIds = new Set([...revByBranch.keys(), ...directByBranch.keys()])
    if (branchIds.size <= 1) return []
    return [...branchIds]
      .map((id) => ({
        id,
        revenue: revByBranch.get(id) ?? 0,
        directPayroll: directByBranch.get(id) ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  })()

  const topConsumers = !isAdminOrExec ? (data.fuelConsumers ?? []).slice(0, 5) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── KPI row ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
        <MetricCard
          variant='hero'
          label='Gross Profit'
          sub={allocationOn ? 'After Corp/HQ Overhead' : undefined}
          value={formatCurrency(displayGP)}
          delta={`${formatPercent(displayGpPct)} margin`}
        />
        <MetricCard label='Total Revenue' value={formatCurrency(revenue)} />
        <MetricCard
          label='Total Payroll'
          sub={allocationOn ? 'Incl. Corp/HQ' : undefined}
          value={formatCurrency(totalPayroll)}
        />
        <MetricCard
          label='Total Fuel'
          sub={allocationOn ? 'Incl. Corp/HQ' : undefined}
          value={formatCurrency(totalFuel)}
        />
      </div>

      {/* ── Manager: second KPI row ───────────────────────────────────────────── */}
      {!isAdminOrExec && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <MetricCard
            label='Direct Labor'
            value={formatCurrency(directPayroll)}
            delta={revenue > 0 ? `${formatPercent((directPayroll / revenue) * 100)} of revenue` : undefined}
          />
          <MetricCard
            label='Admin Payroll'
            value={formatCurrency(adminPayroll)}
            delta={revenue > 0 ? `${formatPercent((adminPayroll / revenue) * 100)} of revenue` : undefined}
          />
          <MetricCard
            label='Employer Taxes'
            value={formatCurrency(taxes)}
            delta={revenue > 0 ? `${formatPercent((taxes / revenue) * 100)} of revenue` : undefined}
          />
          <MetricCard
            label='Avg Cost / Gallon'
            value={avgPpg !== null ? `$${avgPpg.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}` : '—'}
            delta={data.fuelSummary && data.fuelSummary.totalGallons > 0
              ? `${data.fuelSummary.totalGallons.toLocaleString('en-US', { maximumFractionDigits: 0 })} gal total`
              : undefined}
          />
        </div>
      )}

      {/* ── Allocation breakdown (admin/exec) ────────────────────────────────── */}
      {allocationOn && isAdminOrExec && (corpOverhead > 0 || hqOverhead > 0 || allocatedFuel > 0) && (
        <div style={{
          background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: '12px 16px',
          display: 'flex', gap: 32, alignItems: 'center',
        }}>
          <div style={{ fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Allocation Breakdown</div>
          <Item label='Corp Payroll' value={formatCurrency(corpOverhead)} />
          <Item label='HQ Payroll' value={formatCurrency(hqOverhead)} />
          <Item label='Corp/HQ Fuel' value={formatCurrency(allocatedFuel)} />
          <Item label='Total Overhead' value={formatCurrency(corpOverhead + hqOverhead + allocatedFuel)} />
        </div>
      )}

      {/* ── Admin/exec: weekly trend ──────────────────────────────────────────── */}
      {periods.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Weekly Trend</div>
          <WeeklyChart
            data={periods.map((p) => ({
              date: p.periodDate,
              revenue: p.revenue,
              payroll: p.directPayroll + p.adminPayroll + p.employerTaxes,
              fuel: p.fuel,
            }))}
            dateKey="date"
            series={[
              { key: 'revenue', label: 'Revenue', color: '#ff6b00' },
              { key: 'payroll', label: 'Payroll', color: '#cc4444', opacity: 0.8 },
              { key: 'fuel', label: 'Fuel', color: '#cc4444', opacity: 0.45 },
            ]}
            height={180}
            formatValue={(v) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          />
        </div>
      )}

      {/* ── Manager: cost breakdown ───────────────────────────────────────────── */}
      {!isAdminOrExec && revenue > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 16 }}>Revenue Breakdown</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CostBar label='Direct Labor' amount={directPayroll} total={revenue} color='#cc4444' />
            <CostBar label='Admin Payroll' amount={adminPayroll} total={revenue} color='#cc4444' opacity={0.75} />
            <CostBar label='Employer Taxes' amount={taxes} total={revenue} color='#cc4444' opacity={0.5} />
            <CostBar label='Fuel' amount={fuel} total={revenue} color='#cc6644' opacity={0.8} />
            <CostBar label='Gross Profit' amount={grossProfit} total={revenue} color='#ff6b00' />
          </div>
        </div>
      )}

      {/* ── Manager: weekly trend ─────────────────────────────────────────────── */}
      {!isAdminOrExec && managerWeeklyPeriods.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Weekly Trend</div>
          <WeeklyChart
            data={managerWeeklyPeriods.map((p) => ({
              date: p.date,
              revenue: p.revenue,
              payroll: p.payroll,
              fuel: p.fuel,
            }))}
            dateKey="date"
            series={[
              { key: 'revenue', label: 'Revenue', color: '#ff6b00' },
              { key: 'payroll', label: 'Payroll', color: '#cc4444', opacity: 0.8 },
              { key: 'fuel', label: 'Fuel', color: '#cc4444', opacity: 0.45 },
            ]}
            height={180}
            formatValue={(v) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          />
        </div>
      )}

      {/* ── Manager: branch breakdown (district managers) ─────────────────────── */}
      {!isAdminOrExec && managerByBranch.length > 1 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>By Branch</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Branch</th>
                <th style={th}>Revenue</th>
                <th style={th}>Direct Labor</th>
                <th style={th}>Labor %</th>
                <th style={th}>Gross Profit</th>
                <th style={th}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {managerByBranch.map((b) => {
                const gp = r(b.revenue - b.directPayroll)
                const gpPct = b.revenue > 0 ? r((gp / b.revenue) * 100) : 0
                const laborPct = b.revenue > 0 ? r((b.directPayroll / b.revenue) * 100) : 0
                return (
                  <tr key={b.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
                    <td style={{ ...td, textAlign: 'left', color: '#ff6b00' }}>{branchNameMap[b.id] ?? b.id}</td>
                    <td style={td}>{formatCurrency(b.revenue)}</td>
                    <td style={td}>{formatCurrency(b.directPayroll)}</td>
                    <td style={td}>{formatPercent(laborPct)}</td>
                    <td style={{ ...td, color: gp >= 0 ? '#ffffff' : '#cc4444', fontWeight: 500 }}>{formatCurrency(gp)}</td>
                    <td style={{ ...td, color: gpPct >= 0 ? '#ff6b00' : '#cc4444' }}>{formatPercent(gpPct)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Manager: top fuel consumers ───────────────────────────────────────── */}
      {!isAdminOrExec && topConsumers.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Top Fuel Consumers</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Employee</th>
                <th style={th}>Gallons</th>
                <th style={th}>$/Gal</th>
                <th style={th}>Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {topConsumers.map((c, i) => (
                <tr key={`${c.employeeId ?? 'gen'}-${i}`} style={{ borderBottom: '1px solid #2a2a2a' }}>
                  <td style={{ ...td, textAlign: 'left', color: c.isGeneral ? '#888888' : '#cccccc', fontStyle: c.isGeneral ? 'italic' : 'normal' }}>
                    {c.displayName}
                  </td>
                  <td style={td}>{c.totalGallons.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                  <td style={td}>{c.avgPpg != null ? `$${c.avgPpg.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}` : '—'}</td>
                  <td style={{ ...td, color: '#ffffff', fontWeight: 500 }}>{formatCurrency(c.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Admin/exec: branch table ──────────────────────────────────────────── */}
      {byBranch.length > 1 && !selectedBranchId && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>By Branch</div>
          <BranchTable byBranch={byBranch} branchNameMap={branchNameMap} allocationOn={allocationOn} />
        </div>
      )}
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 14, color: '#ffffff', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function CostBar({ label, amount, total, color, opacity = 1 }: {
  label: string; amount: number; total: number; color: string; opacity?: number
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (amount / total) * 100)) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 120, fontSize: 12, color: '#888888', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: 6, background: '#2a2a2a', borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, opacity, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ width: 72, fontSize: 12, color: '#cccccc', textAlign: 'right', flexShrink: 0 }}>
        {formatCurrency(amount)}
      </div>
      <div style={{ width: 44, fontSize: 11, color: '#555555', textAlign: 'right', flexShrink: 0 }}>
        {formatPercent(pct)}
      </div>
    </div>
  )
}

// ── Admin/exec branch table ───────────────────────────────────────────────────

type BranchRow = {
  branchId: string
  revenue: number
  directPayroll: number
  adminPayroll: number
  employerTaxes: number
  fuel: number
  grossProfit: number
  gpPct: number
  corpOverhead: number
  hqOverhead: number
  allocatedFuel: number
  netAfterAlloc: number
}

function BranchTable({ byBranch, branchNameMap, allocationOn }: {
  byBranch: BranchRow[]
  branchNameMap: Record<string, string>
  allocationOn: boolean
}) {
  const sorted = [...byBranch].sort((a, b) => b.revenue - a.revenue)

  const baseColumns: Array<{ key: keyof BranchRow; label: string }> = [
    { key: 'revenue', label: 'Revenue' },
    { key: 'directPayroll', label: 'Dir. Labor' },
    { key: 'adminPayroll', label: 'Admin Pay' },
    { key: 'employerTaxes', label: 'Taxes' },
    { key: 'fuel', label: 'Fuel' },
    { key: 'grossProfit', label: 'Gross Profit' },
    { key: 'gpPct', label: 'Margin' },
  ]

  const allocColumns: Array<{ key: keyof BranchRow; label: string }> = [
    { key: 'corpOverhead', label: 'Corp Alloc' },
    { key: 'hqOverhead', label: 'HQ Alloc' },
    { key: 'allocatedFuel', label: 'Fuel Alloc' },
    { key: 'netAfterAlloc', label: 'Net' },
  ]

  const columns = allocationOn ? [...baseColumns, ...allocColumns] : baseColumns

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th}>Branch</th>
            {columns.map((c) => <th key={c.key} style={th}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((b) => (
            <tr key={b.branchId} style={{ borderBottom: '1px solid #2a2a2a' }}>
              <td style={{ ...td, color: '#ff6b00' }}>{branchNameMap[b.branchId] ?? b.branchId}</td>
              {columns.map((c) => (
                <td key={c.key} style={td}>
                  {c.key === 'gpPct'
                    ? formatPercent(b.gpPct)
                    : formatCurrency(b[c.key] as number)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: '#666666', fontWeight: 400, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', color: '#cccccc' }
