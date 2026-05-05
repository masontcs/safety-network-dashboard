const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatCurrency(amount: number): string {
  return USD.format(amount)
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

// For arithmetic rounding only — never use toFixed() for math
export function round2(val: number): number {
  return Math.round(val * 100) / 100
}

export function formatDelta(value: number, decimals = 1): string {
  const sign = value >= 0 ? '↑' : '↓'
  return `${sign} ${Math.abs(value).toFixed(decimals)}%`
}

export function deltaType(value: number): 'up' | 'down' {
  return value >= 0 ? 'up' : 'down'
}
