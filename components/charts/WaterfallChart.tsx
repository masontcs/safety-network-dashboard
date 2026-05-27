'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'

interface WaterfallChartProps {
  revenue: number
  payroll: number
  fuel: number
  height?: number
}

function fmt(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`
}

export default function WaterfallChart({ revenue, payroll, fuel, height = 200 }: WaterfallChartProps) {
  const net = revenue - payroll - fuel

  const data = [
    { name: 'Revenue', offset: 0, value: revenue, isPositive: true },
    { name: 'Payroll', offset: revenue - payroll, value: payroll, isPositive: false },
    { name: 'Fuel',    offset: revenue - payroll - fuel, value: fuel, isPositive: false },
    { name: 'Net',     offset: 0, value: Math.max(0, net), isPositive: net >= 0 },
  ]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barCategoryGap="25%" margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="name"
          tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide />
        <Tooltip
          contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-muted)' }}
          itemStyle={{ color: 'var(--text-primary)' }}
          formatter={(v: number, name: string) =>
            name === 'offset' ? [null, ''] : [`$${v.toLocaleString()}`, '']
          }
        />
        {/* Invisible offset bar to create waterfall positioning */}
        <Bar dataKey="offset" stackId="w" fill="transparent" isAnimationActive={false} />
        {/* Visible value bar */}
        <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]}>
          <LabelList
            dataKey="value"
            position="top"
            formatter={fmt}
            style={{ fill: 'var(--text-primary)', fontSize: 9 }}
          />
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.isPositive ? '#ff6b00' : '#cc4444'}
              fillOpacity={entry.name === 'Net' ? 0.75 : entry.isPositive ? 1 : 0.8}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
