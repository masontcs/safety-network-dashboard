'use client'

import MetricCard from '@/components/ui/MetricCard'
import { formatCurrency, formatPercent } from '@/lib/utils/format'
import type { TabProps } from './types'

export default function RevenueTab({ data, branches, isMultiBranch, monthSaturdays, selectedBranchId }: TabProps) {
  const rev = data.revenue
  if (!rev) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>No revenue data for this period.</div>
  }

  const branchNameMap: Record<string, string> = {}
  for (const b of branches) branchNameMap[b.id] = b.name

  // Compute byPeriod from transactions
  const byPeriodMap: Record<string, { total: number; labor: number; rental: number; oneTime: number }> = {}
  for (const t of rev.transactions ?? []) {
    const key = t.period_date
    if (!byPeriodMap[key]) byPeriodMap[key] = { total: 0, labor: 0, rental: 0, oneTime: 0 }
    byPeriodMap[key].total += t.total_revenue
    byPeriodMap[key].labor += t.labor
    byPeriodMap[key].rental += t.rental
    byPeriodMap[key].oneTime += t.one_time_charges
  }

  const byPeriod = Object.entries(byPeriodMap)
    .map(([periodDate, v]) => ({ periodDate, ...v }))
    .sort((a, b) => a.periodDate.localeCompare(b.periodDate))

  // Compute byBranch from transactions
  const byBranchMap: Record<string, { total: number; labor: number; rental: number; oneTime: number }> = {}
  for (const t of rev.transactions ?? []) {
    const bid = t.branch_id
    if (!byBranchMap[bid]) byBranchMap[bid] = { total: 0, labor: 0, rental: 0, oneTime: 0 }
    byBranchMap[bid].total += t.total_revenue
    byBranchMap[bid].labor += t.labor
    byBranchMap[bid].rental += t.rental
    byBranchMap[bid].oneTime += t.one_time_charges
  }

  const byBranch = Object.entries(byBranchMap)
    .map(([branchId, v]) => ({ branchId, ...v }))
    .sort((a, b) => b.total - a.total)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── KPI row ──────────────────────────────────────────────────────────── */}
      <div className="dash-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MetricCard label='Total Revenue' value={formatCurrency(rev.totalRevenue)} />
        <MetricCard
          label='Labor'
          value={formatCurrency(rev.labor)}
          delta={rev.totalRevenue > 0 ? `${formatPercent((rev.labor / rev.totalRevenue) * 100)} of total` : '—'}
        />
        <MetricCard
          label='Rental'
          value={formatCurrency(rev.rental)}
          delta={rev.totalRevenue > 0 ? `${formatPercent((rev.rental / rev.totalRevenue) * 100)} of total` : '—'}
        />
        <MetricCard
          label='One-Time'
          value={formatCurrency(rev.oneTimeCharges)}
          delta={rev.totalRevenue > 0 ? `${formatPercent((rev.oneTimeCharges / rev.totalRevenue) * 100)} of total` : '—'}
        />
      </div>

      {/* ── Revenue goals ─────────────────────────────────────────────────────── */}
      {(data.targets ?? []).length > 0 && (
        <RevenueGoals
          targets={data.targets ?? []}
          byBranch={byBranch}
          totalRevenue={rev.totalRevenue}
          selectedBranchId={selectedBranchId}
          branchNameMap={branchNameMap}
        />
      )}

      {/* ── Weekly table (month view uses monthSaturdays) ──────────────────────── */}
      {monthSaturdays.length > 0 ? (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Weekly Revenue</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={th}>Week Ending</th>
                <th style={th}>Labor</th>
                <th style={th}>Rental</th>
                <th style={th}>One-Time</th>
                <th style={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {monthSaturdays.map((sat) => {
                const p = byPeriodMap[sat]
                return (
                  <tr key={sat} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...td, color: 'var(--text-secondary)' }}>{fmtDate(sat)}</td>
                    <td style={td}>{p ? formatCurrency(p.labor) : '—'}</td>
                    <td style={td}>{p ? formatCurrency(p.rental) : '—'}</td>
                    <td style={td}>{p ? formatCurrency(p.oneTime) : '—'}</td>
                    <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{p && p.total > 0 ? formatCurrency(p.total) : '—'}</td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '1px solid var(--border-emphasis)' }}>
                <td style={{ ...td, color: 'var(--text-muted)' }}>Total</td>
                <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{formatCurrency(rev.labor)}</td>
                <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{formatCurrency(rev.rental)}</td>
                <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{formatCurrency(rev.oneTimeCharges)}</td>
                <td style={{ ...td, color: '#ff6b00', fontWeight: 500 }}>{formatCurrency(rev.totalRevenue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : byPeriod.length > 0 ? (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Revenue by Week</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={th}>Week Ending</th>
                <th style={th}>Labor</th>
                <th style={th}>Rental</th>
                <th style={th}>One-Time</th>
                <th style={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {byPeriod.map((p) => (
                <tr key={p.periodDate} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...td, color: 'var(--text-secondary)' }}>{fmtDate(p.periodDate)}</td>
                  <td style={td}>{formatCurrency(p.labor)}</td>
                  <td style={td}>{formatCurrency(p.rental)}</td>
                  <td style={td}>{formatCurrency(p.oneTime)}</td>
                  <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{formatCurrency(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ── By-branch table ───────────────────────────────────────────────────── */}
      {isMultiBranch && byBranch.length > 1 && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Revenue by Branch</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Branch</th>
                <th style={th}>Labor</th>
                <th style={th}>Rental</th>
                <th style={th}>One-Time</th>
                <th style={th}>Total</th>
                <th style={th}>% Share</th>
              </tr>
            </thead>
            <tbody>
              {byBranch.map((b) => (
                <tr key={b.branchId} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...td, textAlign: 'left', color: '#ff6b00' }}>{branchNameMap[b.branchId] ?? b.branchId}</td>
                  <td style={td}>{formatCurrency(b.labor)}</td>
                  <td style={td}>{formatCurrency(b.rental)}</td>
                  <td style={td}>{formatCurrency(b.oneTime)}</td>
                  <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{formatCurrency(b.total)}</td>
                  <td style={td}>{rev.totalRevenue > 0 ? formatPercent((b.total / rev.totalRevenue) * 100) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`
}

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)' }

// ── Revenue goals ─────────────────────────────────────────────────────────────

type TargetRow = { branchId: string; revenueTarget: number | null; profitPctTarget: number | null }

function varianceColor(actual: number, target: number): string {
  if (actual >= target) return '#4caf50'
  const miss = (target - actual) / target
  if (miss <= 0.05) return '#4caf50'
  if (miss <= 0.15) return '#cc9900'
  return '#cc4444'
}

function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color, background: `${color}22`, borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>
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

function RevenueGoals({
  targets, byBranch, totalRevenue, selectedBranchId, branchNameMap,
}: {
  targets: TargetRow[]
  byBranch: Array<{ branchId: string; total: number }>
  totalRevenue: number
  selectedBranchId: string
  branchNameMap: Record<string, string>
}) {
  if (targets.length === 0) return null
  const targetMap = new Map(targets.map((t) => [t.branchId, t]))

  // Multi-branch: table
  if (byBranch.length > 1) {
    const allIds = [...new Set([...byBranch.map((b) => b.branchId), ...targets.map((t) => t.branchId)])]
    const actualMap = new Map(byBranch.map((b) => [b.branchId, b.total]))
    const rows = allIds
      .map((id) => ({ id, name: branchNameMap[id] ?? id, revActual: actualMap.get(id) ?? 0, target: targetMap.get(id) ?? null }))
      .filter((r) => r.target)
      .sort((a, b) => b.revActual - a.revActual)
    if (rows.length === 0) return null

    const totalRevTarget = rows.reduce((s, r) => s + (r.target?.revenueTarget ?? 0), 0)
    const totalRevActual = rows.reduce((s, r) => s + r.revActual, 0)

    return (
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Revenue Goals by Branch</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Branch</th>
              <th style={th}>Target</th>
              <th style={th}>Actual</th>
              <th style={th}>vs. Target</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, name, revActual, target }) => {
              const revTarget = target?.revenueTarget ?? null
              const revDelta  = revTarget != null ? revActual - revTarget : null
              return (
                <tr key={id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...td, textAlign: 'left', color: '#ff6b00' }}>{name}</td>
                  <td style={td}>{revTarget != null ? formatCurrency(revTarget) : <span style={{ color: '#444' }}>—</span>}</td>
                  <td style={{ ...td, color: 'var(--text-primary)' }}>{formatCurrency(revActual)}</td>
                  <td style={{ ...td, color: revDelta != null ? varianceColor(revActual, revTarget!) : '#666' }}>
                    {revDelta != null ? `${revDelta >= 0 ? '+' : ''}${formatCurrency(revDelta)}` : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {revTarget != null ? revStatus(revActual, revTarget) : '—'}
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
              <td style={{ ...td, textAlign: 'right' }}>{revStatus(totalRevActual, totalRevTarget)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    )
  }

  // Single-branch: metric card
  const branchId = selectedBranchId || targets[0]?.branchId
  if (!branchId) return null
  const target = targetMap.get(branchId)
  if (!target?.revenueTarget) return null
  const revTarget = target.revenueTarget
  const revDelta = totalRevenue - revTarget

  return (
    <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>Revenue Goal</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '1 1 160px', background: 'var(--bg-secondary)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Revenue vs. Target</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{formatCurrency(totalRevenue)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Target: {formatCurrency(revTarget)}</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: varianceColor(totalRevenue, revTarget), marginTop: 6 }}>
            {revDelta >= 0 ? '+' : ''}{formatCurrency(revDelta)}
          </div>
          <div style={{ marginTop: 8 }}>{revStatus(totalRevenue, revTarget)}</div>
        </div>
      </div>
    </div>
  )
}
