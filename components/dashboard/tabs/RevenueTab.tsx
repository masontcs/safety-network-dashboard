'use client'

import MetricCard from '@/components/ui/MetricCard'
import { formatCurrency, formatPercent } from '@/lib/utils/format'
import type { TabProps } from './types'

export default function RevenueTab({ data, branches, isMultiBranch, monthSaturdays }: TabProps) {
  const rev = data.revenue
  if (!rev) {
    return <div style={{ color: '#888888', fontSize: 13, padding: 24 }}>No revenue data for this period.</div>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
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

      {/* ── Weekly table (month view uses monthSaturdays) ──────────────────────── */}
      {monthSaturdays.length > 0 ? (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Weekly Revenue</div>
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
                  <tr key={sat} style={{ borderBottom: '1px solid #2a2a2a' }}>
                    <td style={{ ...td, color: '#cccccc' }}>{fmtDate(sat)}</td>
                    <td style={td}>{p ? formatCurrency(p.labor) : '—'}</td>
                    <td style={td}>{p ? formatCurrency(p.rental) : '—'}</td>
                    <td style={td}>{p ? formatCurrency(p.oneTime) : '—'}</td>
                    <td style={{ ...td, color: '#ffffff', fontWeight: 500 }}>{p && p.total > 0 ? formatCurrency(p.total) : '—'}</td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '1px solid #333333' }}>
                <td style={{ ...td, color: '#888888' }}>Total</td>
                <td style={{ ...td, color: '#ffffff', fontWeight: 500 }}>{formatCurrency(rev.labor)}</td>
                <td style={{ ...td, color: '#ffffff', fontWeight: 500 }}>{formatCurrency(rev.rental)}</td>
                <td style={{ ...td, color: '#ffffff', fontWeight: 500 }}>{formatCurrency(rev.oneTimeCharges)}</td>
                <td style={{ ...td, color: '#ff6b00', fontWeight: 500 }}>{formatCurrency(rev.totalRevenue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : byPeriod.length > 0 ? (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Revenue by Week</div>
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
                <tr key={p.periodDate} style={{ borderBottom: '1px solid #2a2a2a' }}>
                  <td style={{ ...td, color: '#cccccc' }}>{fmtDate(p.periodDate)}</td>
                  <td style={td}>{formatCurrency(p.labor)}</td>
                  <td style={td}>{formatCurrency(p.rental)}</td>
                  <td style={td}>{formatCurrency(p.oneTime)}</td>
                  <td style={{ ...td, color: '#ffffff', fontWeight: 500 }}>{formatCurrency(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ── By-branch table ───────────────────────────────────────────────────── */}
      {isMultiBranch && byBranch.length > 1 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Revenue by Branch</div>
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
                <tr key={b.branchId} style={{ borderBottom: '1px solid #2a2a2a' }}>
                  <td style={{ ...td, textAlign: 'left', color: '#ff6b00' }}>{branchNameMap[b.branchId] ?? b.branchId}</td>
                  <td style={td}>{formatCurrency(b.labor)}</td>
                  <td style={td}>{formatCurrency(b.rental)}</td>
                  <td style={td}>{formatCurrency(b.oneTime)}</td>
                  <td style={{ ...td, color: '#ffffff', fontWeight: 500 }}>{formatCurrency(b.total)}</td>
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

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: '#666666', fontWeight: 400 }
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', color: '#cccccc' }
