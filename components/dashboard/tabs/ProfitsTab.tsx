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
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Profit Breakdown</div>
        <WaterfallChart
          revenue={revenue}
          payroll={allocationOn && isAdminOrExec ? adjPayroll : totalPayroll}
          fuel={allocationOn && isAdminOrExec ? adjFuel : fuel}
          height={220}
        />
      </div>

      {/* ── Goals by branch ────────────────────────────────────────────────────── */}
      <GoalsByBranch
        byBranch={byBranch}
        targets={data.targets ?? []}
        branchNameMap={branchNameMap}
        singleBranchRevenue={byBranch.length === 0 ? revenue : null}
        singleBranchGpPct={byBranch.length === 0 ? gpPct : null}
        selectedBranchId={selectedBranchId}
      />

      {/* ── By-branch profit table ─────────────────────────────────────────────── */}
      {byBranch.length > 1 && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Profits by Branch</div>
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
                    <tr key={b.branchId} style={{ borderBottom: '1px solid var(--border)' }}>
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

// ── Variance color helper ─────────────────────────────────────────────────────

function varianceColor(actual: number, target: number): string {
  if (actual >= target) return '#4caf50'
  const miss = (target - actual) / target
  if (miss <= 0.05) return '#4caf50'
  if (miss <= 0.15) return '#cc9900'
  return '#cc4444'
}

function gpVarianceColor(actual: number, target: number): string {
  const diff = actual - target
  if (diff >= 0) return '#4caf50'
  if (diff >= -2) return '#cc9900'
  return '#cc4444'
}

function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color,
      background: `${color}22`,
      borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function revStatus(actual: number, target: number) {
  if (actual >= target) return <StatusPill label="On Target" color="#4caf50" />
  const miss = (target - actual) / target
  if (miss <= 0.05) return <StatusPill label="Close" color="#cc9900" />
  if (miss <= 0.15) return <StatusPill label="Behind" color="#cc9900" />
  return <StatusPill label="Off Track" color="#cc4444" />
}

function gpStatus(actual: number, target: number) {
  const diff = actual - target
  if (diff >= 0) return <StatusPill label="On Target" color="#4caf50" />
  if (diff >= -2) return <StatusPill label="Close" color="#cc9900" />
  return <StatusPill label="Off Track" color="#cc4444" />
}

function combinedStatus(
  revActual: number, revTarget: number | null,
  gpActual: number,  gpTarget: number | null,
): React.ReactNode {
  const hasRev = revTarget != null
  const hasGp  = gpTarget != null
  if (!hasRev && !hasGp) return '—'

  const revOk  = !hasRev || revActual >= revTarget
  const gpOk   = !hasGp  || gpActual  >= gpTarget
  const revMiss = hasRev && revTarget > 0 ? (revTarget - revActual) / revTarget : 0

  if (revOk && gpOk)   return <StatusPill label="On Target"   color="#4caf50" />
  if (revOk && !gpOk)  return <StatusPill label="Low Margin"  color="#ff9800" />
  if (!revOk && gpOk)  return <StatusPill label="Low Revenue" color={revMiss > 0.15 ? '#cc4444' : '#cc9900'} />
  if (revMiss <= 0.15) return <StatusPill label="Behind"      color="#cc9900" />
  return                      <StatusPill label="Off Track"   color="#cc4444" />
}

// ── Goals by Branch component ─────────────────────────────────────────────────

type ByBranchRow = {
  branchId: string; revenue: number; grossProfit: number; gpPct: number
}
type BranchTargetRow = {
  branchId: string; revenueTarget: number | null; profitPctTarget: number | null
}

function GoalsByBranch({
  byBranch, targets, branchNameMap,
  singleBranchRevenue, singleBranchGpPct, selectedBranchId,
}: {
  byBranch: ByBranchRow[]
  targets: BranchTargetRow[]
  branchNameMap: Record<string, string>
  singleBranchRevenue: number | null
  singleBranchGpPct: number | null
  selectedBranchId: string
}) {
  if (targets.length === 0) return null

  const targetMap = new Map(targets.map((t) => [t.branchId, t]))

  // Multi-branch view: join byBranch actuals with targets
  if (byBranch.length > 0) {
    // Collect all branches that appear in either actuals or targets
    const allIds = [...new Set([...byBranch.map((b) => b.branchId), ...targets.map((t) => t.branchId)])]
    const actualMap = new Map(byBranch.map((b) => [b.branchId, b]))

    const rows = allIds
      .map((id) => ({
        id,
        name: branchNameMap[id] ?? id,
        actual: actualMap.get(id) ?? null,
        target: targetMap.get(id) ?? null,
      }))
      // Show all branches that have actuals OR targets — no branch with real revenue is hidden
      .filter((r) => r.actual !== null || r.target !== null)
      .sort((a, b) => (b.actual?.revenue ?? 0) - (a.actual?.revenue ?? 0))

    if (rows.length === 0) return null

    const totalRevTarget = rows.reduce((s, r) => s + (r.target?.revenueTarget ?? 0), 0)
    const totalRevActual = rows.reduce((s, r) => s + (r.actual?.revenue ?? 0), 0)
    const totalGP = rows.reduce((s, r) => s + (r.actual?.grossProfit ?? 0), 0)
    const blendedGpActual = totalRevActual > 0 ? Math.round((totalGP / totalRevActual) * 1000) / 10 : 0
    const gpGoalRows = rows.filter((r) => r.target?.profitPctTarget != null)
    const avgGpGoal = gpGoalRows.length > 0
      ? Math.round(gpGoalRows.reduce((s, r) => s + r.target!.profitPctTarget!, 0) / gpGoalRows.length * 10) / 10
      : null

    return (
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Goals by Branch</div>
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Branch</th>
                <th style={th}>Rev Target</th>
                <th style={th}>Actual Rev</th>
                <th style={th}>vs. Target</th>
                <th style={th}>GP% Goal</th>
                <th style={th}>Actual GP%</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, name, actual, target }) => {
                const revTarget = target?.revenueTarget ?? null
                const gpTarget  = target?.profitPctTarget ?? null
                const revActual = actual?.revenue ?? 0
                const gpActual  = actual?.gpPct ?? 0
                const revDelta  = revTarget != null ? revActual - revTarget : null
                return (
                  <tr key={id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...td, textAlign: 'left', color: '#ff6b00' }}>{name}</td>
                    <td style={td}>{revTarget != null ? formatCurrency(revTarget) : <span style={{ color: '#444' }}>—</span>}</td>
                    <td style={{ ...td, color: 'var(--text-primary)' }}>{formatCurrency(revActual)}</td>
                    <td style={{ ...td, color: revDelta != null ? varianceColor(revActual, revTarget!) : '#666' }}>
                      {revDelta != null ? `${revDelta >= 0 ? '+' : ''}${formatCurrency(revDelta)}` : '—'}
                    </td>
                    <td style={td}>{gpTarget != null ? `${gpTarget}%` : <span style={{ color: '#444' }}>—</span>}</td>
                    <td style={{ ...td, color: gpTarget != null ? gpVarianceColor(gpActual, gpTarget) : '#cccccc' }}>
                      {formatPercent(gpActual)}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {(revTarget != null || gpTarget != null) ? combinedStatus(revActual, revTarget, gpActual, gpTarget) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '1px solid var(--border-emphasis)' }}>
                <td style={{ ...td, textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>Total</td>
                <td style={{ ...td, color: 'var(--text-muted)' }}>{formatCurrency(totalRevTarget)}</td>
                <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{formatCurrency(totalRevActual)}</td>
                <td style={{ ...td, color: varianceColor(totalRevActual, totalRevTarget), fontWeight: 500 }}>
                  {`${totalRevActual - totalRevTarget >= 0 ? '+' : ''}${formatCurrency(totalRevActual - totalRevTarget)}`}
                </td>
                <td style={{ ...td, color: 'var(--text-muted)' }}>{avgGpGoal != null ? `${avgGpGoal}%` : '—'}</td>
                <td style={{ ...td, fontWeight: 500, color: avgGpGoal != null ? gpVarianceColor(blendedGpActual, avgGpGoal) : '#ffffff' }}>
                  {formatPercent(blendedGpActual)}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{combinedStatus(totalRevActual, totalRevTarget, blendedGpActual, avgGpGoal ?? null)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    )
  }

  // Single-branch view
  if (selectedBranchId && singleBranchRevenue !== null && singleBranchGpPct !== null) {
    const target = targetMap.get(selectedBranchId)
    if (!target) return null
    const revTarget = target.revenueTarget
    const gpTarget  = target.profitPctTarget
    const revDelta  = revTarget != null ? singleBranchRevenue - revTarget : null
    return (
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Goals</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {revTarget != null && (
            <div style={{ flex: '1 1 160px', background: 'var(--bg-secondary)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Revenue vs. Target</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{formatCurrency(singleBranchRevenue)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Target: {formatCurrency(revTarget)}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: varianceColor(singleBranchRevenue, revTarget), marginTop: 6 }}>
                {revDelta! >= 0 ? '+' : ''}{formatCurrency(revDelta!)}
              </div>
              <div style={{ marginTop: 8 }}>{revStatus(singleBranchRevenue, revTarget)}</div>
            </div>
          )}
          {gpTarget != null && (
            <div style={{ flex: '1 1 160px', background: 'var(--bg-secondary)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>GP% vs. Target</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: gpVarianceColor(singleBranchGpPct, gpTarget) }}>{formatPercent(singleBranchGpPct)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Target: {gpTarget}%</div>
              <div style={{ marginTop: 8 }}>{gpStatus(singleBranchGpPct, gpTarget)}</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)' }
