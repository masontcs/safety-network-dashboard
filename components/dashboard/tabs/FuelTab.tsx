'use client'

import MetricCard from '@/components/ui/MetricCard'
import WeeklyChart from '@/components/charts/WeeklyChart'
import { formatCurrency } from '@/lib/utils/format'
import type { TabProps } from './types'

export default function FuelTab({ role, data, allocationOn }: TabProps) {
  const fuelByWeek = data.fuelByWeek ?? []
  const consumers = data.fuelConsumers ?? []
  const summary = data.fuelSummary

  const isAdminOrExec = role === 'admin' || role === 'executive'

  const baseCost = summary?.totalWithTax ?? 0
  const baseGallons = summary?.totalGallons ?? 0

  const overviewTotals = data.overview?.totals
  const allocFuel = allocationOn && isAdminOrExec ? (overviewTotals?.allocatedFuel ?? 0) : 0

  const totalCost = baseCost + allocFuel
  const avgPpg = baseGallons > 0 ? baseCost / baseGallons : null

  const weeklyChartData = fuelByWeek.map((w) => ({
    date: w.weekEndDate,
    cost: w.totalCost,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── KPI row ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MetricCard
          label='Total Fuel Cost'
          sub={allocationOn && isAdminOrExec ? 'Incl. Corp/HQ' : undefined}
          value={formatCurrency(totalCost)}
        />
        <MetricCard label='Total Gallons' value={baseGallons.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
        <MetricCard
          label='Avg $/Gallon'
          value={avgPpg !== null ? `$${avgPpg.toFixed(3)}` : '—'}
        />
        {allocFuel > 0 && (
          <MetricCard label='Corp/HQ Fuel' value={formatCurrency(allocFuel)} />
        )}
      </div>

      {/* ── Weekly fuel chart ─────────────────────────────────────────────────── */}
      {fuelByWeek.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Fuel Cost by Week</div>
          <WeeklyChart
            data={weeklyChartData}
            dateKey="date"
            series={[{ key: 'cost', label: 'Fuel Cost', color: '#cc4444', opacity: 0.85 }]}
            height={180}
            formatValue={(v) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          />
        </div>
      )}

      {/* ── Top consumers table ────────────────────────────────────────────────── */}
      {consumers.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Top Consumers</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Name</th>
                  <th style={th}>Branch</th>
                  <th style={th}>Gallons</th>
                  <th style={th}>Avg $/Gal</th>
                  <th style={th}>Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {consumers.map((c, i) => (
                  <tr key={`${c.employeeId ?? 'gen'}-${i}`} style={{ borderBottom: '1px solid #2a2a2a' }}>
                    <td style={{ ...td, textAlign: 'left', color: '#cccccc' }}>
                      {c.displayName}
                      {c.isGeneral && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: '#555555', background: '#2a2a2a', borderRadius: 4, padding: '1px 6px' }}>
                          General
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#888888' }}>{c.branchName}</td>
                    <td style={td}>{c.totalGallons.toFixed(1)}</td>
                    <td style={td}>{c.avgPpg !== null ? `$${c.avgPpg.toFixed(3)}` : '—'}</td>
                    <td style={{ ...td, color: '#ffffff' }}>{formatCurrency(c.totalCost)}</td>
                  </tr>
                ))}
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
