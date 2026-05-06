'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, formatPercent } from '@/lib/utils/format'

interface TargetRow {
  revenue_target: number | null
  profit_pct_target: number | null
  fiscal_months: { name: string } | null
}

interface Props {
  fiscalMonthId: string
  branchIds: string[]
  actualRevenue: number | null
  actualGrossProfitPct: number | null
  compact?: boolean
}

type Status = 'green' | 'yellow' | 'red'

function varianceStatus(actual: number, target: number): Status {
  if (target === 0) return 'green'
  const ratio = (actual - target) / target
  if (ratio >= -0.05) return 'green'
  if (ratio >= -0.15) return 'yellow'
  return 'red'
}

const STATUS_COLOR: Record<Status, string> = {
  green: '#4caf50',
  yellow: '#ff9800',
  red: '#cc4444',
}
const STATUS_BG: Record<Status, string> = {
  green: 'rgba(76,175,80,0.08)',
  yellow: 'rgba(255,152,0,0.08)',
  red: 'rgba(204,68,68,0.08)',
}

function VarianceMetric({
  label,
  target,
  actual,
  format: fmt,
}: {
  label: string
  target: number | null
  actual: number | null
  format: (v: number) => string
}) {
  if (target == null) {
    return (
      <div style={{ minWidth: 180 }}>
        <p style={labelStyle}>{label}</p>
        <p style={{ margin: 0, fontSize: 13, color: '#555555' }}>No target</p>
      </div>
    )
  }
  if (actual == null) {
    return (
      <div style={{ minWidth: 180 }}>
        <p style={labelStyle}>{label}</p>
        <p style={{ margin: 0, fontSize: 13, color: '#888888' }}>—</p>
      </div>
    )
  }

  const status = varianceStatus(actual, target)
  const varAbs = actual - target
  const varPct = target !== 0 ? (varAbs / target) * 100 : 0
  const sign = varAbs >= 0 ? '+' : ''

  return (
    <div style={{ minWidth: 180, background: STATUS_BG[status], borderRadius: 8, padding: '10px 14px' }}>
      <p style={labelStyle}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 18, fontWeight: 500, color: '#ffffff' }}>{fmt(actual)}</span>
        <span style={{ fontSize: 11, color: '#888888' }}>vs {fmt(target)}</span>
      </div>
      <span style={{ fontSize: 11, color: STATUS_COLOR[status] }}>
        {sign}{fmt(varAbs)} ({sign}{varPct.toFixed(1)}%)
      </span>
    </div>
  )
}

export default function FiscalMonthVarianceRow({
  fiscalMonthId,
  branchIds,
  actualRevenue,
  actualGrossProfitPct,
  compact,
}: Props) {
  const [targets, setTargets] = useState<TargetRow[] | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!fiscalMonthId) return
    setLoaded(false)
    fetch(`/api/targets?fiscalMonthId=${fiscalMonthId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setTargets(json.data as TargetRow[])
        else setTargets([])
      })
      .catch(() => setTargets([]))
      .finally(() => setLoaded(true))
  }, [fiscalMonthId])

  if (!loaded) return null

  // Compact single-line rendering for mobile
  if (compact) {
    const totalRevenueTarget = (targets ?? []).reduce((s, t) => s + (t.revenue_target ?? 0), 0)
    const hasTarget = totalRevenueTarget > 0

    if (!hasTarget) return null

    const varAbs = actualRevenue != null ? actualRevenue - totalRevenueTarget : null
    const varPct = varAbs != null && totalRevenueTarget > 0 ? (varAbs / totalRevenueTarget) * 100 : null
    const sign = varAbs != null && varAbs >= 0 ? '+' : ''
    const status = varAbs != null ? varianceStatus(actualRevenue!, totalRevenueTarget) : 'green'

    return (
      <div style={{
        background: '#1e1e1e',
        border: '1px solid #2a2a2a',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        color: '#888888',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
      }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 10 }}>Target</span>
        <span style={{ color: '#cccccc' }}>{formatCurrency(totalRevenueTarget)}</span>
        <span style={{ color: '#555555' }}>|</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 10 }}>Actual</span>
        <span style={{ color: '#cccccc' }}>{actualRevenue != null ? formatCurrency(actualRevenue) : '—'}</span>
        {varPct != null && (
          <>
            <span style={{ color: '#555555' }}>|</span>
            <span style={{ color: STATUS_COLOR[status], fontWeight: 500 }}>
              {sign}{varPct.toFixed(1)}%
            </span>
          </>
        )}
      </div>
    )
  }

  const fiscalMonthName = targets?.[0]?.fiscal_months?.name ?? null

  // Sum revenue targets across accessible branches
  const relevantTargets = (targets ?? []).filter((t) =>
    branchIds.length === 0 || true // admin sees all
  )

  const totalRevenueTarget = relevantTargets.reduce(
    (s, t) => s + (t.revenue_target ?? 0),
    0
  )

  const hasAnyTarget = relevantTargets.some(
    (t) => t.revenue_target != null || t.profit_pct_target != null
  )

  if (!hasAnyTarget) {
    return (
      <div style={containerStyle}>
        <p style={headerStyle}>
          Variance vs Target
          {fiscalMonthName && <span style={subHeaderStyle}>{fiscalMonthName}</span>}
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#555555' }}>
          No targets configured for this fiscal month.{' '}
          <a href="/admin/targets" style={{ color: '#ff6b00', textDecoration: 'none' }}>
            Set targets →
          </a>
        </p>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <p style={headerStyle}>
        Variance vs Target
        {fiscalMonthName && <span style={subHeaderStyle}>{fiscalMonthName}</span>}
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <VarianceMetric
          label="Monthly Revenue"
          target={totalRevenueTarget > 0 ? totalRevenueTarget : null}
          actual={actualRevenue}
          format={formatCurrency}
        />
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  background: '#1e1e1e',
  border: '1px solid #2a2a2a',
  borderRadius: 12,
  padding: '12px 16px',
}

const headerStyle: React.CSSProperties = {
  margin: '0 0 10px 0',
  fontSize: 11,
  fontWeight: 400,
  color: '#888888',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const subHeaderStyle: React.CSSProperties = {
  marginLeft: 8,
  textTransform: 'none',
  fontWeight: 400,
  color: '#555555',
}

const labelStyle: React.CSSProperties = {
  margin: '0 0 4px 0',
  fontSize: 11,
  color: '#888888',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}
