'use client'

import { useState, useEffect } from 'react'
import { formatCurrency, formatPercent } from '@/lib/utils/format'

interface WeeklyTarget {
  branch_id: string
  weekly_revenue_target: number | null
  profit_pct_target: number | null
}

interface WeeklyData {
  fiscal_month_name: string
  fiscal_month_id: string
  weeks_in_month: number
  targets: WeeklyTarget[]
}

interface Props {
  branchId?: string | null
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

type LoadState =
  | { status: 'loading' }
  | { status: 'no_fiscal_month' }
  | { status: 'no_target'; fiscalMonthName: string }
  | { status: 'ready'; revenueTarget: number | null; profitPctTarget: number | null; fiscalMonthName: string; isAggregate: boolean }

export default function TargetVarianceRow({
  branchId,
  branchIds,
  periodDate,
  view,
  actualRevenue,
  actualGrossProfitPct,
}: Props) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })

  const effectiveBranchId = branchId ?? null
  const effectiveBranchIds = branchIds ?? null
  const isAggregate = effectiveBranchId === null && effectiveBranchIds !== null && effectiveBranchIds.length > 0

  useEffect(() => {
    if (view !== 'weekly') return
    if (!effectiveBranchId && !isAggregate) return

    setLoadState({ status: 'loading' })

    fetch(`/api/targets/weekly?periodDate=${periodDate}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)

        const weeklyData = json.data as WeeklyData | null

        if (!weeklyData) {
          setLoadState({ status: 'no_fiscal_month' })
          return
        }

        const allTargets = weeklyData.targets

        if (isAggregate) {
          // Filter to accessible branches and sum revenue targets
          const relevantTargets = effectiveBranchIds
            ? allTargets.filter((t) => effectiveBranchIds.includes(t.branch_id))
            : allTargets

          if (relevantTargets.length === 0) {
            setLoadState({ status: 'no_target', fiscalMonthName: weeklyData.fiscal_month_name })
            return
          }

          const totalRevenue = relevantTargets.reduce((s, t) => s + (t.weekly_revenue_target ?? 0), 0)
          setLoadState({
            status: 'ready',
            revenueTarget: totalRevenue > 0 ? totalRevenue : null,
            profitPctTarget: null, // not meaningful as aggregate
            fiscalMonthName: weeklyData.fiscal_month_name,
            isAggregate: true,
          })
        } else {
          const match = allTargets.find((t) => t.branch_id === effectiveBranchId)

          if (!match) {
            setLoadState({ status: 'no_target', fiscalMonthName: weeklyData.fiscal_month_name })
            return
          }

          setLoadState({
            status: 'ready',
            revenueTarget: match.weekly_revenue_target,
            profitPctTarget: match.profit_pct_target,
            fiscalMonthName: weeklyData.fiscal_month_name,
            isAggregate: false,
          })
        }
      })
      .catch(() => {
        setLoadState({ status: 'no_fiscal_month' })
      })
  }, [effectiveBranchId, effectiveBranchIds, isAggregate, periodDate, view]) // eslint-disable-line react-hooks/exhaustive-deps

  if (view !== 'weekly') return null
  if (!effectiveBranchId && !isAggregate) return null
  if (loadState.status === 'loading') return null

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
          color: loadState.status === 'ready' ? '#888888' : '#555555',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Variance vs Target
        {loadState.status === 'ready' && (
          <span style={{ marginLeft: 8, textTransform: 'none', fontWeight: 400, color: '#555555' }}>
            {loadState.fiscalMonthName}
          </span>
        )}
      </p>

      {loadState.status === 'no_fiscal_month' ? (
        <p style={{ margin: 0, fontSize: 12, color: '#555555' }}>
          No fiscal month covers this period.
        </p>
      ) : loadState.status === 'no_target' ? (
        <p style={{ margin: 0, fontSize: 12, color: '#555555' }}>
          No performance target configured for {loadState.fiscalMonthName}.{' '}
          <a href="/admin/targets" style={{ color: '#ff6b00', textDecoration: 'none' }}>
            Set targets →
          </a>
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <VarianceMetric
            label="Revenue"
            target={loadState.revenueTarget}
            actual={actualRevenue}
            format={formatCurrency}
          />
          {!loadState.isAggregate && (
            <VarianceMetric
              label="Gross Profit %"
              target={loadState.profitPctTarget}
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
