'use client'

import { useState, useEffect, useMemo } from 'react'
import Skeleton from '@/components/ui/Skeleton'
import TrendLineChart, { type TrendDataPoint } from '@/components/charts/TrendLineChart'
import WaterfallChart from '@/components/charts/WaterfallChart'
import TargetVarianceRow from '@/components/targets/TargetVarianceRow'
import { formatCurrency, formatPercent, round2 } from '@/lib/utils/format'
import {
  getTrendStart,
  formatPeriodDate,
  toISODate,
} from '@/lib/utils/date'
import type { BranchAllocation } from '@/lib/allocation'

interface Branch {
  id: string
  name: string
}

interface Entity {
  id: string
  code: string
  name: string
}

interface RevTxn {
  branch_id: string
  period_date: string
  labor: number
  rental: number
  one_time_charges: number
  total_revenue: number
}

interface FuelTxn {
  branch_id: string
  transaction_date: string
  total_with_tax: number
  gallons: number | null
}

interface PayrollLine {
  employeeId: string
  displayName: string
  laborType: string
  amount: number
  hours: number | null
  rate: number | null
  branchId?: string | null
}

interface AllocationData {
  canAllocate: boolean
  reason?: string
  allocations: BranchAllocation[]
  totalSnRevenue?: number
  totalCorpPayroll?: number
  totalHqPayroll?: number
  snHqShare?: number
}

interface FiscalMonth {
  id: string
  name: string
  year: number
  start_date: string
  end_date: string
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
  entities: Entity[]
}

function fmtShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d))
}

function rangeLabel(s: string, e: string): string {
  return `${fmtShort(s)} – ${fmtShort(e)}, ${e.split('-')[0]}`
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────
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

// ─── Hero sparkline ───────────────────────────────────────────────────────────
function HeroSparkline({ data }: { data: TrendDataPoint[] }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map((d) => d.revenue), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 44 }}>
      {data.map((d, i) => {
        const isLast = i === data.length - 1
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(8, (d.revenue / max) * 100)}%`,
              background: isLast ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)',
              borderRadius: '2px 2px 0 0',
            }}
          />
        )
      })}
    </div>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ pct, color = '#ff6b00' }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 4, background: '#2a2a2a', borderRadius: 2, marginTop: 8 }}>
      <div
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          height: '100%',
          background: color,
          borderRadius: 2,
        }}
      />
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 80,
        fontSize: 12,
        color: '#555555',
        textAlign: 'center',
        padding: '0 16px',
      }}
    >
      {message}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ExecutiveDashboard({ branches, entities }: Props) {
  // ── Period selection state ────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'month' | 'quarter' | 'year'>('month')
  const [fiscalMonths, setFiscalMonths] = useState<FiscalMonth[]>([])
  const [fiscalQuarters, setFiscalQuarters] = useState<FiscalQuarter[]>([])
  const [selectedFiscalId, setSelectedFiscalId] = useState<string>('')
  const [selectedQuarterId, setSelectedQuarterId] = useState<string>('')
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [availableYears, setAvailableYears] = useState<Array<{ year: number; startDate: string; endDate: string }>>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)

  // ── Data state ────────────────────────────────────────────────────────────
  const [revData, setRevData] = useState<{ totalRevenue: number; transactions: RevTxn[] } | null>(null)
  const [directPayroll, setDirectPayroll] = useState<{ detail: PayrollLine[]; total: number } | null>(null)
  const [adminPayroll, setAdminPayroll] = useState<{ detail: PayrollLine[]; total: number } | null>(null)
  const [employerTaxes, setEmployerTaxes] = useState<number>(0)
  const [fuelData, setFuelData] = useState<{ totalWithTax: number; totalGallons: number; transactions: FuelTxn[] } | null>(null)
  const [allocation, setAllocation] = useState<AllocationData | null>(null)
  const [trendData, setTrendData] = useState<TrendDataPoint[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPayrollDetail, setShowPayrollDetail] = useState(false)
  const [allocationOn, setAllocationOn] = useState(false)

  // ── Load fiscal data on mount ─────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/fiscal-months').then((r) => r.json()),
      fetch('/api/periods/available').then((r) => r.json()),
      fetch('/api/fiscal-quarters').then((r) => r.json()),
      fetch('/api/periods/years').then((r) => r.json()),
    ]).then(([fmJson, periodsJson, fqJson, yearsJson]) => {
      if (fmJson.success) {
        const fms: FiscalMonth[] = fmJson.data
        setFiscalMonths(fms)
        const periods: string[] = periodsJson.success ? periodsJson.data : []
        const mostRecent = periods[0] ?? null
        const match = mostRecent ? fms.find((fm) => fm.start_date <= mostRecent && mostRecent <= fm.end_date) : null
        setSelectedFiscalId(match?.id ?? fms[0]?.id ?? '')
      }
      if (fqJson.success && fqJson.data.length > 0) {
        setFiscalQuarters(fqJson.data)
        setSelectedQuarterId(fqJson.data[0]?.id ?? '')
      }
      if (yearsJson.success && yearsJson.data.length > 0) {
        setAvailableYears(yearsJson.data)
        setSelectedYear(yearsJson.data[0].year)
      }
      setPeriodsLoaded(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Date range computation ────────────────────────────────────────────────
  const selectedFiscal = useMemo(
    () => fiscalMonths.find((fm) => fm.id === selectedFiscalId) ?? null,
    [fiscalMonths, selectedFiscalId]
  )

  const selectedQuarter = useMemo(
    () => fiscalQuarters.find((q) => q.id === selectedQuarterId) ?? null,
    [fiscalQuarters, selectedQuarterId]
  )

  const { startDate, endDate } = useMemo(() => {
    if (viewMode === 'quarter' && selectedQuarter) {
      const sorted = [...selectedQuarter.months].sort((a, b) => a.sort_order - b.sort_order)
      return { startDate: sorted[0]?.start_date ?? '', endDate: sorted[sorted.length - 1]?.end_date ?? '' }
    }
    if (viewMode === 'year') {
      const yearData = availableYears.find((y) => y.year === selectedYear)
      if (yearData) return { startDate: yearData.startDate, endDate: yearData.endDate }
      return { startDate: `${selectedYear}-01-01`, endDate: `${selectedYear}-12-31` }
    }
    if (selectedFiscal) return { startDate: selectedFiscal.start_date, endDate: selectedFiscal.end_date }
    return { startDate: '', endDate: '' }
  }, [viewMode, selectedQuarter, selectedFiscal, selectedYear, availableYears])

  // Payroll and allocation use the last period date (endDate) of the selected range
  const periodDate = endDate

  const trendStart = useMemo(() => (endDate ? getTrendStart(endDate) : ''), [endDate])

  // ── Fetch main metrics ────────────────────────────────────────────────────
  useEffect(() => {
    if (!periodsLoaded || !startDate || !endDate) return
    setLoading(true)
    setError(null)

    const revParams = new URLSearchParams({ startDate, endDate })
    const payParams = new URLSearchParams({ periodDate })
    const fuelParams = new URLSearchParams({ startDate, endDate })
    const allocParams = new URLSearchParams({ periodDate })

    const adminCalls = entities.map((e) =>
      fetch(`/api/payroll/summary?${new URLSearchParams({ periodDate, entityId: e.id })}`).then(
        (r) => r.json()
      )
    )

    Promise.all([
      fetch(`/api/revenue/summary?${revParams}`).then((r) => r.json()),
      fetch(`/api/payroll/summary?${payParams}`).then((r) => r.json()),
      fetch(`/api/fuel/summary?${fuelParams}`).then((r) => r.json()),
      fetch(`/api/allocation/summary?${allocParams}`).then((r) => r.json()),
      Promise.all(adminCalls),
    ])
      .then(([rev, pay, fuel, alloc, adminResults]) => {
        if (!rev.success) throw new Error(rev.error)
        if (!pay.success) throw new Error(pay.error)
        if (!fuel.success) throw new Error(fuel.error)

        setRevData({ totalRevenue: rev.data.totalRevenue, transactions: rev.data.transactions })

        setDirectPayroll({
          detail: pay.data.directLabor.detail ?? [],
          total: pay.data.directLabor.total,
        })

        const allAdminDetail: PayrollLine[] = []
        let allAdminTotal = 0
        let allTaxTotal = 0
        for (const result of adminResults as Array<{ success: boolean; data?: { adminPayroll?: { detail?: PayrollLine[]; total?: number }; taxes?: { total?: number } } }>) {
          if (result.success && result.data?.adminPayroll) {
            const ap = result.data.adminPayroll
            if ('detail' in ap && Array.isArray(ap.detail)) {
              allAdminDetail.push(...ap.detail)
            }
            allAdminTotal += ap.total ?? 0
          }
          if (result.success && result.data?.taxes) {
            allTaxTotal += result.data.taxes.total ?? 0
          }
        }
        setAdminPayroll({ detail: allAdminDetail, total: allAdminTotal })
        setEmployerTaxes(allTaxTotal)

        setFuelData({
          totalWithTax: fuel.data.totalWithTax,
          totalGallons: fuel.data.totalGallons,
          transactions: fuel.data.transactions,
        })

        if (alloc.success) {
          setAllocation(alloc.data)
        } else {
          setAllocation({ canAllocate: false, reason: alloc.error, allocations: [] })
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [periodsLoaded, startDate, endDate, entities]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch 13-week trend ───────────────────────────────────────────────────
  useEffect(() => {
    if (!periodsLoaded || !trendStart || !endDate) return

    const rp = new URLSearchParams({ startDate: trendStart, endDate })
    const fp = new URLSearchParams({ startDate: trendStart, endDate })

    Promise.all([
      fetch(`/api/revenue/summary?${rp}`).then((r) => r.json()),
      fetch(`/api/fuel/summary?${fp}`).then((r) => r.json()),
    ]).then(([rev, fuel]) => {
      if (!rev.success || !fuel.success) return

      const revByPeriod: Record<string, number> = {}
      for (const t of rev.data.transactions as RevTxn[]) {
        revByPeriod[t.period_date] = (revByPeriod[t.period_date] ?? 0) + t.total_revenue
      }

      const fuelByPeriod: Record<string, number> = {}
      for (const t of fuel.data.transactions as FuelTxn[]) {
        const d = new Date(t.transaction_date + 'T00:00:00')
        const daysToSat = (6 - d.getDay() + 7) % 7
        d.setDate(d.getDate() + daysToSat)
        const sat = toISODate(d)
        fuelByPeriod[sat] = (fuelByPeriod[sat] ?? 0) + t.total_with_tax
      }

      const periods = Object.keys(revByPeriod).sort()
      setTrendData(
        periods.map((p) => ({
          period: formatPeriodDate(p),
          revenue: revByPeriod[p] ?? 0,
          payroll: 0,
          fuel: fuelByPeriod[p] ?? 0,
        }))
      )
    })
  }, [periodsLoaded, trendStart, endDate])

  // ─── Derived metrics ──────────────────────────────────────────────────────
  const rev = revData?.totalRevenue ?? 0
  const directTotal = directPayroll?.total ?? 0
  const adminTotal = adminPayroll?.total ?? 0
  const totalPayroll = directTotal + adminTotal + employerTaxes
  const fuel = fuelData?.totalWithTax ?? 0
  const grossProfit = rev - totalPayroll - fuel
  const gpPct = rev > 0 ? (grossProfit / rev) * 100 : 0

  const overheadTotal = useMemo(() => {
    if (!allocation?.canAllocate) return 0
    return allocation.allocations.reduce((s, a) => s + a.totalAllocation, 0)
  }, [allocation])

  const netAfterAlloc = grossProfit - overheadTotal
  const netAfterAllocPct = rev > 0 ? (netAfterAlloc / rev) * 100 : 0

  const allocationByBranch = useMemo(() => {
    if (!allocation?.canAllocate) return {}
    return Object.fromEntries(allocation.allocations.map((a) => [a.branchId, a]))
  }, [allocation])

  // Per-branch revenue
  const revenueByBranch = useMemo(() => {
    if (!revData) return {}
    const m: Record<string, number> = {}
    for (const t of revData.transactions) {
      m[t.branch_id] = (m[t.branch_id] ?? 0) + t.total_revenue
    }
    return m
  }, [revData])

  // Per-branch fuel
  const fuelByBranch = useMemo(() => {
    if (!fuelData) return {}
    const m: Record<string, number> = {}
    for (const t of fuelData.transactions) {
      m[t.branch_id] = (m[t.branch_id] ?? 0) + t.total_with_tax
    }
    return m
  }, [fuelData])

  // Per-branch direct labor (from branchId on line items)
  const directByBranch = useMemo(() => {
    if (!directPayroll) return {}
    const m: Record<string, number> = {}
    for (const line of directPayroll.detail) {
      if (line.branchId) {
        m[line.branchId] = (m[line.branchId] ?? 0) + line.amount
      }
    }
    return m
  }, [directPayroll])

  // Branches with $0 revenue (missing data alert)
  const missingRevenueBranches = useMemo(() => {
    if (!revData) return []
    return branches.filter((b) => (revenueByBranch[b.id] ?? 0) === 0).map((b) => b.name)
  }, [revData, branches, revenueByBranch])

  // Branch table rows
  const branchRows = useMemo(() => {
    return branches.map((b) => {
      const branchRev = revenueByBranch[b.id] ?? 0
      const branchDirect = directByBranch[b.id] ?? 0
      const branchFuel = fuelByBranch[b.id] ?? 0
      const branchGross = branchRev - branchDirect - branchFuel
      const alloc = allocationByBranch[b.id]
      const corpAlloc = alloc?.corpAllocation ?? 0
      const hqAlloc = alloc?.hqAllocation ?? 0
      const netAfter = branchGross - corpAlloc - hqAlloc
      const margin = branchRev > 0 ? (netAfter / branchRev) * 100 : null
      return {
        id: b.id,
        name: b.name,
        revenue: branchRev,
        directLabor: branchDirect,
        fuel: branchFuel,
        grossProfit: branchGross,
        corpAlloc,
        hqAlloc,
        netAfterAlloc: netAfter,
        margin,
      }
    }).sort((a, b) => b.revenue - a.revenue)
  }, [branches, revenueByBranch, directByBranch, fuelByBranch, allocationByBranch])

  const noData = !loading && rev === 0 && totalPayroll === 0 && fuel === 0

  const avgPricePerGallon =
    fuelData && fuelData.totalGallons > 0
      ? round2(fuelData.totalWithTax / fuelData.totalGallons)
      : null

  const periodLabel =
    viewMode === 'month' && selectedFiscal
      ? selectedFiscal.name
      : viewMode === 'quarter' && selectedQuarter
      ? selectedQuarter.name
      : viewMode === 'year'
      ? `FY ${selectedYear}`
      : startDate && endDate
      ? rangeLabel(startDate, endDate)
      : '—'

  if (error) {
    return (
      <div style={{ padding: 32, color: '#cc4444', fontSize: 13 }}>
        Failed to load dashboard: {error}
        <button
          onClick={() => window.location.reload()}
          style={{
            marginLeft: 12,
            color: '#ff6b00',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Executive Overview</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Allocation toggle */}
          <button
            onClick={() => setAllocationOn((v) => !v)}
            style={{
              background: allocationOn ? '#ff6b00' : '#1e1e1e',
              color: allocationOn ? '#ffffff' : '#666666',
              border: '1px solid ' + (allocationOn ? '#ff6b00' : '#2a2a2a'),
              borderRadius: 8, padding: '4px 12px', fontSize: 11,
              cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: allocationOn ? 500 : 400,
            }}
          >
            {allocationOn ? 'After Allocation' : 'Pre-Allocation'}
          </button>

          {/* Mode toggle */}
          <div
            style={{
              display: 'flex',
              background: '#1e1e1e',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {(['month', 'quarter', 'year'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  background: viewMode === mode ? '#ff6b00' : 'transparent',
                  color: viewMode === mode ? '#ffffff' : '#888888',
                  border: 'none',
                  padding: '5px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: viewMode === mode ? 500 : 400,
                  transition: 'background 0.15s',
                }}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {/* Contextual dropdown */}
          {viewMode === 'month' && fiscalMonths.length > 0 && (
            <select
              value={selectedFiscalId}
              onChange={(e) => setSelectedFiscalId(e.target.value)}
              style={{
                background: '#1e1e1e',
                border: '1px solid #2a2a2a',
                borderRadius: 8,
                padding: '5px 10px',
                fontSize: 12,
                color: '#cccccc',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {fiscalMonths.map((fm) => (
                <option key={fm.id} value={fm.id}>
                  {fm.name}
                </option>
              ))}
            </select>
          )}

          {viewMode === 'quarter' && fiscalQuarters.length > 0 && (
            <select
              value={selectedQuarterId}
              onChange={(e) => setSelectedQuarterId(e.target.value)}
              style={{
                background: '#1e1e1e',
                border: '1px solid #2a2a2a',
                borderRadius: 8,
                padding: '5px 10px',
                fontSize: 12,
                color: '#cccccc',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {fiscalQuarters.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          )}

          {viewMode === 'year' && availableYears.length > 0 && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              style={{
                background: '#1e1e1e',
                border: '1px solid #2a2a2a',
                borderRadius: 8,
                padding: '5px 10px',
                fontSize: 12,
                color: '#cccccc',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {availableYears.map((y) => (
                <option key={y.year} value={y.year}>
                  {y.year}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ── Missing revenue alert ── */}
      {!loading && missingRevenueBranches.length > 0 && (
        <div
          style={{
            background: '#2a1a0a',
            border: '1px solid #cc5500',
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ff6b00"
            strokeWidth={2}
            style={{ flexShrink: 0 }}
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style={{ fontSize: 12, color: '#cccccc' }}>
            <span style={{ color: '#ff6b00', fontWeight: 500 }}>Missing revenue data</span>
            {' — no import found for '}
            <span style={{ color: '#ffffff' }}>{missingRevenueBranches.join(', ')}</span>
            {' this week.'}
          </span>
        </div>
      )}

      {/* ── Top row: Revenue | Total Payroll | Fuel | Net After Allocation ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
        {/* Revenue hero */}
        {loading ? (
          <Skeleton height={150} borderRadius={12} />
        ) : (
          <div
            style={{
              background: '#ff6b00',
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.8)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Total Revenue
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>
                  {periodLabel}
                </div>
              </div>
              <div
                style={{
                  width: 36,
                  height: 36,
                  background: 'rgba(255,255,255,0.2)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth={2}
                >
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
            </div>
            <div
              style={{ fontSize: 28, fontWeight: 500, color: '#ffffff', lineHeight: 1.1, marginTop: 8 }}
            >
              {noData ? '—' : formatCurrency(rev)}
            </div>
            {noData && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>
                No data for this period
              </div>
            )}
            {trendData && trendData.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <HeroSparkline data={trendData} />
              </div>
            )}
          </div>
        )}

        {/* Total Payroll (direct + admin) */}
        {loading ? (
          <Skeleton height={150} borderRadius={12} />
        ) : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="metric-label">Total Payroll</div>
                <div style={{ fontSize: 11, color: '#666666' }}>{periodLabel}</div>
              </div>
              <div
                style={{
                  width: 36,
                  height: 36,
                  background: '#2a2a2a',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ff6b00"
                  strokeWidth={2}
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
            </div>
            <div className="metric-value" style={{ marginTop: 8 }}>
              {noData ? '—' : formatCurrency(totalPayroll)}
            </div>
            {!noData && (
              <>
                <div style={{ fontSize: 11, color: '#cc4444', marginTop: 2 }}>
                  {rev > 0 ? `${formatPercent((totalPayroll / rev) * 100)} of revenue` : ''}
                </div>
                <div style={{ fontSize: 11, color: '#666666', marginTop: 6 }}>
                  Direct: {formatCurrency(directTotal)}
                </div>
                <div style={{ fontSize: 11, color: '#666666' }}>
                  Admin: {formatCurrency(adminTotal)}
                </div>
                {employerTaxes > 0 && (
                  <div style={{ fontSize: 11, color: '#666666' }}>
                    Employer Taxes: {formatCurrency(employerTaxes)}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Fuel Cost */}
        {loading ? (
          <Skeleton height={150} borderRadius={12} />
        ) : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="metric-label">Fuel Cost</div>
                <div style={{ fontSize: 11, color: '#666666' }}>{periodLabel}</div>
              </div>
              <div
                style={{
                  width: 36,
                  height: 36,
                  background: '#2a2a2a',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ff6b00"
                  strokeWidth={2}
                >
                  <path d="M3 22V8l9-6 9 6v14" />
                  <path d="M9 22V12h6v10" />
                </svg>
              </div>
            </div>
            <div className="metric-value" style={{ marginTop: 8 }}>
              {noData ? '—' : formatCurrency(fuel)}
            </div>
            {!noData && rev > 0 && (
              <>
                <div style={{ fontSize: 11, color: '#cc4444', marginTop: 2 }}>
                  {formatPercent((fuel / rev) * 100)} of revenue
                </div>
                {avgPricePerGallon != null && (
                  <div style={{ fontSize: 11, color: '#666666', marginTop: 6 }}>
                    ${avgPricePerGallon.toFixed(3)}/gal · {(fuelData?.totalGallons ?? 0).toFixed(0)} gal
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Gross Profit / Net After Allocation */}
        {loading ? (
          <Skeleton height={150} borderRadius={12} />
        ) : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="metric-label">{allocationOn ? 'Net After Overhead' : 'Gross Profit'}</div>
                <div style={{ fontSize: 11, color: '#666666' }}>
                  {periodLabel}{allocationOn && viewMode !== 'month' ? ' · overhead: last week of period' : ''}
                </div>
              </div>
              {!noData && <DonutChart pct={allocationOn ? netAfterAllocPct : gpPct} />}
            </div>
            <div
              className="metric-value"
              style={{
                marginTop: 8,
                color: noData ? '#888888' : (allocationOn ? netAfterAlloc : grossProfit) >= 0 ? '#ffffff' : '#cc4444',
              }}
            >
              {noData ? '—' : formatCurrency(allocationOn ? netAfterAlloc : grossProfit)}
            </div>
            {!noData && (
              <div
                style={{
                  fontSize: 11,
                  color: (allocationOn ? netAfterAlloc : grossProfit) >= 0 ? '#ff6b00' : '#cc4444',
                  marginTop: 2,
                }}
              >
                {(allocationOn ? netAfterAlloc : grossProfit) >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(allocationOn ? netAfterAllocPct : gpPct))} margin
              </div>
            )}
            {allocationOn && !noData && (
              <div style={{ fontSize: 11, color: '#666666', marginTop: 4 }}>
                Corp: {formatCurrency(allocation?.totalCorpPayroll ?? 0)} · HQ: {formatCurrency(allocation?.snHqShare ?? 0)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Allocation row — only when toggle is ON ── */}
      {!loading && allocation && allocationOn && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {/* Corp Overhead */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: 4 }}>Corp Overhead</div>
            <div style={{ fontSize: 11, color: '#666666', marginBottom: 8 }}>
              {periodDate ? `Week of ${fmtShort(periodDate)}` : '—'}
            </div>
            {allocation.canAllocate ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff' }}>
                  {formatCurrency(allocation.totalCorpPayroll ?? 0)}
                </div>
                <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>
                  100% allocated to SN branches by revenue share
                </div>
                <ProgressBar
                  pct={rev > 0 ? ((allocation.totalCorpPayroll ?? 0) / rev) * 100 : 0}
                  color="#cc4444"
                />
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#555555', lineHeight: 1.5 }}>
                {allocation.reason ?? 'No data'}
              </div>
            )}
          </div>

          {/* HQ Overhead */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: 4 }}>HQ Overhead (SN share)</div>
            <div style={{ fontSize: 11, color: '#666666', marginBottom: 8 }}>
              {periodDate ? `Week of ${fmtShort(periodDate)}` : '—'}
            </div>
            {allocation.canAllocate ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff' }}>
                  {formatCurrency(allocation.snHqShare ?? 0)}
                </div>
                <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>
                  {formatCurrency(allocation.totalHqPayroll ?? 0)} total HQ · SN gets{' '}
                  {formatPercent(
                    (allocation.totalHqPayroll ?? 0) > 0
                      ? ((allocation.snHqShare ?? 0) / (allocation.totalHqPayroll ?? 1)) * 100
                      : 0
                  )}
                </div>
                <ProgressBar
                  pct={rev > 0 ? ((allocation.snHqShare ?? 0) / rev) * 100 : 0}
                  color="#cc4444"
                />
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#555555', lineHeight: 1.5 }}>
                {allocation.reason ?? 'No data'}
              </div>
            )}
          </div>

          {/* Total Overhead */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: 4 }}>Total Overhead</div>
            <div style={{ fontSize: 11, color: '#666666', marginBottom: 8 }}>
              {periodDate ? `Week of ${fmtShort(periodDate)}` : '—'}
            </div>
            {allocation.canAllocate ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff' }}>
                  {formatCurrency(overheadTotal)}
                </div>
                <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>
                  Corp + HQ · {rev > 0 ? formatPercent((overheadTotal / rev) * 100) : '—'} of revenue
                </div>
                <ProgressBar
                  pct={rev > 0 ? (overheadTotal / rev) * 100 : 0}
                  color="#cc4444"
                />
                <div style={{ fontSize: 11, color: '#666666', marginTop: 4 }}>
                  Gross profit before: {formatCurrency(grossProfit)} →{' '}
                  <span style={{ color: netAfterAlloc >= 0 ? '#ff6b00' : '#cc4444' }}>
                    {formatCurrency(netAfterAlloc)} after
                  </span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#555555', lineHeight: 1.5 }}>
                {allocation.reason ?? 'No data'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Variance from target ─────────────────────────────────────────── */}
      <TargetVarianceRow
        branchIds={branches.map((b) => b.id)}
        periodDate={periodDate}
        view={viewMode === 'month' ? 'weekly' : 'other'}
        actualRevenue={loading ? null : rev}
        actualGrossProfitPct={loading ? null : gpPct}
      />

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.7fr', gap: 12 }}>
        {/* Trend chart */}
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
            Performance Overview
          </div>
          {trendData ? (
            noData || trendData.length === 0 ? (
              <EmptyState message="No trend data yet — import revenue to see the 13-week chart." />
            ) : (
              <TrendLineChart data={trendData} height={190} />
            )
          ) : (
            <Skeleton height={190} />
          )}
        </div>

        {/* Waterfall — uses combined payroll */}
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
            Profit Breakdown
          </div>
          {loading ? (
            <Skeleton height={190} />
          ) : noData ? (
            <EmptyState message="No data for this period." />
          ) : (
            <WaterfallChart revenue={rev} payroll={totalPayroll} fuel={fuel} height={190} />
          )}
        </div>

        {/* Side stack */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="metric-label" style={{ marginBottom: 6 }}>Fuel Efficiency</div>
            {loading ? (
              <Skeleton height={40} />
            ) : noData || !fuelData || fuelData.totalGallons === 0 ? (
              <div style={{ fontSize: 12, color: '#555555' }}>No fuel data</div>
            ) : (
              <>
                <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', lineHeight: 1.2 }}>
                  {avgPricePerGallon != null ? `$${avgPricePerGallon.toFixed(3)}` : '—'}
                </div>
                <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>
                  per gallon · {fuelData.totalGallons.toFixed(0)} gal
                </div>
                <ProgressBar
                  pct={rev > 0 ? Math.min(100, (fuel / rev) * 100) : 0}
                  color="#cc4444"
                />
              </>
            )}
          </div>

          <div className="card">
            <div className="metric-label" style={{ marginBottom: 6 }}>Payroll Ratio</div>
            {loading ? (
              <Skeleton height={40} />
            ) : noData ? (
              <div style={{ fontSize: 12, color: '#555555' }}>No data</div>
            ) : (
              <>
                <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', lineHeight: 1.2 }}>
                  {rev > 0 ? formatPercent((totalPayroll / rev) * 100) : '—'}
                </div>
                <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>of revenue</div>
                <ProgressBar pct={rev > 0 ? (totalPayroll / rev) * 100 : 0} />
                <div style={{ fontSize: 11, color: '#666666', marginTop: 4 }}>
                  Direct: {rev > 0 ? formatPercent((directTotal / rev) * 100) : '—'} · Admin:{' '}
                  {rev > 0 ? formatPercent((adminTotal / rev) * 100) : '—'}
                  {employerTaxes > 0 && ` · Taxes: ${formatCurrency(employerTaxes)}`}
                </div>
              </>
            )}
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 90 }}>
            <div className="metric-label" style={{ marginBottom: 4 }}>All Branches</div>
            <div style={{ fontSize: 12, color: '#888888', lineHeight: 1.5 }}>
              {branches.length} revenue-generating branches
            </div>
            {missingRevenueBranches.length > 0 && (
              <div style={{ fontSize: 11, color: '#cc4444', marginTop: 4 }}>
                {missingRevenueBranches.length} missing revenue
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Branch P&L table ── */}
      <div className="card">
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: '#ffffff',
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Branch Performance — {periodLabel}</span>
          {!allocation?.canAllocate && !loading && (
            <span style={{ fontSize: 11, color: '#555555', fontWeight: 400 }}>
              Allocation unavailable — no revenue data
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Skeleton key={i} height={32} />
            ))}
          </div>
        ) : noData ? (
          <EmptyState message="No data for this period. Import payroll, revenue, and fuel to populate this table." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
              <thead>
                <tr>
                  {[
                    { label: 'Branch', align: 'left' },
                    { label: 'Revenue', align: 'right' },
                    { label: 'Direct Labor', align: 'right' },
                    { label: 'Fuel', align: 'right' },
                    { label: 'Gross Profit', align: 'right' },
                    { label: 'Corp Alloc', align: 'right' },
                    { label: 'HQ Alloc', align: 'right' },
                    { label: 'Net After Overhead', align: 'right' },
                    { label: 'Margin', align: 'right' },
                  ].map((h) => (
                    <th
                      key={h.label}
                      className="table-header"
                      style={{
                        textAlign: h.align as 'left' | 'right',
                        padding: '0 10px 8px',
                        fontWeight: 400,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branchRows.map((row) => {
                  const isMissing = row.revenue === 0
                  return (
                    <tr key={row.id} style={{ borderTop: '1px solid #2a2a2a' }}>
                      <td
                        className="table-body branch-name"
                        style={{ padding: '9px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}
                      >
                        {row.name}
                        {isMissing && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              color: '#cc4444',
                              background: '#2a1010',
                              borderRadius: 3,
                              padding: '1px 5px',
                            }}
                          >
                            no data
                          </span>
                        )}
                      </td>
                      <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right', color: '#ffffff', fontWeight: 500 }}>
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                        {formatCurrency(row.directLabor)}
                      </td>
                      <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                        {formatCurrency(row.fuel)}
                      </td>
                      <td
                        className="table-body"
                        style={{
                          padding: '9px 10px',
                          textAlign: 'right',
                          color: row.grossProfit >= 0 ? '#cccccc' : '#cc4444',
                        }}
                      >
                        {formatCurrency(row.grossProfit)}
                      </td>
                      <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right', color: '#888888' }}>
                        {allocation?.canAllocate ? formatCurrency(row.corpAlloc) : '—'}
                      </td>
                      <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right', color: '#888888' }}>
                        {allocation?.canAllocate ? formatCurrency(row.hqAlloc) : '—'}
                      </td>
                      <td
                        className="table-body"
                        style={{
                          padding: '9px 10px',
                          textAlign: 'right',
                          color: row.netAfterAlloc >= 0 ? '#ffffff' : '#cc4444',
                          fontWeight: 500,
                        }}
                      >
                        {allocation?.canAllocate ? formatCurrency(row.netAfterAlloc) : formatCurrency(row.grossProfit)}
                      </td>
                      <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                        {row.revenue > 0 && row.margin != null ? (
                          <span style={{ color: row.margin >= 0 ? '#ff6b00' : '#cc4444' }}>
                            {row.margin >= 0 ? '' : ''}
                            {formatPercent(Math.abs(row.margin))}
                          </span>
                        ) : (
                          <span style={{ color: '#555555' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {/* Totals row */}
                <tr style={{ borderTop: '1px solid #333333' }}>
                  <td style={{ padding: '9px 10px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>
                    Total
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#ff6b00' }}>
                    {formatCurrency(rev)}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                    {formatCurrency(directTotal)}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                    {formatCurrency(fuel)}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                    {formatCurrency(grossProfit)}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#888888' }}>
                    {allocation?.canAllocate ? formatCurrency(allocation.totalCorpPayroll ?? 0) : '—'}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#888888' }}>
                    {allocation?.canAllocate ? formatCurrency(allocation.snHqShare ?? 0) : '—'}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: netAfterAlloc >= 0 ? '#ff6b00' : '#cc4444' }}>
                    {formatCurrency(netAfterAlloc)}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: rev > 0 ? (netAfterAllocPct >= 0 ? '#ff6b00' : '#cc4444') : '#555555' }}>
                    {rev > 0 ? formatPercent(netAfterAllocPct) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Payroll Detail ── */}
      <div className="card">
        <button
          onClick={() => setShowPayrollDetail((v) => !v)}
          style={{
            width: '100%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 0,
            fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500, color: '#ffffff' }}>
            Payroll Detail — {periodLabel}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!loading && (
              <span style={{ fontSize: 11, color: '#888888' }}>
                {(directPayroll?.detail.length ?? 0) + (adminPayroll?.detail.length ?? 0)} employees
              </span>
            )}
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#666666"
              strokeWidth={2}
              style={{
                transform: showPayrollDetail ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>

        {showPayrollDetail && (
          <div style={{ marginTop: 16 }}>
            {/* Direct Labor */}
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#888888',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 8,
                }}
              >
                Direct Labor
                <span style={{ marginLeft: 8, color: '#ff6b00' }}>
                  {formatCurrency(directTotal)}
                </span>
              </div>
              {loading ? (
                <Skeleton height={120} />
              ) : !directPayroll || directPayroll.detail.length === 0 ? (
                <EmptyState message="No direct labor for this period." />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Employee', 'Branch', 'Hours', 'Rate', 'Amount'].map((h) => (
                        <th
                          key={h}
                          className="table-header"
                          style={{
                            textAlign: h === 'Employee' || h === 'Branch' ? 'left' : 'right',
                            padding: '0 10px 6px',
                            fontWeight: 400,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...directPayroll.detail]
                      .sort((a, b) => b.amount - a.amount)
                      .map((line, i) => {
                        const branchName = branches.find((b) => b.id === line.branchId)?.name ?? '—'
                        return (
                          <tr key={i} style={{ borderTop: '1px solid #2a2a2a' }}>
                            <td className="table-body" style={{ padding: '7px 10px' }}>
                              <a
                                href={`/executive/employees/${line.employeeId}`}
                                style={{ color: '#ff6b00', textDecoration: 'none' }}
                                onMouseOver={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                                onMouseOut={(e) => (e.currentTarget.style.textDecoration = 'none')}
                              >
                                {line.displayName}
                              </a>
                            </td>
                            <td
                              className="table-body branch-name"
                              style={{ padding: '7px 10px', fontSize: 11 }}
                            >
                              {branchName}
                            </td>
                            <td className="table-body" style={{ padding: '7px 10px', textAlign: 'right' }}>
                              {line.hours != null ? line.hours.toFixed(2) : '—'}
                            </td>
                            <td className="table-body" style={{ padding: '7px 10px', textAlign: 'right' }}>
                              {line.rate != null ? `$${line.rate.toFixed(2)}` : '—'}
                            </td>
                            <td
                              className="table-body"
                              style={{ padding: '7px 10px', textAlign: 'right', color: '#ffffff' }}
                            >
                              {formatCurrency(line.amount)}
                            </td>
                          </tr>
                        )
                      })}
                    <tr style={{ borderTop: '1px solid #333333' }}>
                      <td colSpan={4} style={{ padding: '7px 10px', fontSize: 12, color: '#888888' }}>
                        Total direct labor
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#ff6b00' }}>
                        {formatCurrency(directTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* Admin Payroll */}
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#888888',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 8,
                }}
              >
                Admin Payroll
                <span style={{ marginLeft: 8, color: '#ff6b00' }}>
                  {formatCurrency(adminTotal)}
                </span>
              </div>
              {loading ? (
                <Skeleton height={120} />
              ) : !adminPayroll || adminPayroll.detail.length === 0 ? (
                <EmptyState message="No admin payroll for this period." />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Employee', 'Type', 'Hours', 'Rate', 'Amount'].map((h) => (
                        <th
                          key={h}
                          className="table-header"
                          style={{
                            textAlign: h === 'Employee' || h === 'Type' ? 'left' : 'right',
                            padding: '0 10px 6px',
                            fontWeight: 400,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...adminPayroll.detail]
                      .sort((a, b) => b.amount - a.amount)
                      .map((line, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #2a2a2a' }}>
                          <td className="table-body" style={{ padding: '7px 10px' }}>
                            <a
                              href={`/executive/employees/${line.employeeId}`}
                              style={{ color: '#ff6b00', textDecoration: 'none' }}
                              onMouseOver={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                              onMouseOut={(e) => (e.currentTarget.style.textDecoration = 'none')}
                            >
                              {line.displayName}
                            </a>
                          </td>
                          <td className="table-body" style={{ padding: '7px 10px', color: '#888888', fontSize: 11 }}>
                            {line.laborType === 'admin_salary' ? 'Salary' : 'Hourly'}
                          </td>
                          <td className="table-body" style={{ padding: '7px 10px', textAlign: 'right' }}>
                            {line.hours != null ? line.hours.toFixed(2) : '—'}
                          </td>
                          <td className="table-body" style={{ padding: '7px 10px', textAlign: 'right' }}>
                            {line.rate != null ? `$${line.rate.toFixed(2)}` : '—'}
                          </td>
                          <td
                            className="table-body"
                            style={{ padding: '7px 10px', textAlign: 'right', color: '#ffffff' }}
                          >
                            {formatCurrency(line.amount)}
                          </td>
                        </tr>
                      ))}
                    <tr style={{ borderTop: '1px solid #333333' }}>
                      <td colSpan={4} style={{ padding: '7px 10px', fontSize: 12, color: '#888888' }}>
                        Total admin payroll
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#ff6b00' }}>
                        {formatCurrency(adminTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
