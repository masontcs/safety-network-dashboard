'use client'

import MetricCard from '@/components/ui/MetricCard'
import { formatCurrency, formatPercent } from '@/lib/utils/format'
import WaterfallChart from '@/components/charts/WaterfallChart'
import type { TabProps } from './types'

function r(n: number) { return Math.round(n * 100) / 100 }

export default function ProfitsTab({ role, data, branches, selectedBranchId, allocationOn }: TabProps) {
  const isAdminOrExec = role === 'admin' || role === 'executive'
  const branchNameMap: Record<string, string> = {}
  for (const b of branches) branchNameMap[b.id] = b.name

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
  let byBranch: Array<{
    branchId: string; revenue: number; directPayroll: number; adminPayroll: number
    employerTaxes: number; fuel: number; grossProfit: number; gpPct: number
    corpOverhead: number; hqOverhead: number; allocatedFuel: number; netAfterAlloc: number
  }> = []

  // Use overview (all-branch) only when no branch filter is active.
  // When a branch is selected, fall through to the branch-filtered individual API responses.
  if (isAdminOrExec && data.overview && !selectedBranchId) {
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
    byBranch = data.overview.byBranch
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

  const totalPayroll = r(directPayroll + adminPayroll + taxes)
  const adjPayroll = r(totalPayroll + corpOverhead + hqOverhead)
  const adjFuel = r(fuel + allocatedFuel)
  const netAfterAlloc = r(revenue - adjPayroll - adjFuel)
  const netMarginPct = revenue > 0 ? r((netAfterAlloc / revenue) * 100) : 0

  const displayGP = allocationOn && isAdminOrExec ? netAfterAlloc : grossProfit
  const displayPct = allocationOn && isAdminOrExec ? netMarginPct : gpPct

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── KPI row ──────────────────────────────────────────────────────────── */}
      <div className="dash-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MetricCard
          variant='hero'
          label={allocationOn && isAdminOrExec ? 'Net After Overhead' : 'Gross Profit'}
          value={formatCurrency(displayGP)}
          delta={`${formatPercent(displayPct)} margin`}
        />
        <MetricCard label='Revenue' value={formatCurrency(revenue)} />
        <MetricCard
          label='Total Payroll'
          sub={allocationOn && isAdminOrExec ? 'Incl. Corp/HQ' : undefined}
          value={formatCurrency(allocationOn && isAdminOrExec ? adjPayroll : totalPayroll)}
        />
        <MetricCard
          label='Total Fuel'
          sub={allocationOn && isAdminOrExec ? 'Incl. Corp/HQ' : undefined}
          value={formatCurrency(allocationOn && isAdminOrExec ? adjFuel : fuel)}
        />
      </div>

      {/* ── Waterfall chart ────────────────────────────────────────────────────── */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Profit Breakdown</div>
        <WaterfallChart
          revenue={revenue}
          payroll={allocationOn && isAdminOrExec ? adjPayroll : totalPayroll}
          fuel={allocationOn && isAdminOrExec ? adjFuel : fuel}
          height={220}
        />
      </div>

      {/* ── By-branch profit table ─────────────────────────────────────────────── */}
      {byBranch.length > 1 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Profits by Branch</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Branch</th>
                  <th style={th}>Revenue</th>
                  <th style={th}>Total Payroll</th>
                  <th style={th}>Fuel</th>
                  <th style={th}>Gross Profit</th>
                  <th style={th}>Margin</th>
                  {allocationOn && <th style={th}>Corp Alloc</th>}
                  {allocationOn && <th style={th}>HQ Alloc</th>}
                  {allocationOn && <th style={th}>Fuel Alloc</th>}
                  {allocationOn && <th style={th}>Net</th>}
                  {allocationOn && <th style={th}>Net Margin</th>}
                </tr>
              </thead>
              <tbody>
                {[...byBranch].sort((a, b) => b.revenue - a.revenue).map((b) => {
                  const branchTotalPayroll = r(b.directPayroll + b.adminPayroll + b.employerTaxes)
                  const netMgn = b.revenue > 0 && allocationOn
                    ? r((b.netAfterAlloc / b.revenue) * 100)
                    : 0
                  return (
                    <tr key={b.branchId} style={{ borderBottom: '1px solid #2a2a2a' }}>
                      <td style={{ ...td, textAlign: 'left', color: '#ff6b00' }}>{branchNameMap[b.branchId] ?? b.branchId}</td>
                      <td style={td}>{formatCurrency(b.revenue)}</td>
                      <td style={td}>{formatCurrency(branchTotalPayroll)}</td>
                      <td style={td}>{formatCurrency(b.fuel)}</td>
                      <td style={{ ...td, color: b.grossProfit >= 0 ? '#ffffff' : '#cc4444' }}>{formatCurrency(b.grossProfit)}</td>
                      <td style={td}>{formatPercent(b.gpPct)}</td>
                      {allocationOn && <td style={td}>{formatCurrency(b.corpOverhead)}</td>}
                      {allocationOn && <td style={td}>{formatCurrency(b.hqOverhead)}</td>}
                      {allocationOn && <td style={td}>{formatCurrency(b.allocatedFuel ?? 0)}</td>}
                      {allocationOn && (
                        <td style={{ ...td, color: b.netAfterAlloc >= 0 ? '#ffffff' : '#cc4444', fontWeight: 500 }}>
                          {formatCurrency(b.netAfterAlloc)}
                        </td>
                      )}
                      {allocationOn && <td style={td}>{formatPercent(netMgn)}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: '#666666', fontWeight: 400 }
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', color: '#cccccc' }
