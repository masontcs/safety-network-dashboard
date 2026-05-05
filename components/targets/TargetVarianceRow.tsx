'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, formatPercent } from '@/lib/utils/format'

interface Target {
  revenue_target: number | null
  profit_pct_target: number | null
}

interface Props {
  // Single-branch mode: provide branchId
  branchId?: string | null
  // Multi-branch aggregate mode: provide branchIds (admin/exec)
  branchIds?: string[] | null
  periodDate: string
  view: string
  actualRevenue: number | null
  actualGrossProfitPct: number | null
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
  noTarget,
}: {
  label: string
  target: number | null
  actual: number | null
  format: (v: number) => string
  noTarget?: boolean
}) {
  if (noTarget || target == null) {
    return (
      <div style={metricWrapStyle}>
        <p style={metricLabelStyle}>{label}</p>
        <p style={{ margin: 0, fontSize: 13, color: '#555555' }}>No target</p>
      </div>
    )
  }

  if (actual == null) {
    return (
      <div style={metricWrapStyle}>
        <p style={metricLabelStyle}>{label}</p>
        <p style={{ margin: 0, fontSize: 13, color: '#888888' }}>—</p>
      </div>
    )
  }

  const status = varianceStatus(actual, target)
  const varAbs = actual - target
  const varPct = target !== 0 ? (varAbs / target) * 100 : 0
  const sign = varAbs >= 0 ? '+' : ''

  return (
    <div
      style={{
        ...metricWrapStyle,
        background: STATUS_BG[status],
        borderRadius: 8,
        padding: '10px 14px',
      }}
    >
      <p style={metricLabelStyle}>{label}</p>
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

export default function TargetVarianceRow({
  branchId,
  branchIds,
  periodDate,
  view,
  actualRevenue,
  actualGrossProfitPct,
}: Props) {
  const [revenueTarget, setRevenueTarget] = useState<number | null>(null)
  const [profitPctTarget, setProfitPctTarget] = useState<number | null>(null)
  const [noTarget, setNoTarget] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const effectiveBranchId = branchId ?? null
  const effectiveBranchIds = branchIds ?? null
  const isAggregate = effectiveBranchId === null && effectiveBranchIds !== null && effectiveBranchIds.length > 0

  useEffect(() => {
    if (view !== 'weekly') {
      setLoaded(true)
      return
    }

    // Need at least one branch identifier
    if (!effectiveBranchId && !isAggregate) {
      setLoaded(true)
      return
    }

    setLoaded(false)

    if (isAggregate) {
      // Fetch all targets for the period and sum revenue targets
      const params = new URLSearchParams({ periodType: 'weekly', targetDate: periodDate })
      fetch(`/api/targets?${params}`)
        .then((r) => r.json())
        .then((json) => {
          if (!json.success || json.data.length === 0) {
            setNoTarget(true)
            setRevenueTarget(null)
            setProfitPctTarget(null)
            return
          }
          const targets = json.data as Target[]
          const totalRev = targets.reduce((s: number, t: Target) => s + (t.revenue_target ?? 0), 0)
          setRevenueTarget(totalRev > 0 ? totalRev : null)
          setProfitPctTarget(null) // Profit % not meaningful as aggregate sum
          setNoTarget(totalRev === 0)
        })
        .catch(() => {
          setNoTarget(true)
          setRevenueTarget(null)
        })
        .finally(() => setLoaded(true))
    } else {
      fetch(`/api/targets?branchId=${effectiveBranchId}&periodType=weekly&targetDate=${periodDate}`)
        .then((r) => r.json())
        .then((json) => {
          if (!json.success || json.data.length === 0) {
            setNoTarget(true)
            setRevenueTarget(null)
            setProfitPctTarget(null)
            return
          }
          const t = json.data[0] as Target
          setRevenueTarget(t.revenue_target)
          setProfitPctTarget(t.profit_pct_target)
          setNoTarget(t.revenue_target == null && t.profit_pct_target == null)
        })
        .catch(() => {
          setNoTarget(true)
          setRevenueTarget(null)
          setProfitPctTarget(null)
        })
        .finally(() => setLoaded(true))
    }
  }, [effectiveBranchId, isAggregate, periodDate, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only show for weekly view with a branch context
  if (view !== 'weekly') return null
  if (!effectiveBranchId && !isAggregate) return null
  if (!loaded) return null

  return (
    <div
      style={{
        background: '#1e1e1e',
        border: '1px solid #2a2a2a',
        borderRadius: 12,
        padding: '12px 16px',
      }}
    >
      <p
        style={{
          margin: '0 0 10px 0',
          fontSize: 11,
          fontWeight: 400,
          color: noTarget ? '#555555' : '#888888',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Variance vs Target
      </p>

      {noTarget ? (
        <p style={{ margin: 0, fontSize: 12, color: '#555555' }}>
          No performance target configured for this period.{' '}
          <a href="/admin/targets" style={{ color: '#ff6b00', textDecoration: 'none' }}>
            Set targets →
          </a>
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <VarianceMetric
            label="Revenue"
            target={revenueTarget}
            actual={actualRevenue}
            format={formatCurrency}
          />
          {!isAggregate && (
            <VarianceMetric
              label="Gross Profit %"
              target={profitPctTarget}
              actual={actualGrossProfitPct}
              format={(v) => formatPercent(v)}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const metricWrapStyle: React.CSSProperties = {
  minWidth: 180,
}

const metricLabelStyle: React.CSSProperties = {
  margin: '0 0 4px 0',
  fontSize: 11,
  color: '#888888',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}
