'use client'

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'

export interface BarChartDataPoint {
  label: string
  value: number
}

interface BarChartProps {
  data: BarChartDataPoint[]
  color?: string
  height?: number
  showAxes?: boolean
  formatValue?: (value: number) => string
}

function compactMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}k`
  return `$${Math.round(v)}`
}

function CustomTooltip({ active, payload, label, formatValue }: {
  active?: boolean
  payload?: Array<{ value: number; color: string }>
  label?: string
  formatValue: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: '0 8px 28px rgba(0,0,0,0.65)',
      minWidth: 140,
      pointerEvents: 'none',
    }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6 }}>{label}</div>
      <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 14 }}>
        {formatValue(payload[0].value)}
      </div>
    </div>
  )
}

export default function BarChart({
  data,
  color = '#ff6b00',
  height = 130,
  showAxes = true,
  formatValue,
}: BarChartProps) {
  const fmt = formatValue ?? ((v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
  const showLabels = data.length <= 8

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data}
        barCategoryGap="30%"
        margin={{ top: showLabels ? 24 : 4, right: 4, left: 0, bottom: 0 }}
      >
        {showAxes && (
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        )}
        {showAxes && (
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
        )}
        {showAxes && (
          <YAxis
            tick={{ fill: 'var(--text-dim)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={compactMoney}
          />
        )}
        <Tooltip
          content={(props) => (
            <CustomTooltip
              active={props.active}
              payload={props.payload as Array<{ value: number; color: string }>}
              label={String(props.label)}
              formatValue={fmt}
            />
          )}
          cursor={{ fill: 'rgba(255,255,255,0.025)' }}
        />
        <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]}>
          {showLabels && (
            <LabelList
              dataKey="value"
              position="top"
              style={{ fill: 'var(--text-dim)', fontSize: 10 }}
              formatter={(v: number) => v > 0 ? compactMoney(v) : ''}
            />
          )}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  )
}
