'use client'

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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

export default function BarChart({
  data,
  color = '#ff6b00',
  height = 130,
  showAxes = true,
  formatValue,
}: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} barCategoryGap="30%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        {showAxes && (
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
        )}
        {showAxes && (
          <XAxis
            dataKey="label"
            tick={{ fill: '#555555', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
        )}
        {showAxes && (
          <YAxis
            tick={{ fill: '#555555', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
        )}
        <Tooltip
          contentStyle={{
            background: '#2a2a2a',
            border: '1px solid #333333',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: '#888888' }}
          itemStyle={{ color: '#ffffff' }}
          formatter={(value: number) => [formatValue ? formatValue(value) : `$${value.toLocaleString()}`, '']}
        />
        <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
      </RechartsBarChart>
    </ResponsiveContainer>
  )
}
