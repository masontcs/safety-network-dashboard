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
import BranchPerformanceCard from '@/components/ui/BranchPerformanceCard'
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
  adminPayroll?: number
  employerTaxes?: number
  fuel: number
}

interface BranchData {
  branchId: string
  revenue: number
  labor: number
  rental: number
  oneTime: number
  directPayroll: number
  adminPayroll?: number
  employerTaxes?: number
  fuel: number
  grossProfit: number
  gpPct: number
  corpOverhead?: number
  hqOverhead?: number
  netAfterAlloc?: number
  revenueByPeriod: Array<{ periodDate: string; revenue: number }>
  payrollByPeriod: Array<{ periodDate: string; payroll: number }>
  fuelByPeriod: Array<{ periodDate: string; fuel: number }>
}

interface OverviewData {
  totals: {
    revenue: number
    directPayroll: number
    adminPayroll?: number
    employerTaxes?: number
    fuel: number
    grossProfit: number
    gpPct: number
    totalGallons: number
    corpOverhead?: number
    hqOverhead?: number
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

function fmtMonth(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(y, m - 1, d))
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

// For year mode: label is month abbr for first Saturday of each month, empty string otherwise
function yearBarLabel(sat: string, prev: string | null): string {
  const m = sat.split('-')[1]
  const prevM = prev ? prev.split('-')[1] : null
  return m !== prevM ? fmtMonth(sat) : ''
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

// ── gpColor ───────────────────────────────────────────────────────────────────

function gpColor(pct: number): string {
  if (pct >= 20) return '#4caf50'
  if (pct >= 10) return '#ff9800'
  return '#cc4444'
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

// ── Mobile detection hook ─────────────────────────────────────────────────────

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminDashboard({ branches, fiscalMonths, fiscalQuarters }: Props) {
  const [viewMode, setViewMode] = useState<'month' | 'quarter' | 'year'>('month')
  const [selectedFiscalId, setSelectedFiscalId] = useState<string>('')
  const [selectedQuarterId, setSelectedQuarterId] = useState<string>(fiscalQuarters[0]?.id ?? '')
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [availableYears, setAvailableYears] = useState<Array<{ year: number; startDate: string; endDate: string }>>([])
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [allocationOn, setAllocationOn] = useState(false)

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
    if (viewMode === 'year') {
      const yearData = availableYears.find((y) => y.year === selectedYear)
      if (yearData) return { startDate: yearData.startDate, endDate: yearData.endDate }
      return { startDate: `${selectedYear}-01-01`, endDate: `${selectedYear}-12-31` }
    }
    if (selectedFiscal) {
      return { startDate: selectedFiscal.start_date, endDate: selectedFiscal.end_date }
    }
    return { startDate: '', endDate: '' }
  }, [viewMode, selectedQuarter, selectedFiscal, selectedYear, availableYears])

  const periodLabel = useMemo(() => {
    if (!startDate || !endDate) return '—'
    return rangeLabel(startDate, endDate)
  }, [startDate, endDate])

  // On mount: pick the most recent fiscal month and load available years
  useEffect(() => {
    const doInit = async () => {
      const [periodsJson, yearsJson] = await Promise.all([
        fetch('/api/periods/available').then((r) => r.json()).catch(() => ({ success: false, data: [] })),
        fetch('/api/periods/years').then((r) => r.json()).catch(() => ({ success: false, data: [] })),
      ])
      const periods: string[] = periodsJson.success && periodsJson.data.length > 0 ? periodsJson.data : []
      const mostRecent = periods[0] ?? null
      const match = mostRecent
        ? fiscalMonths.find((fm) => fm.start_date <= mostRecent && mostRecent <= fm.end_date)
        : null
      setSelectedFiscalId(match?.id ?? fiscalMonths[0]?.id ?? '')
      if (yearsJson.success && yearsJson.data.length > 0) {
        setAvailableYears(yearsJson.data)
        setSelectedYear(yearsJson.data[0].year)
      }
    }
    if (fiscalMonths.length > 0) doInit()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch overview data when the date range or allocation toggle changes
  useEffect(() => {
    if (!startDate || !endDate) return
    setLoading(true)
    setError(null)
    setSelectedWeek(null)

    const params = new URLSearchParams({ startDate, endDate })
    if (allocationOn) params.set('allocation', 'true')

    fetch(`/api/admin/overview?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setOverviewData(json.data as OverviewData)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [startDate, endDate, allocationOn])

  const totals = overviewData?.totals
  const rev = totals?.revenue ?? 0
  const pay = totals?.directPayroll ?? 0
  const adminPayroll = totals?.adminPayroll ?? 0
  const employerTaxes = totals?.employerTaxes ?? 0
  const totalPay = pay + adminPayroll + employerTaxes
  const fuel = totals?.fuel ?? 0
  const gp = totals?.grossProfit ?? 0
  const gpPct = totals?.gpPct ?? 0
  const corpOverhead = totals?.corpOverhead ?? 0
  const hqOverhead = totals?.hqOverhead ?? 0
  const overheadTotal = corpOverhead + hqOverhead
  const netAfterAlloc = gp - overheadTotal
  const netAfterAllocPct = rev > 0 ? (netAfterAlloc / rev) * 100 : 0
  const noData = !loading && rev === 0 && pay === 0 && fuel === 0

  // Bar chart data
  const barData = useMemo(() => {
    if (!overviewData) return []
    const periodMap: Record<string, PeriodData> = {}
    for (const p of overviewData.byPeriod) periodMap[p.periodDate] = p

    if (viewMode === 'quarter' && selectedQuarter) {
      const sorted = [...selectedQuarter.months].sort((a, b) => a.sort_order - b.sort_order)
      if (!sorted.length) return []
      const weeks = getSaturdaysInRange(sorted[0].start_date, sorted[sorted.length - 1].end_date)
      return weeks.map((sat) => ({
        periodDate: sat,
        label: fmtShort(sat),
        revenue: periodMap[sat]?.revenue ?? 0,
        directPayroll: periodMap[sat]?.directPayroll ?? 0,
        fuel: periodMap[sat]?.fuel ?? 0,
      }))
    }

    if (viewMode === 'year' && startDate && endDate) {
      const weeks = getSaturdaysInRange(startDate, endDate)
      return weeks.map((sat, i) => ({
        periodDate: sat,
        label: yearBarLabel(sat, i > 0 ? weeks[i - 1] : null),
        revenue: periodMap[sat]?.revenue ?? 0,
        directPayroll: periodMap[sat]?.directPayroll ?? 0,
        fuel: periodMap[sat]?.fuel ?? 0,
      }))
    }

    if (!selectedFiscal) return []
    const weeks = getSaturdaysInRange(selectedFiscal.start_date, selectedFiscal.end_date)
    return weeks.map((sat) => ({
      periodDate: sat,
      label: fmtShort(sat),
      revenue: periodMap[sat]?.revenue ?? 0,
      directPayroll: periodMap[sat]?.directPayroll ?? 0,
      fuel: periodMap[sat]?.fuel ?? 0,
    }))
  }, [overviewData, viewMode, selectedQuarter, selectedFiscal, startDate, endDate])

  // Weeks for sparklines — always derived from startDate/endDate
  const sparklineWeeks = useMemo(() => {
    if (!startDate || !endDate) return []
    return getSaturdaysInRange(startDate, endDate)
  }, [startDate, endDate])

  // Branch grid
  const branchGridData = useMemo(() => {
    const dataMap: Record<string, BranchData> = {}
    for (const b of overviewData?.byBranch ?? []) dataMap[b.branchId] = b

    return branches
      .map((branch) => {
        const data = dataMap[branch.id] ?? null
        const revByPeriod: Record<string, number> = {}
        const payByPeriod: Record<string, number> = {}
        const fuelByPeriod: Record<string, number> = {}
        for (const r of data?.revenueByPeriod ?? []) revByPeriod[r.periodDate] = r.revenue
        for (const p of data?.payrollByPeriod ?? []) payByPeriod[p.periodDate] = p.payroll
        for (const f of data?.fuelByPeriod ?? []) fuelByPeriod[f.periodDate] = f.fuel
        const trendData = sparklineWeeks.map((sat) => ({
          label: fmtShort(sat),
          revenue: revByPeriod[sat] ?? 0,
          payroll: payByPeriod[sat] ?? 0,
          fuel: fuelByPeriod[sat] ?? 0,
        }))
        return { branch, data, trendData }
      })
      .sort((a, b) => (b.data?.revenue ?? 0) - (a.data?.revenue ?? 0))
  }, [overviewData, branches, sparklineWeeks])

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

  const isMobile = useIsMobile()

  // ── Mobile render ────────────────────────────────────────────────────────────
  if (isMobile) {
    if (fiscalMonths.length === 0 && fiscalQuarters.length === 0) {
      return (
        <div style={{ padding: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <p style={{ color: '#888888', fontSize: 13, margin: 0 }}>
              No fiscal months created.{' '}
              <a href="/admin/fiscal-months" style={{ color: '#ff6b00', textDecoration: 'none' }}>Set up →</a>
            </p>
          </div>
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Allocation toggle — mobile */}
        <button
          onClick={() => setAllocationOn((v) => !v)}
          style={{
            alignSelf: 'flex-start',
            background: allocationOn ? '#ff6b00' : '#2a2a2a',
            color: allocationOn ? '#ffffff' : '#666666',
            border: '1px solid ' + (allocationOn ? '#ff6b00' : '#333333'),
            borderRadius: 8, padding: '4px 12px', fontSize: 11,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {allocationOn ? 'After Allocation' : 'Pre-Allocation'}
        </button>

        {/* Period selector */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: '#2a2a2a', borderRadius: 8, padding: 2, border: '1px solid #333333', flexShrink: 0 }}>
            {(['month', 'quarter', 'year'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  background: viewMode === mode ? '#ff6b00' : 'transparent',
                  color: viewMode === mode ? '#ffffff' : '#888888',
                  border: 'none', borderRadius: 6, padding: '5px 8px',
                  fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  fontWeight: viewMode === mode ? 500 : 400, minHeight: 32,
                }}
              >
                {mode === 'month' ? 'Mo' : mode === 'quarter' ? 'Qtr' : 'Yr'}
              </button>
            ))}
          </div>
          {viewMode === 'month' && (
            <select
              value={selectedFiscalId}
              onChange={(e) => setSelectedFiscalId(e.target.value)}
              style={{ ...selectStyle, flex: 1 }}
            >
              {fiscalMonths.map((fm) => (
                <option key={fm.id} value={fm.id}>{fm.name}</option>
              ))}
            </select>
          )}
          {viewMode === 'quarter' && (
            <select
              value={selectedQuarterId}
              onChange={(e) => setSelectedQuarterId(e.target.value)}
              style={{ ...selectStyle, flex: 1 }}
              disabled={fiscalQuarters.length === 0}
            >
              {fiscalQuarters.map((q) => (
                <option key={q.id} value={q.id}>{q.name} (Q{q.quarter_number})</option>
              ))}
            </select>
          )}
          {viewMode === 'year' && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              style={{ ...selectStyle, flex: 1 }}
              disabled={availableYears.length === 0}
            >
              {availableYears.length === 0
                ? <option value={selectedYear}>{selectedYear}</option>
                : availableYears.map((y) => (
                    <option key={y.year} value={y.year}>{y.year}</option>
                  ))
              }
            </select>
          )}
        </div>

        {/* 2×2 metric cards */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={80} borderRadius={12} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: '#ff6b00', borderRadius: 12, padding: '12px 14px', minHeight: 80 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Revenue</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', lineHeight: 1.2 }}>{noData ? '—' : formatCurrency(rev)}</div>
            </div>
            <div className="card" style={{ padding: '12px 14px', minHeight: 80 }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>Fuel</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', lineHeight: 1.2 }}>{noData ? '—' : formatCurrency(fuel)}</div>
            </div>
            <div className="card" style={{ padding: '12px 14px', minHeight: 80 }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>Total Payroll</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', lineHeight: 1.2 }}>{noData ? '—' : formatCurrency(totalPay)}</div>
            </div>
            <div className="card" style={{ padding: '12px 14px', minHeight: 80 }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>Net Profit</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: noData ? '#888888' : gp >= 0 ? '#ffffff' : '#cc4444', lineHeight: 1.2 }}>
                {noData ? '—' : formatCurrency(gp)}
              </div>
              {!noData && (
                <div style={{ fontSize: 11, color: gp >= 0 ? '#ff6b00' : '#cc4444', marginTop: 2 }}>{gpPct.toFixed(1)}% margin</div>
              )}
            </div>
          </div>
        )}

        {/* Variance — month mode only */}
        {viewMode === 'month' && selectedFiscalId && (
          <FiscalMonthVarianceRow
            fiscalMonthId={selectedFiscalId}
            branchIds={branches.map((b) => b.id)}
            actualRevenue={noData ? null : rev}
            actualGrossProfitPct={noData ? null : gpPct}
            compact
          />
        )}

        {/* Bar chart */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>
            {viewMode === 'year' ? 'Annual Performance' : 'Weekly Performance'}
          </div>
          {loading ? (
            <Skeleton height={160} />
          ) : barData.length === 0 ? (
            <EmptyState message="No data for this period." />
          ) : (
            <div style={viewMode === 'year' ? { overflowX: 'auto' } : {}}>
              <div style={viewMode === 'year' ? { minWidth: Math.max(barData.length * 18, 320) } : {}}>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={barData} barCategoryGap="30%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} width={40}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip content={<WeeklyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar
                      dataKey="revenue"
                      name="Revenue"
                      fill="#ff6b00"
                      radius={[3, 3, 0, 0]}
                      cursor={viewMode === 'year' ? undefined : 'pointer'}
                      onClick={viewMode === 'year' ? undefined : (entry: { periodDate: string }) => {
                        setSelectedWeek((prev) => prev === entry.periodDate ? null : entry.periodDate)
                      }}
                    >
                      {barData.map((entry) => (
                        <Cell
                          key={entry.periodDate}
                          fill={viewMode !== 'year' && selectedWeek === entry.periodDate ? '#ffaa44' : '#ff6b00'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {selectedWeek && selectedWeekData && (
          <SelectedWeekPanel periodDate={selectedWeek} data={selectedWeekData} onDismiss={() => setSelectedWeek(null)} />
        )}

        {/* Branch performance — single column list */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', fontSize: 13, fontWeight: 500, color: '#ffffff' }}>
            Branch Performance
          </div>
          {loading ? (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map((i) => <Skeleton key={i} height={44} />)}
            </div>
          ) : (
            branchGridData.map(({ branch, data }) => {
              const bRev = data?.revenue ?? 0
              const bGpPct = data?.gpPct ?? 0
              const bNoData = bRev === 0 && (data?.directPayroll ?? 0) === 0 && (data?.fuel ?? 0) === 0
              return (
                <div
                  key={branch.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderBottom: '1px solid #2a2a2a',
                    minHeight: 44,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#ff6b00' }}>{branch.name}</span>
                  {bNoData ? (
                    <span style={{ fontSize: 12, color: '#555555' }}>No data</span>
                  ) : (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: '#cccccc' }}>{formatCurrency(bRev)}</span>
                      <span style={{
                        fontSize: 12, fontWeight: 500,
                        color: gpColor(bGpPct),
                        background: `${gpColor(bGpPct)}1a`,
                        borderRadius: 4, padding: '2px 7px',
                      }}>
                        {bGpPct.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }
  // ── (End of mobile render path) ───────────────────────────────────────────────

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

  const isYearScrollable = viewMode === 'year' && barData.length > 20

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Header + selectors ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Overview</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Allocation toggle */}
          <button
            onClick={() => setAllocationOn((v) => !v)}
            style={{
              background: allocationOn ? '#ff6b00' : '#2a2a2a',
              color: allocationOn ? '#ffffff' : '#666666',
              border: '1px solid ' + (allocationOn ? '#ff6b00' : '#333333'),
              borderRadius: 8,
              padding: '4px 12px',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: allocationOn ? 500 : 400,
              letterSpacing: '0.02em',
            }}
          >
            {allocationOn ? 'After Allocation' : 'Pre-Allocation'}
          </button>

          {/* Month / Quarter / Year toggle */}
          <div style={{ display: 'flex', background: '#2a2a2a', borderRadius: 8, padding: 2, border: '1px solid #333333' }}>
            {(['month', 'quarter', 'year'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
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
                {mode === 'month' ? 'Month' : mode === 'quarter' ? 'Quarter' : 'Year'}
              </button>
            ))}
          </div>

          {/* Contextual dropdown */}
          {viewMode === 'month' && (
            <select
              value={selectedFiscalId}
              onChange={(e) => setSelectedFiscalId(e.target.value)}
              style={selectStyle}
            >
              {fiscalMonths.map((fm) => (
                <option key={fm.id} value={fm.id}>
                  {fm.name} — {fmtShort(fm.start_date)} to {fmtShort(fm.end_date)}
                </option>
              ))}
            </select>
          )}
          {viewMode === 'quarter' && (
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
          {viewMode === 'year' && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              style={selectStyle}
              disabled={availableYears.length === 0}
            >
              {availableYears.length === 0
                ? <option value={selectedYear}>{selectedYear}</option>
                : availableYears.map((y) => (
                    <option key={y.year} value={y.year}>{y.year}</option>
                  ))
              }
            </select>
          )}
        </div>
      </div>

      {/* ── Top metric cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
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
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="metric-label">Total Payroll</div>
                <div style={{ fontSize: 11, color: '#666666' }}>{periodLabel}</div>
              </div>
              <div style={{ width: 36, height: 36, background: '#2a2a2a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth={2}>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
            </div>
            <div className="metric-value" style={{ marginTop: 8, color: noData ? '#888888' : '#ffffff' }}>
              {noData ? '—' : formatCurrency(totalPay)}
            </div>
            {!noData && rev > 0 && (
              <div style={{ fontSize: 11, color: '#cc4444', marginTop: 2 }}>
                {formatPercent((totalPay / rev) * 100)} of revenue
              </div>
            )}
            {!noData && (
              <div style={{ fontSize: 10, color: '#666666', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span>Direct: {formatCurrency(pay)}</span>
                {adminPayroll > 0 && <span>Admin (H+S): {formatCurrency(adminPayroll)}</span>}
                {employerTaxes > 0 && <span>Taxes: {formatCurrency(employerTaxes)}</span>}
              </div>
            )}
          </div>
        )}

        {loading ? <Skeleton height={150} borderRadius={12} /> : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="metric-label">{allocationOn ? 'Net After Allocation' : 'Net Profit'}</div>
                <div style={{ fontSize: 11, color: '#666666' }}>{periodLabel}</div>
              </div>
              {!noData && <DonutChart pct={allocationOn ? netAfterAllocPct : gpPct} />}
            </div>
            <div className="metric-value" style={{ marginTop: 8, color: noData ? '#888888' : (allocationOn ? netAfterAlloc : gp) >= 0 ? '#ffffff' : '#cc4444' }}>
              {noData ? '—' : formatCurrency(allocationOn ? netAfterAlloc : gp)}
            </div>
            {!noData && (
              <div style={{ fontSize: 11, color: (allocationOn ? netAfterAlloc : gp) >= 0 ? '#ff6b00' : '#cc4444', marginTop: 2 }}>
                {(allocationOn ? netAfterAlloc : gp) >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(allocationOn ? netAfterAllocPct : gpPct))} margin
              </div>
            )}
            {allocationOn && !noData && overheadTotal > 0 && (
              <div style={{ fontSize: 10, color: '#666666', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span>Corp: {formatCurrency(corpOverhead)}</span>
                <span>HQ: {formatCurrency(hqOverhead)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Variance vs target (fiscal month mode only) ── */}
      {viewMode === 'month' && selectedFiscalId && (
        <FiscalMonthVarianceRow
          fiscalMonthId={selectedFiscalId}
          branchIds={branches.map((b) => b.id)}
          actualRevenue={noData ? null : rev}
          actualGrossProfitPct={noData ? null : gpPct}
        />
      )}

      {/* ── Bar chart ── */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
          {viewMode === 'year' ? 'Annual Performance' : 'Weekly Performance'}
          <span style={{ marginLeft: 8, fontSize: 11, color: '#555555', fontWeight: 400 }}>
            {viewMode === 'year'
              ? String(selectedYear)
              : viewMode === 'quarter'
              ? selectedQuarter?.name
              : selectedFiscal?.name}
            {viewMode !== 'year' && ' · click a bar to inspect that week'}
          </span>
        </div>

        {loading ? (
          <Skeleton height={220} />
        ) : barData.length === 0 ? (
          <EmptyState message="No data for this period." />
        ) : (
          <div style={isYearScrollable ? { overflowX: 'auto' } : {}}>
            <div style={isYearScrollable ? { minWidth: barData.length * 20 } : {}}>
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
                    cursor={viewMode === 'year' ? undefined : 'pointer'}
                    onClick={viewMode === 'year' ? undefined : (entry: { periodDate: string }) => {
                      setSelectedWeek((prev) =>
                        prev === entry.periodDate ? null : entry.periodDate
                      )
                    }}
                  >
                    {barData.map((entry) => (
                      <Cell
                        key={entry.periodDate}
                        fill={viewMode !== 'year' && selectedWeek === entry.periodDate ? '#ffaa44' : '#ff6b00'}
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="directPayroll" name="Payroll" fill="#444444" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="fuel" name="Fuel" fill="#8b2a2a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
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
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height={220} borderRadius={12} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {branchGridData.map(({ branch, data, trendData }) => (
              <BranchPerformanceCard
                key={branch.id}
                name={branch.name}
                rev={data?.revenue ?? 0}
                payroll={data?.directPayroll ?? 0}
                fuel={data?.fuel ?? 0}
                gp={data?.grossProfit ?? 0}
                gpPct={data?.gpPct ?? 0}
                noData={!data || (data.revenue === 0 && data.directPayroll === 0 && data.fuel === 0)}
                trendData={trendData}
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
