'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import MetricCard from '@/components/ui/MetricCard'
import DateRangePicker from '@/components/ui/DateRangePicker'
import Skeleton from '@/components/ui/Skeleton'
import TrendLineChart, { type TrendDataPoint } from '@/components/charts/TrendLineChart'
import WaterfallChart from '@/components/charts/WaterfallChart'
import TargetVarianceRow from '@/components/targets/TargetVarianceRow'
import { formatCurrency, formatPercent, round2 } from '@/lib/utils/format'
import {
  getDateRange,
  getTrendStart,
  formatPeriodDate,
  toISODate,
  getMostRecentSaturday,
} from '@/lib/utils/date'

type View = 'weekly' | 'mtd' | 'ytd'

function parseLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface Branch {
  id: string
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
  transaction_date: string
  total_with_tax: number
  gallons: number | null
}

interface RevData {
  totalRevenue: number
  transactions: RevTxn[]
}

interface FuelData {
  totalWithTax: number
  totalGallons: number
  transactions: FuelTxn[]
}

interface PayData {
  directLabor: { total: number }
}

interface FiscalMonth {
  id: string
  name: string
  year: number
  start_date: string
  end_date: string
}

interface Props {
  branches: Branch[]
  initialWeek: string | null
  initialView: string
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function AdminDashboard({ branches, initialWeek, initialView }: Props) {
  const router = useRouter()

  // ── Navigation state ──────────────────────────────────────────────────────
  const [view, setView] = useState<View>(
    initialView === 'mtd' || initialView === 'ytd' ? initialView : 'weekly'
  )
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)
  const [fiscalMonths, setFiscalMonths] = useState<FiscalMonth[]>([])
  const [selectedFiscalId, setSelectedFiscalId] = useState<string>('')
  const [periodDate, setPeriodDate] = useState<string>(
    initialWeek ?? toISODate(getMostRecentSaturday())
  )

  const [revData, setRevData] = useState<RevData | null>(null)
  const [payData, setPayData] = useState<PayData | null>(null)
  const [fuelData, setFuelData] = useState<FuelData | null>(null)
  const [trendData, setTrendData] = useState<TrendDataPoint[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Step 1: load available periods + fiscal months
  useEffect(() => {
    Promise.all([
      fetch('/api/periods/available').then((r) => r.json()),
      fetch('/api/fiscal-months').then((r) => r.json()),
    ]).then(([periodsJson, fiscalJson]) => {
      const periods: string[] = periodsJson.success ? periodsJson.data : []
      setAvailablePeriods(periods)
      if (fiscalJson.success) setFiscalMonths(fiscalJson.data)
      if (periods.length > 0) {
        if (initialWeek && periods.includes(initialWeek)) {
          setPeriodDate(initialWeek)
        } else {
          setPeriodDate(periods[0])
        }
      }
      setPeriodsLoaded(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fiscal month override ─────────────────────────────────────────────────
  const selectedFiscal = useMemo(
    () => fiscalMonths.find((fm) => fm.id === selectedFiscalId) ?? null,
    [fiscalMonths, selectedFiscalId]
  )

  const { startDate, endDate } = useMemo(() => {
    if (selectedFiscal && view === 'mtd') {
      return { startDate: selectedFiscal.start_date, endDate: periodDate }
    }
    if (selectedFiscal && view === 'ytd') {
      const yearStart = fiscalMonths
        .filter((fm) => fm.year === selectedFiscal.year)
        .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0]
      const start = yearStart ? yearStart.start_date : `${selectedFiscal.year}-01-01`
      return { startDate: start, endDate: periodDate }
    }
    return getDateRange(view, periodDate)
  }, [view, periodDate, selectedFiscal, fiscalMonths])

  const trendStart = useMemo(() => getTrendStart(periodDate), [periodDate])

  // ── URL sync ───────────────────────────────────────────────────────────────
  const syncUrl = useCallback((week: string, v: View) => {
    const params = new URLSearchParams({ week, view: v })
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router])

  const changeView = (v: View) => {
    setView(v)
    syncUrl(periodDate, v)
  }

  const changePeriod = (week: string) => {
    setPeriodDate(week)
    syncUrl(week, view)
  }

  // ── Week navigation ────────────────────────────────────────────────────────
  const currentIdx = availablePeriods.indexOf(periodDate)
  const hasPrev = currentIdx < availablePeriods.length - 1
  const hasNext = currentIdx > 0

  const goPrev = () => { if (hasPrev) changePeriod(availablePeriods[currentIdx + 1]) }
  const goNext = () => { if (hasNext) changePeriod(availablePeriods[currentIdx - 1]) }

  const weekLabel = periodDate
    ? `Week ending ${format(parseLocal(periodDate), 'MMM d, yyyy')}`
    : '—'

  // Step 2: fetch current-period metrics once periods are loaded
  useEffect(() => {
    if (!periodsLoaded) return
    setLoading(true)
    setError(null)

    const revParams = new URLSearchParams({ startDate, endDate })
    const payParams = new URLSearchParams({ periodDate })
    const fuelParams = new URLSearchParams({ startDate, endDate })

    Promise.all([
      fetch(`/api/revenue/summary?${revParams}`).then((r) => r.json()),
      fetch(`/api/payroll/summary?${payParams}`).then((r) => r.json()),
      fetch(`/api/fuel/summary?${fuelParams}`).then((r) => r.json()),
    ])
      .then(([rev, pay, fuel]) => {
        if (!rev.success) throw new Error(rev.error)
        if (!pay.success) throw new Error(pay.error)
        if (!fuel.success) throw new Error(fuel.error)

        setRevData({
          totalRevenue: rev.data.totalRevenue,
          transactions: rev.data.transactions,
        })
        setPayData({ directLabor: { total: pay.data.directLabor.total } })
        setFuelData({
          totalWithTax: fuel.data.totalWithTax,
          totalGallons: fuel.data.totalGallons,
          transactions: fuel.data.transactions,
        })
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [periodsLoaded, periodDate, startDate, endDate])

  // Step 3: fetch 13-week trend
  useEffect(() => {
    if (!periodsLoaded) return

    const rp = new URLSearchParams({ startDate: trendStart, endDate: periodDate })
    const fp = new URLSearchParams({ startDate: trendStart, endDate: periodDate })

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
        })),
      )
    })
  }, [periodsLoaded, periodDate, trendStart])

  // ─── Derived metrics ────────────────────────────────────────────────────────
  const rev = revData?.totalRevenue ?? 0
  const payroll = payData?.directLabor.total ?? 0
  const fuel = fuelData?.totalWithTax ?? 0
  const grossProfit = rev - payroll - fuel
  const gpPct = rev > 0 ? (grossProfit / rev) * 100 : 0
  const payrollPct = rev > 0 ? (payroll / rev) * 100 : 0
  const avgPricePerGallon =
    fuelData && fuelData.totalGallons > 0
      ? round2(fuelData.totalWithTax / fuelData.totalGallons)
      : null

  // Per-branch revenue for the bottom table
  const revenueByBranch = useMemo(() => {
    if (!revData) return []
    const byBranch: Record<string, { labor: number; rental: number; oneTime: number; total: number }> =
      {}
    for (const t of revData.transactions) {
      if (!byBranch[t.branch_id]) {
        byBranch[t.branch_id] = { labor: 0, rental: 0, oneTime: 0, total: 0 }
      }
      byBranch[t.branch_id].labor += t.labor
      byBranch[t.branch_id].rental += t.rental
      byBranch[t.branch_id].oneTime += t.one_time_charges
      byBranch[t.branch_id].total += t.total_revenue
    }
    const branchMap = Object.fromEntries(branches.map((b) => [b.id, b.name]))
    return Object.entries(byBranch)
      .map(([id, vals]) => ({ branchId: id, name: branchMap[id] ?? id, ...vals }))
      .sort((a, b) => b.total - a.total)
  }, [revData, branches])

  const noData = !loading && rev === 0 && payroll === 0 && fuel === 0

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

  const periodLabel = view === 'weekly' ? weekLabel : view.toUpperCase()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Overview</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Week navigator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1e1e1e', borderRadius: 8, padding: '5px 10px', border: '1px solid #2a2a2a' }}>
            <button
              onClick={goPrev}
              disabled={!hasPrev}
              title="Previous week"
              style={{ background: 'none', border: 'none', color: hasPrev ? '#cccccc' : '#3a3a3a', cursor: hasPrev ? 'pointer' : 'default', padding: '0 2px', fontSize: 16, lineHeight: 1, fontFamily: 'inherit' }}
            >
              ‹
            </button>
            <span style={{ fontSize: 12, color: '#cccccc', userSelect: 'none', whiteSpace: 'nowrap', minWidth: 160, textAlign: 'center' }}>
              {weekLabel}
            </span>
            <button
              onClick={goNext}
              disabled={!hasNext}
              title="Next week"
              style={{ background: 'none', border: 'none', color: hasNext ? '#cccccc' : '#3a3a3a', cursor: hasNext ? 'pointer' : 'default', padding: '0 2px', fontSize: 16, lineHeight: 1, fontFamily: 'inherit' }}
            >
              ›
            </button>
          </div>

          {/* Fiscal month selector — shown when MTD or YTD active */}
          {(view === 'mtd' || view === 'ytd') && fiscalMonths.length > 0 && (
            <select
              value={selectedFiscalId}
              onChange={(e) => setSelectedFiscalId(e.target.value)}
              style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8, padding: '5px 10px', fontSize: 12, color: '#cccccc', fontFamily: 'inherit', cursor: 'pointer' }}
            >
              <option value="">Calendar {view === 'mtd' ? 'month' : 'year'}</option>
              {fiscalMonths.map((fm) => (
                <option key={fm.id} value={fm.id}>{fm.name}</option>
              ))}
            </select>
          )}

          <DateRangePicker value={view} onChange={changeView} />
        </div>
      </div>

      {/* ── Top row: 1.4fr 1fr 1fr 1fr ── */}
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
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 500, color: '#ffffff', lineHeight: 1.1, marginTop: 8 }}>
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

        {/* Fuel Cost */}
        {loading ? (
          <Skeleton height={150} borderRadius={12} />
        ) : (
          <MetricCard
            label="Fuel Cost"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(fuel)}
            delta={rev > 0 ? `${formatPercent((fuel / rev) * 100)} of revenue` : undefined}
            deltaType="down"
            icon={
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth={2}>
                <path d="M3 22V8l9-6 9 6v14" />
                <path d="M9 22V12h6v10" />
              </svg>
            }
          />
        )}

        {/* Payroll Cost */}
        {loading ? (
          <Skeleton height={150} borderRadius={12} />
        ) : (
          <MetricCard
            label="Direct Payroll"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(payroll)}
            delta={rev > 0 ? `${formatPercent(payrollPct)} of revenue` : undefined}
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

        {/* Net Profit with donut */}
        {loading ? (
          <Skeleton height={150} borderRadius={12} />
        ) : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="metric-label">Net Profit</div>
                <div style={{ fontSize: 11, color: '#666666' }}>{periodLabel}</div>
              </div>
              {!noData && <DonutChart pct={gpPct} />}
            </div>
            <div
              className="metric-value"
              style={{
                marginTop: 8,
                color: noData ? '#888888' : grossProfit >= 0 ? '#ffffff' : '#cc4444',
              }}
            >
              {noData ? '—' : formatCurrency(grossProfit)}
            </div>
            {!noData && (
              <div
                style={{
                  fontSize: 11,
                  color: grossProfit >= 0 ? '#ff6b00' : '#cc4444',
                  marginTop: 2,
                }}
              >
                {grossProfit >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(gpPct))} margin
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Variance from target ─────────────────────────────────────────── */}
      <TargetVarianceRow
        branchIds={branches.map((b) => b.id)}
        periodDate={periodDate}
        view={view}
        actualRevenue={noData ? null : rev}
        actualGrossProfitPct={noData ? null : gpPct}
      />

      {/* ── Middle row: 1.1fr 1fr 0.7fr ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.7fr', gap: 12 }}>
        {/* Performance Overview */}
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

        {/* Profit Breakdown */}
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
            Profit Breakdown
          </div>
          {loading ? (
            <Skeleton height={190} />
          ) : noData ? (
            <EmptyState message="No data for this period." />
          ) : (
            <WaterfallChart revenue={rev} payroll={payroll} fuel={fuel} height={190} />
          )}
        </div>

        {/* Side cards — stacked */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Fuel Efficiency */}
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
                  per gallon · {fuelData.totalGallons.toFixed(0)} gal total
                </div>
                <ProgressBar pct={Math.min(100, (fuel / rev) * 100)} color="#cc4444" />
                <div style={{ fontSize: 11, color: '#666666', marginTop: 4 }}>
                  {formatPercent((fuel / rev) * 100)} of revenue
                </div>
              </>
            )}
          </div>

          {/* Payroll Allocation */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: 6 }}>Payroll Allocation</div>
            {loading ? (
              <Skeleton height={40} />
            ) : noData ? (
              <div style={{ fontSize: 12, color: '#555555' }}>No data</div>
            ) : (
              <>
                <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', lineHeight: 1.2 }}>
                  {formatPercent(payrollPct)}
                </div>
                <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>of revenue</div>
                <ProgressBar pct={payrollPct} />
                <div style={{ fontSize: 11, color: '#666666', marginTop: 4 }}>
                  {formatCurrency(payroll)} direct labor
                </div>
              </>
            )}
          </div>

          {/* Import Status / quick action */}
          <div
            className="card"
            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 90 }}
          >
            <div className="metric-label" style={{ marginBottom: 4 }}>Data Import</div>
            <div style={{ fontSize: 12, color: '#888888', lineHeight: 1.5 }}>
              Import payroll, revenue, and fuel files.
            </div>
            <div style={{ marginTop: 10 }}>
              <Link
                href="/admin/import"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: '#ffffff',
                  textDecoration: 'none',
                }}
              >
                Go to Import
                <span
                  style={{
                    width: 32,
                    height: 32,
                    background: '#ff6b00',
                    borderRadius: 8,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom: Revenue by Branch ── */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
          Revenue by Branch — {periodLabel}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} height={30} />
            ))}
          </div>
        ) : noData || revenueByBranch.length === 0 ? (
          <EmptyState message="No revenue transactions found for this period. Import data to populate this table." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Branch', 'Labor', 'Rental', 'One-Time', 'Total Revenue', 'Share'].map((h) => (
                  <th
                    key={h}
                    className="table-header"
                    style={{
                      textAlign: h === 'Branch' ? 'left' : 'right',
                      padding: '0 10px 8px',
                      fontWeight: 400,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {revenueByBranch.map((row) => (
                <tr key={row.branchId} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td
                    className="table-body branch-name"
                    style={{ padding: '9px 10px', fontWeight: 500 }}
                  >
                    {row.name}
                  </td>
                  <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                    {formatCurrency(row.labor)}
                  </td>
                  <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                    {formatCurrency(row.rental)}
                  </td>
                  <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                    {formatCurrency(row.oneTime)}
                  </td>
                  <td
                    className="table-body"
                    style={{ padding: '9px 10px', textAlign: 'right', color: '#ffffff', fontWeight: 500 }}
                  >
                    {formatCurrency(row.total)}
                  </td>
                  <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                      <div
                        style={{
                          width: 48,
                          height: 4,
                          background: '#2a2a2a',
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
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
              {/* Totals row */}
              <tr style={{ borderTop: '1px solid #333333' }}>
                <td style={{ padding: '9px 10px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>
                  Total
                </td>
                <td
                  style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}
                >
                  {formatCurrency(revenueByBranch.reduce((s, r) => s + r.labor, 0))}
                </td>
                <td
                  style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}
                >
                  {formatCurrency(revenueByBranch.reduce((s, r) => s + r.rental, 0))}
                </td>
                <td
                  style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}
                >
                  {formatCurrency(revenueByBranch.reduce((s, r) => s + r.oneTime, 0))}
                </td>
                <td
                  style={{
                    padding: '9px 10px',
                    textAlign: 'right',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#ff6b00',
                  }}
                >
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
