'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

export interface TrendDataPoint {
  period: string
  revenue: number
  payroll: number
  fuel: number
}

interface TrendLineChartProps {
  data: TrendDataPoint[]
  height?: number
}

function formatK(value: number) {
  return value >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value}`
}

export default function TrendLineChart({ data, height = 200 }: TrendLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fill: '#555555', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={formatK}
          tick={{ fill: '#555555', fontSize: 9 }}
          axisLine={false}
          tickLine={false}
          width={42}
        />
        <Tooltip
          contentStyle={{
            background: '#2a2a2a',
            border: '1px solid #333333',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: '#888888' }}
          itemStyle={{ color: '#ffffff' }}
          formatter={(value: number) => [`$${value.toLocaleString()}`, undefined]}
        />
        <Legend
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: '#888888', paddingTop: 8 }}
        />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="#ff6b00"
          strokeWidth={2}
          dot={false}
          name="Revenue"
        />
        <Line
          type="monotone"
          dataKey="payroll"
          stroke="#888888"
          strokeWidth={1.5}
          dot={false}
          name="Payroll"
        />
        <Line
          type="monotone"
          dataKey="fuel"
          stroke="#cc4444"
          strokeWidth={1.5}
          dot={false}
          name="Fuel"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
