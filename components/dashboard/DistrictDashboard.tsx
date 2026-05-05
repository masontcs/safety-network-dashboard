'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import MetricCard from '@/components/ui/MetricCard'
import DateRangePicker from '@/components/ui/DateRangePicker'
import Skeleton from '@/components/ui/Skeleton'
import TrendLineChart, { type TrendDataPoint } from '@/components/charts/TrendLineChart'
import WaterfallChart from '@/components/charts/WaterfallChart'
import TargetVarianceRow from '@/components/targets/TargetVarianceRow'
import { formatCurrency, formatPercent } from '@/lib/utils/format'
import {
  getDateRange,
  getTrendStart,
  formatPeriodDate,
  toISODate,
  getMostRecentSaturday,
} from '@/lib/utils/date'

type View = 'weekly' | 'mtd' | 'ytd'

interface BranchInfo {
  id: string
  name: string
  entityId: string
}

interface BranchPayrollData {
  branchId: string
  directTotal: number
  adminTotal: number
  directDetail: PayrollLine[]
}

interface PayrollLine {
  employeeId: string
  displayName: string
  amount: number
  hours: number | null
  rate: number | null
}

interface RevTxn {
  branch_id: string
  period_date: string
  total_revenue: number
}

interface FuelTxn {
  branch_id: string | null
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
  branches: BranchInfo[]
  initialWeek: string | null
  initialView: string
  initialBranch: string
}

function parseLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function HeroSparkline({ data }: { data: TrendDataPoint[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: '100%' }}>
      {data.map((d, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(4, (d.revenue / max) * 100)}%`,
            background: i === data.length - 1 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)',
            borderRadius: '1px 1px 0 0',
          }}
        />
      ))}
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

export default function DistrictDashboard({
  branches,
  initialWeek,
  initialView,
  initialBranch,
}: Props) {
  const router = useRouter()

  // ── Branch selection ──────────────────────────────────────────────────────
  const validInitialBranch =
    initialBranch === 'all' || branches.some((b) => b.id === initialBranch)
      ? initialBranch
      : 'all'
  const [selectedBranchId, setSelectedBranchId] = useState<string>(validInitialBranch)

  // ── Period nav state ──────────────────────────────────────────────────────
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

  // ── Data state ────────────────────────────────────────────────────────────
  const [branchPayrolls, setBranchPayrolls] = useState<BranchPayrollData[]>([])
  const [revTxns, setRevTxns] = useState<RevTxn[]>([])
  const [fuelTxns, setFuelTxns] = useState<FuelTxn[]>([])
  const [trendData, setTrendData] = useState<TrendDataPoint[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Load periods + fiscal months once ────────────────────────────────────
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

  // ── Date range computation ────────────────────────────────────────────────
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

  // ── URL sync ──────────────────────────────────────────────────────────────
  const syncUrl = useCallback(
    (week: string, v: View, branch: string) => {
      const params = new URLSearchParams({ week, view: v, branch })
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router]
  )

  const changeView = (v: View) => {
    setView(v)
    syncUrl(periodDate, v, selectedBranchId)
  }

  const changePeriod = (week: string) => {
    setPeriodDate(week)
    syncUrl(week, view, selectedBranchId)
  }

  const changeBranch = (branchId: string) => {
    setSelectedBranchId(branchId)
    syncUrl(periodDate, view, branchId)
  }

  // ── Week navigation ────────────────────────────────────────────────────────
  const currentIdx = availablePeriods.indexOf(periodDate)
  const hasPrev = currentIdx < availablePeriods.length - 1
  const hasNext = currentIdx > 0

  const goPrev = () => {
    if (hasPrev) changePeriod(availablePeriods[currentIdx + 1])
  }
  const goNext = () => {
    if (hasNext) changePeriod(availablePeriods[currentIdx - 1])
  }

  // ── Main data fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!periodsLoaded) return
    setLoading(true)
    setError(null)

    if (selectedBranchId === 'all') {
      const payrollCalls = branches.map((b) =>
        fetch(
          `/api/payroll/summary?${new URLSearchParams({ periodDate, branchId: b.id, entityId: b.entityId })}`
        ).then((r) => r.json())
      )
      const revParams = new URLSearchParams({ startDate, endDate })
      const fuelParams = new URLSearchParams({ startDate, endDate })

      Promise.all([
        ...payrollCalls,
        fetch(`/api/revenue/summary?${revParams}`).then((r) => r.json()),
        fetch(`/api/fuel/summary?${fuelParams}`).then((r) => r.json()),
      ])
        .then((results) => {
          const payResults = results.slice(0, branches.length) as Array<{
            success: boolean
            data?: { directLabor: { total: number; detail: PayrollLine[] }; adminPayroll: { total: number } }
          }>
          const rev = results[branches.length] as { success: boolean; data?: { transactions: RevTxn[] }; error?: string }
          const fuel = results[branches.length + 1] as { success: boolean; data?: { transactions: FuelTxn[] }; error?: string }

          if (!rev.success) throw new Error(rev.error)
          if (!fuel.success) throw new Error(fuel.error)

          setBranchPayrolls(
            branches.map((b, i) => {
              const pay = payResults[i]
              if (!pay.success || !pay.data) {
                return { branchId: b.id, directTotal: 0, adminTotal: 0, directDetail: [] }
              }
              return {
                branchId: b.id,
                directTotal: pay.data.directLabor.total,
                adminTotal: pay.data.adminPayroll.total,
                directDetail: pay.data.directLabor.detail ?? [],
              }
            })
          )
          setRevTxns(rev.data?.transactions ?? [])
          setFuelTxns(fuel.data?.transactions ?? [])
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false))
    } else {
      const selectedBranch = branches.find((b) => b.id === selectedBranchId)
      const payParams = new URLSearchParams({
        periodDate,
        branchId: selectedBranchId,
        entityId: selectedBranch?.entityId ?? '',
      })
      const revParams = new URLSearchParams({ startDate, endDate, branchId: selectedBranchId })
      const fuelParams = new URLSearchParams({ startDate, endDate, branchId: selectedBranchId })

      Promise.all([
        fetch(`/api/payroll/summary?${payParams}`).then((r) => r.json()),
        fetch(`/api/revenue/summary?${revParams}`).then((r) => r.json()),
        fetch(`/api/fuel/summary?${fuelParams}`).then((r) => r.json()),
      ])
        .then(([pay, rev, fuel]) => {
          if (!pay.success) throw new Error(pay.error)
          if (!rev.success) throw new Error(rev.error)
          if (!fuel.success) throw new Error(fuel.error)

          setBranchPayrolls([
            {
              branchId: selectedBranchId,
              directTotal: pay.data.directLabor.total,
              adminTotal: pay.data.adminPayroll.total,
              directDetail: pay.data.directLabor.detail ?? [],
            },
          ])
          setRevTxns(rev.data.transactions)
          setFuelTxns(fuel.data.transactions)
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [selectedBranchId, periodsLoaded, periodDate, startDate, endDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trend data ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!periodsLoaded) return
    const extra =
      selectedBranchId !== 'all' ? `&branchId=${selectedBranchId}` : ''
    const rp = `/api/revenue/summary?startDate=${trendStart}&endDate=${periodDate}${extra}`
    const fp = `/api/fuel/summary?startDate=${trendStart}&endDate=${periodDate}${extra}`

    Promise.all([
      fetch(rp).then((r) => r.json()),
      fetch(fp).then((r) => r.json()),
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
  }, [selectedBranchId, periodsLoaded, periodDate, trendStart])

  // ── Derived metrics ───────────────────────────────────────────────────────
  const revenueByBranch = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of revTxns) m[t.branch_id] = (m[t.branch_id] ?? 0) + t.total_revenue
    return m
  }, [revTxns])

  const fuelByBranch = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of fuelTxns) {
      if (t.branch_id) m[t.branch_id] = (m[t.branch_id] ?? 0) + t.total_with_tax
    }
    return m
  }, [fuelTxns])

  const totalRev = Object.values(revenueByBranch).reduce((s, v) => s + v, 0)
  const totalFuel = Object.values(fuelByBranch).reduce((s, v) => s + v, 0)
  const totalDirect = branchPayrolls.reduce((s, b) => s + b.directTotal, 0)
  const totalAdmin = branchPayrolls.reduce((s, b) => s + b.adminTotal, 0)
  const totalPayroll = totalDirect + totalAdmin
  const grossProfit = totalRev - totalPayroll - totalFuel
  const grossProfitPct = totalRev > 0 ? (grossProfit / totalRev) * 100 : null

  // Branch comparison rows (aggregate view)
  const branchRows = useMemo(() => {
    return branches
      .map((b) => {
        const pay = branchPayrolls.find((p) => p.branchId === b.id)
        const rev = revenueByBranch[b.id] ?? 0
        const fuel = fuelByBranch[b.id] ?? 0
        const direct = pay?.directTotal ?? 0
        const admin = pay?.adminTotal ?? 0
        const gross = rev - direct - admin - fuel
        const gpPct = rev > 0 ? (gross / rev) * 100 : null
        return { id: b.id, name: b.name, rev, direct, admin, fuel, gross, gpPct }
      })
      .sort((a, b) => b.rev - a.rev)
  }, [branches, branchPayrolls, revenueByBranch, fuelByBranch])

  // Single-branch direct labor detail
  const activeDirectDetail = branchPayrolls[0]?.directDetail ?? []

  const noData = !loading && totalRev === 0 && totalPayroll === 0 && totalFuel === 0

  const weekLabel = periodDate
    ? `Week ending ${format(parseLocal(periodDate), 'MMM d, yyyy')}`
    : '—'
  const periodLabel = view === 'weekly' ? weekLabel : view.toUpperCase()
  const isAggregate = selectedBranchId === 'all'
  const activeBranchName = branches.find((b) => b.id === selectedBranchId)?.name ?? ''
  const pageTitle = isAggregate ? 'District Overview' : activeBranchName

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
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>{pageTitle}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Branch selector */}
          <select
            value={selectedBranchId}
            onChange={(e) => changeBranch(e.target.value)}
            style={{
              background: '#2a2a2a',
              border: '1px solid #333333',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 13,
              color: '#ff6b00',
              fontFamily: 'inherit',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="all" style={{ background: '#2a2a2a', color: '#ffffff' }}>
              All Assigned Branches
            </option>
            {branches.map((b) => (
              <option key={b.id} value={b.id} style={{ background: '#2a2a2a', color: '#ffffff' }}>
                {b.name}
              </option>
            ))}
          </select>

          {/* Week navigator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#1e1e1e',
              borderRadius: 8,
              padding: '5px 10px',
              border: '1px solid #2a2a2a',
            }}
          >
            <button
              onClick={goPrev}
              disabled={!hasPrev}
              title="Previous week"
              style={{
                background: 'none',
                border: 'none',
                color: hasPrev ? '#cccccc' : '#3a3a3a',
                cursor: hasPrev ? 'pointer' : 'default',
                padding: '0 2px',
                fontSize: 16,
                lineHeight: 1,
                fontFamily: 'inherit',
              }}
            >
              ‹
            </button>
            <span
              style={{
                fontSize: 12,
                color: '#cccccc',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                minWidth: 160,
                textAlign: 'center',
              }}
            >
              {weekLabel}
            </span>
            <button
              onClick={goNext}
              disabled={!hasNext}
              title="Next week"
              style={{
                background: 'none',
                border: 'none',
                color: hasNext ? '#cccccc' : '#3a3a3a',
                cursor: hasNext ? 'pointer' : 'default',
                padding: '0 2px',
                fontSize: 16,
                lineHeight: 1,
                fontFamily: 'inherit',
              }}
            >
              ›
            </button>
          </div>

          {(view === 'mtd' || view === 'ytd') && fiscalMonths.length > 0 && (
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
              <option value="">Calendar {view === 'mtd' ? 'month' : 'year'}</option>
              {fiscalMonths.map((fm) => (
                <option key={fm.id} value={fm.id}>
                  {fm.name}
                </option>
              ))}
            </select>
          )}

          <DateRangePicker value={view} onChange={changeView} />
        </div>
      </div>

      {/* ── Top metric row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
        {loading ? (
          <Skeleton height={140} borderRadius={12} />
        ) : (
          <MetricCard
            variant="hero"
            label="Total Revenue"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(totalRev)}
            chart={
              trendData && trendData.length > 0 ? (
                <div style={{ height: 44 }}>
                  <HeroSparkline data={trendData} />
                </div>
              ) : undefined
            }
          />
        )}

        {loading ? (
          <Skeleton height={140} borderRadius={12} />
        ) : (
          <MetricCard
            label="Direct Payroll"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(totalDirect)}
            delta={totalRev > 0 ? `${formatPercent((totalDirect / totalRev) * 100)} of revenue` : undefined}
            deltaType="down"
          />
        )}

        {loading ? (
          <Skeleton height={140} borderRadius={12} />
        ) : (
          <MetricCard
            label="Admin Payroll"
            sub="Lump sum"
            value={noData ? '—' : formatCurrency(totalAdmin)}
            delta={totalRev > 0 ? `${formatPercent((totalAdmin / totalRev) * 100)} of revenue` : undefined}
            deltaType="down"
          />
        )}

        {loading ? (
          <Skeleton height={140} borderRadius={12} />
        ) : (
          <MetricCard
            label="Total Fuel"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(totalFuel)}
            delta={totalRev > 0 ? `${formatPercent((totalFuel / totalRev) * 100)} of revenue` : undefined}
            deltaType="down"
          />
        )}
      </div>

      {/* ── Variance from target ─────────────────────────────────────────── */}
      <TargetVarianceRow
        branchId={isAggregate ? null : selectedBranchId}
        branchIds={isAggregate ? branches.map((b) => b.id) : null}
        periodDate={periodDate}
        view={view}
        actualRevenue={loading ? null : totalRev}
        actualGrossProfitPct={loading ? null : grossProfitPct}
      />

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.7fr', gap: 12 }}>
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
            13-Week Trend
          </div>
          {trendData ? (
            trendData.length === 0 ? (
              <EmptyState message="No trend data yet." />
            ) : (
              <TrendLineChart data={trendData} height={180} />
            )
          ) : (
            <Skeleton height={180} />
          )}
        </div>

        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
            Profit Breakdown
          </div>
          {loading ? (
            <Skeleton height={180} />
          ) : noData ? (
            <EmptyState message="No data for this period." />
          ) : (
            <WaterfallChart revenue={totalRev} payroll={totalPayroll} fuel={totalFuel} height={180} />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <>
              <Skeleton height={80} borderRadius={12} />
              <Skeleton height={80} borderRadius={12} />
              <Skeleton height={80} borderRadius={12} />
            </>
          ) : (
            <>
              <MetricCard
                label="Gross Profit"
                value={noData ? '—' : formatCurrency(grossProfit)}
                deltaType={grossProfit >= 0 ? 'up' : 'down'}
              />
              <MetricCard
                label="Margin"
                value={grossProfitPct !== null ? formatPercent(grossProfitPct) : '—'}
                deltaType={grossProfitPct !== null && grossProfitPct >= 0 ? 'up' : 'down'}
              />
              <MetricCard
                label="Total Cost"
                sub="Payroll + Fuel"
                value={noData ? '—' : formatCurrency(totalPayroll + totalFuel)}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Aggregate: branch comparison table ── */}
      {isAggregate && (
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
            Branch Comparison — {periodLabel}
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {branches.map((_, i) => (
                <Skeleton key={i} height={32} />
              ))}
            </div>
          ) : noData ? (
            <EmptyState message="No data for this period. Import payroll, revenue, and fuel to populate this table." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    { label: 'Branch', align: 'left' },
                    { label: 'Revenue', align: 'right' },
                    { label: 'Direct Pay', align: 'right' },
                    { label: 'Admin Pay', align: 'right' },
                    { label: 'Fuel', align: 'right' },
                    { label: 'Gross Profit', align: 'right' },
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
                {branchRows.map((row) => (
                  <tr key={row.id} style={{ borderTop: '1px solid #2a2a2a' }}>
                    <td
                      className="table-body branch-name"
                      style={{ padding: '9px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}
                    >
                      {row.name}
                    </td>
                    <td
                      className="table-body"
                      style={{ padding: '9px 10px', textAlign: 'right', color: '#ffffff', fontWeight: 500 }}
                    >
                      {formatCurrency(row.rev)}
                    </td>
                    <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                      {formatCurrency(row.direct)}
                    </td>
                    <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right', color: '#888888' }}>
                      {formatCurrency(row.admin)}
                    </td>
                    <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                      {formatCurrency(row.fuel)}
                    </td>
                    <td
                      className="table-body"
                      style={{
                        padding: '9px 10px',
                        textAlign: 'right',
                        color: row.gross >= 0 ? '#cccccc' : '#cc4444',
                      }}
                    >
                      {formatCurrency(row.gross)}
                    </td>
                    <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                      {row.rev > 0 && row.gpPct !== null ? (
                        <span style={{ color: row.gpPct >= 0 ? '#ff6b00' : '#cc4444' }}>
                          {formatPercent(Math.abs(row.gpPct))}
                        </span>
                      ) : (
                        <span style={{ color: '#555555' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid #333333' }}>
                  <td style={{ padding: '9px 10px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>
                    Total
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#ff6b00' }}>
                    {formatCurrency(totalRev)}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                    {formatCurrency(totalDirect)}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#888888' }}>
                    {formatCurrency(totalAdmin)}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                    {formatCurrency(totalFuel)}
                  </td>
                  <td
                    style={{
                      padding: '9px 10px',
                      textAlign: 'right',
                      fontSize: 12,
                      fontWeight: 500,
                      color: grossProfit >= 0 ? '#cccccc' : '#cc4444',
                    }}
                  >
                    {formatCurrency(grossProfit)}
                  </td>
                  <td
                    style={{
                      padding: '9px 10px',
                      textAlign: 'right',
                      fontSize: 12,
                      color:
                        totalRev > 0
                          ? grossProfitPct !== null && grossProfitPct >= 0
                            ? '#ff6b00'
                            : '#cc4444'
                          : '#555555',
                    }}
                  >
                    {totalRev > 0 && grossProfitPct !== null ? formatPercent(grossProfitPct) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Single branch: direct labor table ── */}
      {!isAggregate && (
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
            Direct Labor — {weekLabel}
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={28} />
              ))}
            </div>
          ) : activeDirectDetail.length === 0 ? (
            <EmptyState message="No direct labor for this period." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Employee', 'Hours', 'Rate', 'Amount'].map((h) => (
                    <th
                      key={h}
                      className="table-header"
                      style={{
                        textAlign: h === 'Employee' ? 'left' : 'right',
                        padding: '0 8px 8px',
                        fontWeight: 400,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...activeDirectDetail]
                  .sort((a, b) => b.amount - a.amount)
                  .map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #2a2a2a' }}>
                      <td className="table-body" style={{ padding: '8px 8px' }}>
                        {row.displayName}
                      </td>
                      <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>
                        {row.hours != null ? row.hours.toFixed(1) : '—'}
                      </td>
                      <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>
                        {row.rate != null ? formatCurrency(row.rate) : '—'}
                      </td>
                      <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>
                        {formatCurrency(row.amount)}
                      </td>
                    </tr>
                  ))}

                {totalAdmin > 0 && (
                  <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                    <td className="table-body" style={{ padding: '8px 8px', color: '#888888' }}>
                      Admin Payroll (lump sum)
                    </td>
                    <td colSpan={2} />
                    <td
                      className="table-body"
                      style={{ padding: '8px 8px', textAlign: 'right', color: '#888888' }}
                    >
                      {formatCurrency(totalAdmin)}
                    </td>
                  </tr>
                )}

                <tr style={{ borderTop: '1px solid #333333' }}>
                  <td style={{ padding: '8px 8px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>
                    Total Payroll
                  </td>
                  <td colSpan={2} />
                  <td
                    style={{
                      padding: '8px 8px',
                      textAlign: 'right',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#ffffff',
                    }}
                  >
                    {formatCurrency(totalPayroll)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
