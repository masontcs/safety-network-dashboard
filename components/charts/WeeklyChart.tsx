'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'

export type ChartSeries = {
  key: string
  label: string
  color: string
  stackId?: string
  opacity?: number
}

interface Props {
  data: Array<Record<string, number | string>>
  dateKey: string
  series: ChartSeries[]
  height?: number
  formatValue?: (v: number) => string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

function compactMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}k`
  return `$${Math.round(v)}`
}

function CustomTooltip({ active, payload, label, formatValue }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  formatValue: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const entries = [...payload].reverse()
  const total = entries.reduce((s, e) => s + (e.value ?? 0), 0)

  return (
    <div style={{
      background: '#161616',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: '0 8px 28px rgba(0,0,0,0.65)',
      minWidth: 170,
      pointerEvents: 'none',
    }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 8, fontWeight: 500 }}>{label}</div>
      {entries.map((entry) => (
        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--text-muted)', flex: 1, fontSize: 11 }}>{entry.name}</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{formatValue(entry.value ?? 0)}</span>
        </div>
      ))}
      {entries.length > 1 && (
        <div style={{ borderTop: '1px solid #242424', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>Total</span>
          <span style={{ color: '#ff6b00', fontWeight: 500, fontSize: 11 }}>{formatValue(total)}</span>
        </div>
      )}
    </div>
  )
}

export default function WeeklyChart({ data, dateKey, series, height = 160, formatValue }: Props) {
  const fmt = formatValue ?? ((v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)

  const isStacked = series.some((s) => s.stackId)
  const isSingle = series.length === 1
  const showLabels = data.length <= 8

  const chartData = data.map((row) => {
    const result: Record<string, number | string> = {
      ...row,
      _label: fmtDate(String(row[dateKey])),
    }
    if (isStacked && showLabels) {
      result.__stackTotal = series.reduce((s, ser) => s + (Number(row[ser.key]) || 0), 0)
    }
    return result
  })

  const topMargin = showLabels && (isSingle || isStacked) ? 28 : 8

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          barCategoryGap="35%"
          barGap={3}
          margin={{ top: topMargin, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
          <XAxis
            dataKey="_label"
            tick={{ fill: '#555555', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#444444', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={compactMoney}
          />
          <Tooltip
            content={(props) => (
              <CustomTooltip
                active={props.active}
                payload={props.payload as Array<{ name: string; value: number; color: string }>}
                label={String(props.label)}
                formatValue={fmt}
              />
            )}
            cursor={{ fill: 'rgba(255,255,255,0.025)' }}
          />
          {series.map((s, i) => {
            const isLastSeries = i === series.length - 1
            const isTopOfStack = isStacked && isLastSeries
            const showBarLabel = showLabels && (isSingle || isTopOfStack)
            return (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                fillOpacity={s.opacity ?? 1}
                stackId={s.stackId}
                radius={
                  !isStacked ? [3, 3, 0, 0]
                    : isTopOfStack ? [3, 3, 0, 0]
                    : [0, 0, 0, 0]
                }
              >
                {showBarLabel && (
                  <LabelList
                    dataKey={isTopOfStack ? '__stackTotal' : s.key}
                    position="top"
                    style={{ fill: '#666666', fontSize: 10 }}
                    formatter={(v: number) => v > 0 ? compactMoney(v) : ''}
                  />
                )}
              </Bar>
            )
          })}
        </BarChart>
      </ResponsiveContainer>

      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 16, marginTop: 4, paddingLeft: 50 }}>
          {series.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, opacity: s.opacity ?? 1 }} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
