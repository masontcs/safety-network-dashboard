'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import MetricCard from '@/components/ui/MetricCard'
import Skeleton from '@/components/ui/Skeleton'
import FiscalMonthVarianceRow from '@/components/targets/FiscalMonthVarianceRow'
import { formatCurrency, formatPercent, round2 } from '@/lib/utils/format'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Branch {
  id: string
  name: string
}

interface FiscalMonth {
  id: string
  name: string
  year: number
  start_date: string
  end_date: string
}

interface PeriodData {
  periodDate: string
  revenue: number
  directPayroll: number
  fuel: number
}

interface BranchData {
  branchId: string
  revenue: number
  labor: number
  rental: number
  oneTime: number
  directPayroll: number
  fuel: number
  grossProfit: number
  gpPct: number
  revenueByPeriod: Array<{ periodDate: string; revenue: number }>
}

interface OverviewData {
  totals: {
    revenue: number
    directPayroll: number
    fuel: number
    grossProfit: number
    gpPct: number
    totalGallons: number
  }
  byPeriod: PeriodData[]
  byBranch: BranchData[]
}

interface FiscalQuarter {
  id: string
  name: string
  quarter_number: number
  year: number
  months: Array<{ id: string; name: string; start_date: string; end_date: string; sort_order: number }>
}

interface Props {
  branches: Branch[]
  fiscalMonths: FiscalMonth[]
  fiscalQuarters: FiscalQuarter[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(y, m - 1, d)
  )
}

function rangeLabel(startDate: string, endDate: string): string {
  const year = endDate.split('-')[0]
  return `${fmtShort(startDate)} – ${fmtShort(endDate)}, ${year}`
}

// Return all Saturdays within [startDate, endDate], assuming startDate is a Sunday
function getSaturdaysInRange(startDate: string, endDate: string): string[] {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const end = new Date(ey, em - 1, ed)
  const saturdays: string[] = []
  const d = new Date(sy, sm - 1, sd)
  d.setDate(d.getDate() + 6) // first Saturday is startDate + 6
  while (d <= end) {
    saturdays.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    )
    d.setDate(d.getDate() + 7)
  }
  return saturdays
}

// ── Donut ─────────────────────────────────────────────────────────────────────

function DonutChart({ pct }: { pct: number }) {
  const r = 27
  const cx = 36
  const cy = 36
  const circumference = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(100, pct))
  const dash = round2((filled / 100) * circumference)
  return (
    <svg width={72} height={72} style={{ display: 'block' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2a2a2a" strokeWidth={6} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#ff6b00"
        strokeWidth={6}
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy + 4} textAnchor="middle" fill="#ffffff" fontSize={12} fontWeight={500}>
        {filled.toFixed(1)}%
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="#888888" fontSize={9}>
        Margin
      </text>
    </svg>
  )
}

// ── Mini sparkline (SVG) ──────────────────────────────────────────────────────

function Sparkline({ data, weeks }: { data: Array<{ periodDate: string; revenue: number }>; weeks: string[] }) {
  const W = 120
  const H = 32
  const vals = weeks.map((w) => data.find((d) => d.periodDate === w)?.revenue ?? 0)
  const max = Math.max(...vals, 1)

  if (vals.every((v) => v === 0)) {
    return <div style={{ height: H, opacity: 0.2, borderTop: '1px dashed #555555', marginTop: 8 }} />
  }

  const pts = vals.map((v, i) => {
    const x = weeks.length === 1 ? W / 2 : (i / (weeks.length - 1)) * W
    const y = H - (v / max) * (H - 4)
    return `${x},${y}`
  })

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', marginTop: 8 }}>
      <polyline points={pts.join(' ')} fill="none" stroke="#ff6b00" strokeWidth={1.5} />
    </svg>
  )
}

// ── Branch Card ───────────────────────────────────────────────────────────────

function gpColor(pct: number): string {
  if (pct >= 20) return '#4caf50'
  if (pct >= 10) return '#ff9800'
  return '#cc4444'
}

function BranchCard({
  branch,
  data,
  weeks,
}: {
  branch: Branch
  data: BranchData | null
  weeks: string[]
}) {
  const rev = data?.revenue ?? 0
  const pay = data?.directPayroll ?? 0
  const fuel = data?.fuel ?? 0
  const gp = data?.grossProfit ?? 0
  const gpPct = data?.gpPct ?? 0
  const noData = rev === 0 && pay === 0 && fuel === 0

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 500, color: '#ff6b00', marginBottom: 8 }}>
        {branch.name}
      </div>

      {noData ? (
        <>
          <div style={{ fontSize: 20, fontWeight: 500, color: '#2a2a2a', lineHeight: 1.2 }}>$0.00</div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(17,17,17,0.55)',
              borderRadius: 12,
            }}
          >
            <span style={{ fontSize: 11, color: '#555555', fontWeight: 400 }}>No data</span>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', lineHeight: 1.2, marginBottom: 6 }}>
            {formatCurrency(rev)}
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 10, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Payroll</div>
              <div style={{ fontSize: 12, color: '#cccccc' }}>{formatCurrency(pay)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Fuel</div>
              <div style={{ fontSize: 12, color: '#cccccc' }}>{formatCurrency(fuel)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 0 }}>
            <span style={{ fontSize: 13, color: '#cccccc' }}>{formatCurrency(gp)}</span>
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

          <Sparkline data={data?.revenueByPeriod ?? []} weeks={weeks} />
        </>
      )}
    </div>
  )
}

// ── Selected Week Panel ───────────────────────────────────────────────────────

function SelectedWeekPanel({
  periodDate,
  data,
  onDismiss,
}: {
  periodDate: string
  data: PeriodData | null
  onDismiss: () => void
}) {
  const rev = data?.revenue ?? 0
  const pay = data?.directPayroll ?? 0
  const fuel = data?.fuel ?? 0
  const gp = rev - pay - fuel
  const gpPct = rev > 0 ? (gp / rev) * 100 : 0

  return (
    <div
      style={{
        background: '#2a2a2a',
        border: '1px solid #333333',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 20,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#cccccc' }}>
            Week ending {fmtShort(periodDate)}
          </span>
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: '#666666',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 4px',
              fontFamily: 'inherit',
            }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Revenue', value: formatCurrency(rev), color: '#ff6b00' },
            { label: 'Direct Payroll', value: formatCurrency(pay), color: '#cccccc' },
            { label: 'Fuel', value: formatCurrency(fuel), color: '#cc4444' },
            { label: 'Net Profit', value: formatCurrency(gp), color: gp >= 0 ? '#4caf50' : '#cc4444' },
            { label: 'Profit %', value: `${gpPct.toFixed(1)}%`, color: gpColor(gpPct) },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 500, color }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Custom tooltip for bar chart ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WeeklyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1e1e1e', border: '1px solid #333333', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ margin: '0 0 6px', color: '#888888', fontSize: 11 }}>{label}</p>
      {payload.map((p: { name: string; value: number; fill: string }) => (
        <p key={p.name} style={{ margin: '2px 0', color: p.fill }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminDashboard({ branches, fiscalMonths, fiscalQuarters }: Props) {
  const [viewMode, setViewMode] = useState<'month' | 'quarter'>('month')
  const [selectedFiscalId, setSelectedFiscalId] = useState<string>('')
  const [selectedQuarterId, setSelectedQuarterId] = useState<string>(fiscalQuarters[0]?.id ?? '')
  const [isYTD, setIsYTD] = useState(false)
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)

  // Find the fiscal month object for the current selection
  const selectedFiscal = useMemo(
    () => fiscalMonths.find((fm) => fm.id === selectedFiscalId) ?? null,
    [fiscalMonths, selectedFiscalId]
  )

  const selectedQuarter = useMemo(
    () => fiscalQuarters.find((q) => q.id === selectedQuarterId) ?? null,
    [fiscalQuarters, selectedQuarterId]
  )

  // Date range for the current selection
  const { startDate, endDate } = useMemo(() => {
    if (viewMode === 'quarter' && selectedQuarter) {
      const sorted = [...selectedQuarter.months].sort((a, b) => a.sort_order - b.sort_order)
      return {
        startDate: sorted[0]?.start_date ?? '',
        endDate: sorted[sorted.length - 1]?.end_date ?? '',
      }
    }
    if (isYTD) {
      const year = new Date().getFullYear()
      const latest = fiscalMonths[0]
      return { startDate: `${year}-01-01`, endDate: latest?.end_date ?? `${year}-12-31` }
    }
    if (selectedFiscal) {
      return { startDate: selectedFiscal.start_date, endDate: selectedFiscal.end_date }
    }
    return { startDate: '', endDate: '' }
  }, [viewMode, selectedQuarter, isYTD, selectedFiscal, fiscalMonths])

  // Range label for metric card subtitles
  const periodLabel = useMemo(() => {
    if (!startDate || !endDate) return '—'
    return rangeLabel(startDate, endDate)
  }, [startDate, endDate])

  // On mount: pick the most recent fiscal month that has imported data
  useEffect(() => {
    if (fiscalMonths.length === 0) return
    fetch('/api/periods/available')
      .then((r) => r.json())
      .then((json) => {
        const periods: string[] = json.success && json.data.length > 0 ? json.data : []
        const mostRecent = periods[0] ?? null
        const match = mostRecent
          ? fiscalMonths.find(
              (fm) => fm.start_date <= mostRecent && mostRecent <= fm.end_date
            )
          : null
        setSelectedFiscalId(match?.id ?? fiscalMonths[0].id)
      })
      .catch(() => setSelectedFiscalId(fiscalMonths[0].id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch overview data when the date range changes
  useEffect(() => {
    if (!startDate || !endDate) return
    setLoading(true)
    setError(null)
    setSelectedWeek(null)

    fetch(`/api/admin/overview?startDate=${startDate}&endDate=${endDate}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setOverviewData(json.data as OverviewData)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [startDate, endDate])

  // Totals
  const totals = overviewData?.totals
  const rev = totals?.revenue ?? 0
  const pay = totals?.directPayroll ?? 0
  const fuel = totals?.fuel ?? 0
  const gp = totals?.grossProfit ?? 0
  const gpPct = totals?.gpPct ?? 0
  const noData = !loading && rev === 0 && pay === 0 && fuel === 0

  // Bar chart data — weekly bars for month/quarter, monthly bars for YTD
  const barData = useMemo(() => {
    if (!overviewData) return []

    if (isYTD && viewMode === 'month') {
      // Group byPeriod into fiscal months for YTD bar chart
      return fiscalMonths
        .filter((fm) => fm.start_date >= startDate && fm.end_date <= endDate)
        .map((fm) => {
          const periods = overviewData.byPeriod.filter(
            (p) => p.periodDate >= fm.start_date && p.periodDate <= fm.end_date
          )
          return {
            periodDate: fm.end_date,
            label: fm.name.split(' ')[0],
            revenue: periods.reduce((s, p) => s + p.revenue, 0),
            directPayroll: periods.reduce((s, p) => s + p.directPayroll, 0),
            fuel: periods.reduce((s, p) => s + p.fuel, 0),
          }
        })
        .filter((b) => b.revenue > 0 || b.directPayroll > 0)
    }

    // Quarter mode: weekly bars across all 3 months
    if (viewMode === 'quarter' && selectedQuarter) {
      const sorted = [...selectedQuarter.months].sort((a, b) => a.sort_order - b.sort_order)
      if (!sorted.length) return []
      const weeks = getSaturdaysInRange(sorted[0].start_date, sorted[sorted.length - 1].end_date)
      const periodMap: Record<string, PeriodData> = {}
      for (const p of overviewData.byPeriod) periodMap[p.periodDate] = p
      return weeks.map((sat) => ({
        periodDate: sat,
        label: fmtShort(sat),
        revenue: periodMap[sat]?.revenue ?? 0,
        directPayroll: periodMap[sat]?.directPayroll ?? 0,
        fuel: periodMap[sat]?.fuel ?? 0,
      }))
    }

    if (!selectedFiscal) return []
    const weeks = getSaturdaysInRange(selectedFiscal.start_date, selectedFiscal.end_date)
    const periodMap: Record<string, PeriodData> = {}
    for (const p of overviewData.byPeriod) periodMap[p.periodDate] = p

    return weeks.map((sat) => ({
      periodDate: sat,
      label: fmtShort(sat),
      revenue: periodMap[sat]?.revenue ?? 0,
      directPayroll: periodMap[sat]?.directPayroll ?? 0,
      fuel: periodMap[sat]?.fuel ?? 0,
    }))
  }, [overviewData, isYTD, viewMode, selectedQuarter, selectedFiscal, fiscalMonths, startDate, endDate])

  // Weeks for sparklines
  const sparklineWeeks = useMemo(() => {
    if (viewMode === 'quarter' && selectedQuarter) {
      const sorted = [...selectedQuarter.months].sort((a, b) => a.sort_order - b.sort_order)
      if (!sorted.length) return []
      return getSaturdaysInRange(sorted[0].start_date, sorted[sorted.length - 1].end_date)
    }
    if (!selectedFiscal) return []
    return getSaturdaysInRange(selectedFiscal.start_date, selectedFiscal.end_date)
  }, [viewMode, selectedQuarter, selectedFiscal])

  // Branch grid: all branches from props, enriched with data
  const branchGridData = useMemo(() => {
    const dataMap: Record<string, BranchData> = {}
    for (const b of overviewData?.byBranch ?? []) dataMap[b.branchId] = b

    return branches
      .map((branch) => ({ branch, data: dataMap[branch.id] ?? null }))
      .sort((a, b) => (b.data?.revenue ?? 0) - (a.data?.revenue ?? 0))
  }, [overviewData, branches])

  // Revenue table — same as before
  const revenueByBranch = useMemo(() => {
    return branchGridData
      .filter((item) => item.data && item.data.revenue > 0)
      .map(({ branch, data }) => ({
        branchId: branch.id,
        name: branch.name,
        labor: data!.labor,
        rental: data!.rental,
        oneTime: data!.oneTime,
        total: data!.revenue,
      }))
  }, [branchGridData])

  const selectedWeekData = useMemo(
    () => (selectedWeek ? barData.find((b) => b.periodDate === selectedWeek) ?? null : null),
    [selectedWeek, barData]
  )

  if (fiscalMonths.length === 0 && fiscalQuarters.length === 0) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', marginBottom: 16 }}>Overview</div>
        <div className="card" style={{ padding: 24 }}>
          <p style={{ color: '#888888', fontSize: 13, margin: 0 }}>
            No fiscal months created.{' '}
            <a href="/admin/fiscal-months" style={{ color: '#ff6b00', textDecoration: 'none' }}>
              Go to Settings → Fiscal Months to get started →
            </a>
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 32, color: '#cc4444', fontSize: 13 }}>
        Failed to load dashboard: {error}
        <button
          onClick={() => window.location.reload()}
          style={{ marginLeft: 12, color: '#ff6b00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Header + selectors ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Overview</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

          {/* Month / Quarter toggle */}
          <div style={{ display: 'flex', background: '#2a2a2a', borderRadius: 8, padding: 2, border: '1px solid #333333' }}>
            {(['month', 'quarter'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setViewMode(mode)
                  if (mode === 'quarter') setIsYTD(false)
                }}
                style={{
                  background: viewMode === mode ? '#ff6b00' : 'transparent',
                  color: viewMode === mode ? '#ffffff' : '#888888',
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: viewMode === mode ? 500 : 400,
                  transition: 'background 0.15s',
                }}
              >
                {mode === 'month' ? 'Month' : 'Quarter'}
              </button>
            ))}
          </div>

          {/* Contextual dropdown */}
          {viewMode === 'month' ? (
            <select
              value={selectedFiscalId}
              onChange={(e) => { setIsYTD(false); setSelectedFiscalId(e.target.value) }}
              style={selectStyle}
            >
              {fiscalMonths.map((fm) => (
                <option key={fm.id} value={fm.id}>
                  {fm.name} — {fmtShort(fm.start_date)} to {fmtShort(fm.end_date)}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={selectedQuarterId}
              onChange={(e) => setSelectedQuarterId(e.target.value)}
              style={selectStyle}
              disabled={fiscalQuarters.length === 0}
            >
              {fiscalQuarters.length === 0 ? (
                <option value="">No quarters defined</option>
              ) : (
                fiscalQuarters.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name} (Q{q.quarter_number} {q.year})
                  </option>
                ))
              )}
            </select>
          )}

          {/* YTD — month mode only */}
          {viewMode === 'month' && (
            <button
              onClick={() => setIsYTD((v) => !v)}
              style={{
                background: isYTD ? '#ff6b00' : '#2a2a2a',
                color: isYTD ? '#ffffff' : '#888888',
                border: '1px solid #333333',
                borderRadius: 8,
                padding: '5px 14px',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: isYTD ? 500 : 400,
              }}
            >
              YTD
            </button>
          )}
        </div>
      </div>

      {/* ── Top metric cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
        {/* Revenue hero */}
        {loading ? <Skeleton height={150} borderRadius={12} /> : (
          <div style={{ background: '#ff6b00', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Total Revenue
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>{periodLabel}</div>
              </div>
              <div style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 500, color: '#ffffff', lineHeight: 1.1, marginTop: 8 }}>
              {noData ? '—' : formatCurrency(rev)}
            </div>
            {noData && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>No data for this period</div>}
          </div>
        )}

        {loading ? <Skeleton height={150} borderRadius={12} /> : (
          <MetricCard
            label="Fuel Cost"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(fuel)}
            delta={rev > 0 ? `${formatPercent((fuel / rev) * 100)} of revenue` : undefined}
            deltaType="down"
            icon={
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth={2}>
                <path d="M3 22V8l9-6 9 6v14" /><path d="M9 22V12h6v10" />
              </svg>
            }
          />
        )}

        {loading ? <Skeleton height={150} borderRadius={12} /> : (
          <MetricCard
            label="Direct Payroll"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(pay)}
            delta={rev > 0 ? `${formatPercent((pay / rev) * 100)} of revenue` : undefined}
            deltaType="down"
            icon={
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth={2}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
          />
        )}

        {loading ? <Skeleton height={150} borderRadius={12} /> : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="metric-label">Net Profit</div>
                <div style={{ fontSize: 11, color: '#666666' }}>{periodLabel}</div>
              </div>
              {!noData && <DonutChart pct={gpPct} />}
            </div>
            <div className="metric-value" style={{ marginTop: 8, color: noData ? '#888888' : gp >= 0 ? '#ffffff' : '#cc4444' }}>
              {noData ? '—' : formatCurrency(gp)}
            </div>
            {!noData && (
              <div style={{ fontSize: 11, color: gp >= 0 ? '#ff6b00' : '#cc4444', marginTop: 2 }}>
                {gp >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(gpPct))} margin
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Variance vs target (fiscal month mode only) ── */}
      {viewMode === 'month' && !isYTD && selectedFiscalId && (
        <FiscalMonthVarianceRow
          fiscalMonthId={selectedFiscalId}
          branchIds={branches.map((b) => b.id)}
          actualRevenue={noData ? null : rev}
          actualGrossProfitPct={noData ? null : gpPct}
        />
      )}

      {/* ── Weekly / monthly bar chart ── */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
          {isYTD && viewMode === 'month' ? 'Monthly Performance' : 'Weekly Performance'}
          <span style={{ marginLeft: 8, fontSize: 11, color: '#555555', fontWeight: 400 }}>
            {isYTD && viewMode === 'month'
              ? `YTD ${new Date().getFullYear()}`
              : viewMode === 'quarter'
              ? selectedQuarter?.name
              : selectedFiscal?.name}
            {!(isYTD && viewMode === 'month') && ' · click a bar to inspect that week'}
          </span>
        </div>

        {loading ? (
          <Skeleton height={220} />
        ) : barData.length === 0 ? (
          <EmptyState message="No data for this period." />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={barData}
              barCategoryGap="25%"
              barGap={2}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#555555', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#555555', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<WeeklyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar
                dataKey="revenue"
                name="Revenue"
                fill="#ff6b00"
                radius={[3, 3, 0, 0]}
                cursor={isYTD && viewMode === 'month' ? undefined : 'pointer'}
                onClick={isYTD && viewMode === 'month' ? undefined : (entry: { periodDate: string }) => {
                  setSelectedWeek((prev) =>
                    prev === entry.periodDate ? null : entry.periodDate
                  )
                }}
              >
                {barData.map((entry) => (
                  <Cell
                    key={entry.periodDate}
                    fill={
                      !(isYTD && viewMode === 'month') && selectedWeek === entry.periodDate
                        ? '#ffaa44'
                        : '#ff6b00'
                    }
                  />
                ))}
              </Bar>
              <Bar dataKey="directPayroll" name="Payroll" fill="#444444" radius={[3, 3, 0, 0]} />
              <Bar dataKey="fuel" name="Fuel" fill="#8b2a2a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Selected week panel ── */}
      {selectedWeek && selectedWeekData && (
        <SelectedWeekPanel
          periodDate={selectedWeek}
          data={selectedWeekData}
          onDismiss={() => setSelectedWeek(null)}
        />
      )}

      {/* ── Branch performance grid ── */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>
          Branch Performance
          <span style={{ marginLeft: 8, fontSize: 11, color: '#555555', fontWeight: 400 }}>
            {periodLabel}
          </span>
        </div>
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height={150} borderRadius={12} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {branchGridData.map(({ branch, data }) => (
              <BranchCard
                key={branch.id}
                branch={branch}
                data={data}
                weeks={sparklineWeeks}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Revenue by Branch table ── */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
          Revenue by Branch
          <span style={{ marginLeft: 8, fontSize: 11, color: '#555555', fontWeight: 400 }}>
            {periodLabel}
          </span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={30} />)}
          </div>
        ) : noData || revenueByBranch.length === 0 ? (
          <EmptyState message="No revenue transactions found. Import data to populate this table." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Branch', 'Labor', 'Rental', 'One-Time', 'Total Revenue', 'Share'].map((h) => (
                  <th
                    key={h}
                    className="table-header"
                    style={{ textAlign: h === 'Branch' ? 'left' : 'right', padding: '0 10px 8px', fontWeight: 400 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {revenueByBranch.map((row) => (
                <tr key={row.branchId} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td className="table-body branch-name" style={{ padding: '9px 10px', fontWeight: 500 }}>
                    {row.name}
                  </td>
                  <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>{formatCurrency(row.labor)}</td>
                  <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>{formatCurrency(row.rental)}</td>
                  <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>{formatCurrency(row.oneTime)}</td>
                  <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right', color: '#ffffff', fontWeight: 500 }}>
                    {formatCurrency(row.total)}
                  </td>
                  <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                      <div style={{ width: 48, height: 4, background: '#2a2a2a', borderRadius: 2, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${rev > 0 ? (row.total / rev) * 100 : 0}%`,
                            height: '100%',
                            background: '#ff6b00',
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 11, color: '#888888', minWidth: 36, textAlign: 'right' }}>
                        {rev > 0 ? formatPercent((row.total / rev) * 100, 1) : '—'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid #333333' }}>
                <td style={{ padding: '9px 10px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>Total</td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                  {formatCurrency(revenueByBranch.reduce((s, r) => s + r.labor, 0))}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                  {formatCurrency(revenueByBranch.reduce((s, r) => s + r.rental, 0))}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                  {formatCurrency(revenueByBranch.reduce((s, r) => s + r.oneTime, 0))}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#ff6b00' }}>
                  {formatCurrency(rev)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  background: '#1e1e1e',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  color: '#cccccc',
  fontSize: 12,
  padding: '5px 12px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  outline: 'none',
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80, fontSize: 12, color: '#555555', textAlign: 'center', padding: '0 16px' }}>
      {message}
    </div>
  )
}
