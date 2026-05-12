'use client'

import MetricCard from '@/components/ui/MetricCard'
import { formatCurrency, formatPercent } from '@/lib/utils/format'
import type { TabProps } from './types'

function r(n: number) { return Math.round(n * 100) / 100 }

export default function OverviewTab({ role, data, branches, allocationOn }: TabProps) {
  const isAdminOrExec = role === 'admin' || role === 'executive'

  // Derive totals — admin/exec use overview endpoint; managers derive from individual endpoints
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

  if (isAdminOrExec && data.overview) {
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

  // byPeriod chart data for grouped bar
  const periods = isAdminOrExec ? (data.overview?.byPeriod ?? []) : []

  // byBranch table
  const byBranch = isAdminOrExec ? (data.overview?.byBranch ?? []) : []
  const branchNameMap: Record<string, string> = {}
  for (const b of branches) branchNameMap[b.id] = b.name

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── KPI row ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
        {/* Hero: Gross Profit */}
        <MetricCard
          variant='hero'
          label='Gross Profit'
          sub={allocationOn ? 'After Corp/HQ Overhead' : undefined}
          value={formatCurrency(displayGP)}
          delta={`${displayGpPct >= 0 ? '' : ''}${formatPercent(displayGpPct)} margin`}
        />

        {/* Revenue */}
        <MetricCard
          label='Total Revenue'
          value={formatCurrency(revenue)}
        />

        {/* Payroll */}
        <MetricCard
          label='Total Payroll'
          sub={allocationOn ? 'Incl. Corp/HQ' : undefined}
          value={formatCurrency(totalPayroll)}
        />

        {/* Fuel */}
        <MetricCard
          label='Total Fuel'
          sub={allocationOn ? 'Incl. Corp/HQ' : undefined}
          value={formatCurrency(totalFuel)}
        />
      </div>

      {/* ── Allocation breakdown (when on) ────────────────────────────────────── */}
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

      {/* ── Weekly trend chart ────────────────────────────────────────────────── */}
      {periods.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Weekly Trend</div>
          <WeeklyTrendChart periods={periods} />
        </div>
      )}

      {/* ── Branch table (admin/exec/district multi-branch) ───────────────────── */}
      {byBranch.length > 1 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>By Branch</div>
          <BranchTable byBranch={byBranch} branchNameMap={branchNameMap} allocationOn={allocationOn} />
        </div>
      )}
    </div>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 14, color: '#ffffff', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

type PeriodRow = {
  periodDate: string
  revenue: number
  directPayroll: number
  adminPayroll: number
  employerTaxes: number
  fuel: number
}

function WeeklyTrendChart({ periods }: { periods: PeriodRow[] }) {
  // Simple grouped bar using inline divs (no recharts dependency here, keep it simple)
  const maxRevenue = Math.max(...periods.map((p) => p.revenue), 1)
  const labels = periods.map((p) => {
    const d = new Date(p.periodDate + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  })

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, minWidth: periods.length * 60 }}>
        {periods.map((p, i) => {
          const totalPayroll = p.directPayroll + p.adminPayroll + p.employerTaxes
          const revH = (p.revenue / maxRevenue) * 100
          const payH = (totalPayroll / maxRevenue) * 100
          const fuelH = (p.fuel / maxRevenue) * 100
          return (
            <div key={p.periodDate} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 40 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100, width: '100%', justifyContent: 'center' }}>
                <div title={`Revenue: ${formatCurrency(p.revenue)}`} style={{ width: 10, height: `${revH}%`, background: '#ff6b00', borderRadius: '2px 2px 0 0' }} />
                <div title={`Payroll: ${formatCurrency(totalPayroll)}`} style={{ width: 10, height: `${payH}%`, background: '#cc4444', borderRadius: '2px 2px 0 0', opacity: 0.8 }} />
                <div title={`Fuel: ${formatCurrency(p.fuel)}`} style={{ width: 10, height: `${fuelH}%`, background: '#cc4444', borderRadius: '2px 2px 0 0', opacity: 0.5 }} />
              </div>
              <div style={{ fontSize: 9, color: '#555555', marginTop: 4 }}>{labels[i]}</div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        <LegendDot color='#ff6b00' label='Revenue' />
        <LegendDot color='#cc4444' label='Payroll' />
        <LegendDot color='rgba(204,68,68,0.5)' label='Fuel' />
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 10, color: '#888888' }}>{label}</span>
    </div>
  )
}

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
