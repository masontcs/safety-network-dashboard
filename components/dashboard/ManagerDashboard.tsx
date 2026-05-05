'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import MetricCard from '@/components/ui/MetricCard'
import DateRangePicker from '@/components/ui/DateRangePicker'
import Skeleton from '@/components/ui/Skeleton'
import TrendLineChart, { type TrendDataPoint } from '@/components/charts/TrendLineChart'
import WaterfallChart from '@/components/charts/WaterfallChart'
import TargetVarianceRow from '@/components/targets/TargetVarianceRow'
import { formatCurrency, formatPercent } from '@/lib/utils/format'
import { getDateRange, getTrendStart, formatPeriodDate, toISODate, getMostRecentSaturday } from '@/lib/utils/date'
import { format } from 'date-fns'

type View = 'weekly' | 'mtd' | 'ytd'

interface PayrollLine {
  employeeId: string
  displayName: string
  amount: number
  hours: number | null
  rate: number | null
}

interface RevenueRow {
  period_date: string
  total_revenue: number
  branch_id: string
}

interface FuelRow {
  transaction_date: string
  total_with_tax: number
}

interface FiscalMonth {
  id: string
  name: string
  year: number
  start_date: string
  end_date: string
}

interface Props {
  branchId: string
  entityId: string
  initialWeek: string | null
  initialView: string
}

function parseLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export default function ManagerDashboard({ branchId, entityId, initialWeek, initialView }: Props) {
  const router = useRouter()

  // ── Navigation state ──────────────────────────────────────────────────────
  const [view, setView] = useState<View>(
    initialView === 'mtd' || initialView === 'ytd' ? initialView : 'weekly'
  )
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)
  const [fiscalMonths, setFiscalMonths] = useState<FiscalMonth[]>([])
  const [selectedFiscalId, setSelectedFiscalId] = useState<string>('')
  // periodDate is resolved after available periods load
  const [periodDate, setPeriodDate] = useState<string>(
    initialWeek ?? toISODate(getMostRecentSaturday())
  )

  // ── Data state ─────────────────────────────────────────────────────────────
  const [revTotal, setRevTotal] = useState<number | null>(null)
  const [directTotal, setDirectTotal] = useState<number | null>(null)
  const [adminTotal, setAdminTotal] = useState<number | null>(null)
  const [fuelTotal, setFuelTotal] = useState<number | null>(null)
  const [directDetail, setDirectDetail] = useState<PayrollLine[] | null>(null)
  const [trendData, setTrendData] = useState<TrendDataPoint[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Load available periods and fiscal months on mount ────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/periods/available').then((r) => r.json()),
      fetch('/api/fiscal-months').then((r) => r.json()),
    ]).then(([periodsJson, fiscalJson]) => {
      const periods: string[] = periodsJson.success ? periodsJson.data : []
      setAvailablePeriods(periods)

      if (fiscalJson.success) setFiscalMonths(fiscalJson.data)

      // Resolve the initial period date
      if (periods.length > 0) {
        if (initialWeek && periods.includes(initialWeek)) {
          setPeriodDate(initialWeek)
        } else {
          setPeriodDate(periods[0]) // most recent
        }
      }
      setPeriodsLoaded(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fiscal month override for MTD/YTD ─────────────────────────────────────
  const selectedFiscal = useMemo(
    () => fiscalMonths.find((fm) => fm.id === selectedFiscalId) ?? null,
    [fiscalMonths, selectedFiscalId]
  )

  // Compute effective date range, honouring fiscal month when selected
  const { startDate, endDate } = useMemo(() => {
    if (selectedFiscal && view === 'mtd') {
      return { startDate: selectedFiscal.start_date, endDate: periodDate }
    }
    if (selectedFiscal && view === 'ytd') {
      // First fiscal month in the same year
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

  // ── Fetch metrics when period/range changes ────────────────────────────────
  useEffect(() => {
    if (!periodsLoaded) return
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ branchId, startDate, endDate })
    const payrollParams = new URLSearchParams({ branchId, periodDate, entityId })

    Promise.all([
      fetch(`/api/revenue/summary?${params}`).then((r) => r.json()),
      fetch(`/api/payroll/summary?${payrollParams}`).then((r) => r.json()),
      fetch(`/api/fuel/summary?${params}`).then((r) => r.json()),
    ])
      .then(([rev, pay, fuel]) => {
        if (!rev.success) throw new Error(rev.error)
        if (!pay.success) throw new Error(pay.error)
        if (!fuel.success) throw new Error(fuel.error)
        setRevTotal(rev.data.totalRevenue)
        setDirectTotal(pay.data.directLabor.total)
        setAdminTotal(pay.data.adminPayroll.total)
        setFuelTotal(fuel.data.totalWithTax)
        setDirectDetail(pay.data.directLabor.detail)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [branchId, entityId, startDate, endDate, periodDate, periodsLoaded])

  // ── Trend data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!periodsLoaded) return
    const revParams = new URLSearchParams({ branchId, startDate: trendStart, endDate: periodDate })
    const fuelParams = new URLSearchParams({ branchId, startDate: trendStart, endDate: periodDate })

    Promise.all([
      fetch(`/api/revenue/summary?${revParams}`).then((r) => r.json()),
      fetch(`/api/fuel/summary?${fuelParams}`).then((r) => r.json()),
    ]).then(([rev, fuel]) => {
      if (!rev.success || !fuel.success) return
      const revByPeriod: Record<string, number> = {}
      for (const t of rev.data.transactions as RevenueRow[]) {
        revByPeriod[t.period_date] = (revByPeriod[t.period_date] ?? 0) + t.total_revenue
      }
      const fuelByPeriod: Record<string, number> = {}
      for (const t of fuel.data.transactions as FuelRow[]) {
        const txDate = new Date(t.transaction_date + 'T00:00:00')
        const day = txDate.getDay()
        txDate.setDate(txDate.getDate() + ((6 - day + 7) % 7))
        const sat = toISODate(txDate)
        fuelByPeriod[sat] = (fuelByPeriod[sat] ?? 0) + t.total_with_tax
      }
      const periods = Object.keys(revByPeriod).sort()
      setTrendData(periods.map((p) => ({
        period: formatPeriodDate(p),
        revenue: revByPeriod[p] ?? 0,
        payroll: 0,
        fuel: fuelByPeriod[p] ?? 0,
      })))
    })
  }, [branchId, trendStart, periodDate, periodsLoaded])

  // ── Derived metrics ────────────────────────────────────────────────────────
  const grossProfit =
    revTotal !== null && directTotal !== null && adminTotal !== null && fuelTotal !== null
      ? revTotal - directTotal - adminTotal - fuelTotal : null
  const grossProfitPct =
    grossProfit !== null && revTotal !== null && revTotal > 0
      ? (grossProfit / revTotal) * 100 : null
  const totalPayroll =
    directTotal !== null && adminTotal !== null ? directTotal + adminTotal : null

  const weekLabel = periodDate
    ? `Week ending ${format(parseLocal(periodDate), 'MMM d, yyyy')}`
    : '—'

  if (error) {
    return (
      <div style={{ padding: 32, color: '#cc4444', fontSize: 13 }}>
        Failed to load dashboard: {error}
        <button onClick={() => window.location.reload()} style={{ marginLeft: 12, color: '#ff6b00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Header row ──────────────────────────────────────────────────── */}
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

      {/* ── Top metric row ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard
            variant="hero"
            label="Total Revenue"
            sub={view === 'weekly' ? weekLabel : view.toUpperCase()}
            value={revTotal !== null ? formatCurrency(revTotal) : '—'}
            chart={trendData && trendData.length > 0 ? (
              <div style={{ height: 50 }}><HeroSparkline data={trendData} /></div>
            ) : undefined}
          />
        )}
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard label="Direct Payroll" value={directTotal !== null ? formatCurrency(directTotal) : '—'} />
        )}
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard label="Admin Payroll" sub="Lump sum" value={adminTotal !== null ? formatCurrency(adminTotal) : '—'} />
        )}
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard label="Total Fuel" value={fuelTotal !== null ? formatCurrency(fuelTotal) : '—'} />
        )}
      </div>

      {/* ── Variance from target ─────────────────────────────────────────── */}
      <TargetVarianceRow
        branchId={branchId}
        periodDate={periodDate}
        view={view}
        actualRevenue={revTotal}
        actualGrossProfitPct={grossProfitPct}
      />

      {/* ── Middle row ────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.7fr', gap: 12 }}>
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>13-Week Trend</div>
          {trendData ? <TrendLineChart data={trendData} height={180} /> : <Skeleton height={180} />}
        </div>
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Profit Breakdown</div>
          {loading || revTotal === null ? <Skeleton height={180} /> : (
            <WaterfallChart revenue={revTotal} payroll={totalPayroll ?? 0} fuel={fuelTotal ?? 0} height={180} />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? <Skeleton height={80} borderRadius={12} /> : (
            <MetricCard label="Gross Profit" value={grossProfit !== null ? formatCurrency(grossProfit) : '—'} deltaType={grossProfit !== null && grossProfit >= 0 ? 'up' : 'down'} />
          )}
          {loading ? <Skeleton height={80} borderRadius={12} /> : (
            <MetricCard label="Margin" value={grossProfitPct !== null ? formatPercent(grossProfitPct) : '—'} deltaType={grossProfitPct !== null && grossProfitPct >= 0 ? 'up' : 'down'} />
          )}
          {loading ? <Skeleton height={80} borderRadius={12} /> : (
            <MetricCard label="Total Cost" sub="Payroll + Fuel" value={totalPayroll !== null && fuelTotal !== null ? formatCurrency(totalPayroll + fuelTotal) : '—'} />
          )}
        </div>
      </div>

      {/* ── Direct labor table ────────────────────────────────────────────── */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
          Direct Labor — {weekLabel}
        </div>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={28} />)}
          </div>
        ) : !directDetail || directDetail.length === 0 ? (
          <div style={{ fontSize: 13, color: '#888888', padding: '16px 0' }}>No direct labor for this period.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Employee', 'Hours', 'Rate', 'Amount'].map((h) => (
                  <th key={h} style={{ textAlign: h === 'Employee' ? 'left' : 'right', padding: '0 8px 8px' }} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {directDetail.map((row) => (
                <tr key={row.employeeId} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td className="table-body" style={{ padding: '8px 8px' }}>{row.displayName}</td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>{row.hours != null ? row.hours.toFixed(1) : '—'}</td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>{row.rate != null ? formatCurrency(row.rate) : '—'}</td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>{formatCurrency(row.amount)}</td>
                </tr>
              ))}
              {adminTotal !== null && adminTotal > 0 && (
                <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td className="table-body" style={{ padding: '8px 8px', color: '#888888' }}>Admin Payroll (lump sum)</td>
                  <td colSpan={2} />
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right', color: '#888888' }}>{formatCurrency(adminTotal)}</td>
                </tr>
              )}
              <tr style={{ borderTop: '1px solid #333333' }}>
                <td style={{ padding: '8px 8px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>Total Payroll</td>
                <td colSpan={2} />
                <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>{totalPayroll !== null ? formatCurrency(totalPayroll) : '—'}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function HeroSparkline({ data }: { data: TrendDataPoint[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: '100%' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, height: `${(d.revenue / max) * 100}%`, minHeight: 2, background: i === data.length - 1 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)', borderRadius: '1px 1px 0 0' }} />
      ))}
    </div>
  )
}
