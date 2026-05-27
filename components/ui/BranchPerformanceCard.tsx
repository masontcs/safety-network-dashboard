'use client'

import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '@/lib/utils/format'

function gpColor(pct: number): string {
  if (pct >= 20) return '#4caf50'
  if (pct >= 10) return '#ff9800'
  return '#cc4444'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'var(--text-primary)' }}>
      <p style={{ margin: '0 0 4px', color: 'var(--text-muted)' }}>{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ margin: '2px 0', color: p.color }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  )
}

export interface BranchPerformanceCardProps {
  name: string
  rev: number
  payroll: number
  fuel: number
  gp: number
  gpPct: number
  noData?: boolean
  trendData: Array<{ label: string; revenue: number; payroll: number; fuel: number }>
  chartHeight?: number
}

export default function BranchPerformanceCard({
  name,
  rev,
  payroll,
  fuel,
  gp,
  gpPct,
  noData,
  trendData,
  chartHeight = 80,
}: BranchPerformanceCardProps) {
  const hasTrend = trendData.some((d) => d.revenue > 0 || d.payroll > 0 || d.fuel > 0)

  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#ff6b00', marginBottom: 6 }}>{name}</div>
      {noData ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80, fontSize: 11, color: 'var(--text-faint)' }}>
          No data
        </div>
      ) : (
        <>
          <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: 6 }}>
            {formatCurrency(rev)}
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Payroll</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatCurrency(payroll)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Fuel</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatCurrency(fuel)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: hasTrend ? 8 : 0 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatCurrency(gp)}</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: gpColor(gpPct),
                background: `${gpColor(gpPct)}18`,
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              {gpPct.toFixed(1)}%
            </span>
          </div>
          {hasTrend && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, fontSize: 9, color: 'var(--text-dim)', marginBottom: 2 }}>
                {(['Revenue', 'Payroll', 'Fuel'] as const).map((label, i) => {
                  const color = [['#ff6b00'], ['var(--text-muted)'], ['#cc4444']][i][0]
                  return (
                    <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ display: 'inline-block', width: 12, height: 1.5, background: color }} />
                      {label}
                    </span>
                  )
                })}
              </div>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <LineChart data={trendData} margin={{ top: 4, right: 2, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-faint)', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-emphasis)', strokeWidth: 1 }} />
                  <Line
                    dataKey="revenue"
                    name="Revenue"
                    stroke="#ff6b00"
                    strokeWidth={1.5}
                    dot={{ r: 3, fill: '#ff6b00', strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="payroll"
                    name="Payroll"
                    stroke="#888888"
                    strokeWidth={1.5}
                    dot={{ r: 3, fill: 'var(--text-muted)', strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="fuel"
                    name="Fuel"
                    stroke="#cc4444"
                    strokeWidth={1.5}
                    dot={{ r: 3, fill: '#cc4444', strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </>
      )}
    </div>
  )
}
