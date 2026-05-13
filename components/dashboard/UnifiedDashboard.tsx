'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Role } from '@/lib/supabase/database.types'
import OverviewTab from './tabs/OverviewTab'
import RevenueTab from './tabs/RevenueTab'
import PayrollTab from './tabs/PayrollTab'
import FuelTab from './tabs/FuelTab'
import ProfitsTab from './tabs/ProfitsTab'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FiscalMonth = {
  id: string
  name: string
  year: number
  startDate: string
  endDate: string
  sortOrder: number
}

export type Branch = {
  id: string
  name: string
  isRevenue: boolean
}

type Props = {
  role: Role
  userName: string
  userBranchIds: string[] | null
  branches: Branch[]
  fiscalMonths: FiscalMonth[]
}

type ViewMode = 'month' | 'quarter' | 'year'
type Tab = 'overview' | 'revenue' | 'payroll' | 'fuel' | 'profits'

// ── Overview API shape ────────────────────────────────────────────────────────

export type OverviewTotals = {
  revenue: number
  directPayroll: number
  adminPayroll: number
  employerTaxes: number
  fuel: number
  grossProfit: number
  gpPct: number
  totalGallons: number
  corpOverhead?: number
  hqOverhead?: number
  allocatedFuel?: number
}

export type OverviewPeriod = {
  periodDate: string
  revenue: number
  directPayroll: number
  adminPayroll: number
  employerTaxes: number
  fuel: number
}

export type OverviewBranch = {
  branchId: string
  revenue: number
  labor: number
  rental: number
  oneTime: number
  directPayroll: number
  adminPayroll: number
  employerTaxes: number
  fuel: number
  grossProfit: number
  gpPct: number
  corpOverhead: number
  hqOverhead: number
  allocatedFuel: number
  netAfterAlloc: number
}

// ── Revenue API shape ─────────────────────────────────────────────────────────

export type RevenueTransaction = {
  branch_id: string
  period_date: string
  labor: number
  rental: number
  one_time_charges: number
  total_revenue: number
}

export type RevenueSummary = {
  totalRevenue: number
  labor: number
  rental: number
  oneTimeCharges: number
  salesTax: number
  transactions: RevenueTransaction[]
}

// ── Payroll range API shape ───────────────────────────────────────────────────

export type PayrollLineItem = {
  employeeId: string
  displayName: string
  laborType: string
  amount: number
  hours: number | null
  rate: number | null
  branchId?: string | null
}

export type PayrollRange = {
  total: {
    direct: number
    admin: number
    taxes: number
    directDetail: PayrollLineItem[]
    adminDetail?: PayrollLineItem[]
  }
  byWeek: Array<{ periodDate: string; direct: number; admin: number; taxes: number }>
}

// ── Fuel API shapes ───────────────────────────────────────────────────────────

export type FuelByWeek = Array<{
  weekEndDate: string
  totalCost: number
  totalGallons: number
  avgMpg: number | null
}>

export type FuelConsumer = {
  employeeId: string | null
  displayName: string
  branchName: string
  isGeneral: boolean
  totalGallons: number
  totalCost: number
  avgPpg: number | null
  txnCount: number
}

export type FuelSummary = {
  totalWithTax: number
  totalPretax: number | null
  totalTax: number | null
  totalGallons: number
}

// ── All dashboard data ────────────────────────────────────────────────────────

export type DashboardData = {
  overview: { totals: OverviewTotals; byPeriod: OverviewPeriod[]; byBranch: OverviewBranch[] } | null
  revenue: RevenueSummary | null
  payroll: PayrollRange | null
  fuelByWeek: FuelByWeek | null
  fuelConsumers: FuelConsumer[] | null
  fuelSummary: FuelSummary | null
  loading: boolean
  error: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSaturdaysInMonth(startDate: string, endDate: string): string[] {
  const saturdays: string[] = []
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  const d = new Date(start)
  // Advance to first Saturday
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1)
  while (d <= end) {
    saturdays.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 7)
  }
  return saturdays
}

function getYearRange(year: number): { startDate: string; endDate: string } {
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` }
}

function getQuarterRange(months: FiscalMonth[], quarterIndex: number): { startDate: string; endDate: string } {
  const sorted = [...months].sort((a, b) => a.sortOrder - b.sortOrder)
  const start = sorted[quarterIndex * 3]
  const end = sorted[Math.min(quarterIndex * 3 + 2, sorted.length - 1)]
  if (!start || !end) return { startDate: sorted[0]?.startDate ?? '', endDate: sorted[sorted.length - 1]?.endDate ?? '' }
  return { startDate: start.startDate, endDate: end.endDate }
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function DashboardSkeleton() {
  const [msgIdx, setMsgIdx] = useState(0)
  const messages = [
    'Crunching the numbers…',
    'Tallying up the payroll…',
    'Counting every gallon…',
    'Calculating gross profit…',
    'Adding up the revenue…',
    'Running the reports…',
  ]

  useEffect(() => {
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % messages.length), 2200)
    return () => clearInterval(t)
  }, [])

  return (
    <>
      <style>{`
        @keyframes sn-shimmer {
          0%   { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        @keyframes sn-pulse-dot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
        @keyframes sn-fade-in {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .sn-sk {
          background: linear-gradient(90deg, #252525 25%, #303030 50%, #252525 75%);
          background-size: 400% 100%;
          animation: sn-shimmer 1.6s ease-in-out infinite;
          border-radius: 6px;
        }
        .sn-sk-lt {
          background: linear-gradient(90deg, rgba(255,255,255,0.1) 25%, rgba(255,255,255,0.22) 50%, rgba(255,255,255,0.1) 75%);
          background-size: 400% 100%;
          animation: sn-shimmer 1.6s ease-in-out infinite;
          border-radius: 6px;
        }
      `}</style>

      {/* Status pill */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          background: '#1e1e1e', border: '1px solid #2a2a2a',
          borderRadius: 24, padding: '8px 22px',
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#ff6b00',
            animation: 'sn-pulse-dot 1.4s ease-in-out infinite',
            flexShrink: 0,
          }} />
          <span
            key={msgIdx}
            style={{
              fontSize: 12, color: '#888888', letterSpacing: '0.02em',
              animation: 'sn-fade-in 0.4s ease-out',
              display: 'inline-block',
              minWidth: 210, textAlign: 'center',
            }}
          >
            {messages[msgIdx]}
          </span>
        </div>
      </div>

      {/* Top row: hero + 3 metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Hero revenue card */}
        <div style={{ background: '#ff6b00', borderRadius: 12, padding: 16, overflow: 'hidden' }}>
          <div className="sn-sk-lt" style={{ height: 10, width: '45%', marginBottom: 14 }} />
          <div className="sn-sk-lt" style={{ height: 30, width: '65%', marginBottom: 10 }} />
          <div className="sn-sk-lt" style={{ height: 10, width: '38%', marginBottom: 22 }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 42 }}>
            {[50, 68, 42, 78, 58, 88, 62, 74].map((h, i) => (
              <div
                key={i}
                className="sn-sk-lt"
                style={{ flex: 1, height: `${h}%`, borderRadius: '3px 3px 0 0', animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        </div>
        {/* 3 metric cards */}
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
            <div className="sn-sk" style={{ height: 10, width: '50%', marginBottom: 14, animationDelay: `${i * 0.15}s` }} />
            <div className="sn-sk" style={{ height: 28, width: '70%', marginBottom: 10, animationDelay: `${i * 0.15 + 0.1}s` }} />
            <div className="sn-sk" style={{ height: 9, width: '42%', marginBottom: 16, animationDelay: `${i * 0.15 + 0.2}s` }} />
            <div style={{ height: 4, background: '#222', borderRadius: 2 }}>
              <div className="sn-sk" style={{ width: `${40 + i * 14}%`, height: '100%', borderRadius: 2, animationDelay: `${i * 0.15 + 0.3}s` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Middle row: chart + breakdown + 2 small cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.7fr', gap: 12, marginBottom: 12 }}>
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div className="sn-sk" style={{ height: 10, width: '38%', marginBottom: 20 }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 130 }}>
            {[48, 62, 52, 72, 58, 84, 68, 52, 76, 62, 88, 70].map((h, i) => (
              <div
                key={i}
                className="sn-sk"
                style={{ flex: 1, height: `${h}%`, borderRadius: '3px 3px 0 0', animationDelay: `${i * 0.07}s` }}
              />
            ))}
          </div>
        </div>
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div className="sn-sk" style={{ height: 10, width: '48%', marginBottom: 14 }} />
          <div className="sn-sk" style={{ height: 26, width: '58%', marginBottom: 10 }} />
          <div className="sn-sk" style={{ height: 9, width: '35%', marginBottom: 20 }} />
          <div className="sn-sk" style={{ height: 54, borderRadius: 8 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16, flex: 1 }}>
              <div className="sn-sk" style={{ height: 10, width: '52%', marginBottom: 12, animationDelay: `${i * 0.2}s` }} />
              <div className="sn-sk" style={{ height: 22, width: '65%', marginBottom: 8, animationDelay: `${i * 0.2 + 0.1}s` }} />
              <div className="sn-sk" style={{ height: 9, width: '38%', animationDelay: `${i * 0.2 + 0.2}s` }} />
            </div>
          ))}
        </div>
      </div>

      {/* Table rows */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
        <div className="sn-sk" style={{ height: 10, width: '28%', marginBottom: 18 }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              display: 'flex', gap: 16, alignItems: 'center',
              paddingBottom: 12, marginBottom: i < 4 ? 12 : 0,
              borderBottom: i < 4 ? '1px solid #242424' : 'none',
            }}
          >
            <div className="sn-sk" style={{ height: 10, flex: 2, animationDelay: `${i * 0.08}s` }} />
            <div className="sn-sk" style={{ height: 10, flex: 1, animationDelay: `${i * 0.08 + 0.05}s` }} />
            <div className="sn-sk" style={{ height: 10, flex: 1, animationDelay: `${i * 0.08 + 0.1}s` }} />
            <div className="sn-sk" style={{ height: 10, flex: 1, animationDelay: `${i * 0.08 + 0.15}s` }} />
            <div className="sn-sk" style={{ height: 10, flex: 0.7, animationDelay: `${i * 0.08 + 0.2}s` }} />
          </div>
        ))}
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const VALID_TABS: Tab[] = ['overview', 'revenue', 'payroll', 'fuel', 'profits']

export default function UnifiedDashboard({ role, userName, userBranchIds, branches, fiscalMonths }: Props) {
  const canSeeAllocation = role === 'admin' || role === 'executive'
  const isMultiBranch = userBranchIds === null || userBranchIds.length > 1

  // ── Period selection ────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const sortedMonths = useMemo(
    () => [...fiscalMonths].sort((a, b) => a.year !== b.year ? a.year - b.year : a.sortOrder - b.sortOrder),
    [fiscalMonths]
  )
  const latestMonth = sortedMonths[sortedMonths.length - 1]
  const [selectedMonthId, setSelectedMonthId] = useState<string>(latestMonth?.id ?? '')
  const [selectedQuarterIdx, setSelectedQuarterIdx] = useState<number>(0)
  const [selectedYear, setSelectedYear] = useState<number>(latestMonth?.year ?? new Date().getFullYear())

  // ── Branch filter ───────────────────────────────────────────────────────────
  const [selectedBranchId, setSelectedBranchId] = useState<string>('')

  // ── Allocation toggle ────────────────────────────────────────────────────────
  const [allocationOn, setAllocationOn] = useState<boolean>(false)

  // ── Active tab — initialised from ?tab= query param ────────────────────────
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get('tab')
    return (t && VALID_TABS.includes(t as Tab) ? t : 'overview') as Tab
  })

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && VALID_TABS.includes(t as Tab)) setActiveTab(t as Tab)
  }, [searchParams])

  // ── Data ────────────────────────────────────────────────────────────────────
  const [data, setData] = useState<DashboardData>({
    overview: null, revenue: null, payroll: null,
    fuelByWeek: null, fuelConsumers: null, fuelSummary: null,
    loading: false, error: null,
  })

  // ── Computed date range ─────────────────────────────────────────────────────
  const { startDate, endDate } = useMemo(() => {
    if (viewMode === 'month') {
      const m = sortedMonths.find((m) => m.id === selectedMonthId)
      return m ? { startDate: m.startDate, endDate: m.endDate } : { startDate: '', endDate: '' }
    } else if (viewMode === 'quarter') {
      return getQuarterRange(sortedMonths, selectedQuarterIdx)
    } else {
      return getYearRange(selectedYear)
    }
  }, [viewMode, selectedMonthId, selectedQuarterIdx, selectedYear, sortedMonths])

  const selectedMonth = useMemo(() => sortedMonths.find((m) => m.id === selectedMonthId), [sortedMonths, selectedMonthId])

  // ── Fetch all data when period/branch/allocation changes ────────────────────
  const fetchData = useCallback(async () => {
    if (!startDate || !endDate) return

    setData((prev) => ({ ...prev, loading: true, error: null }))

    try {
      const branchParam = selectedBranchId ? `&branchId=${selectedBranchId}` : ''
      const allocParam = allocationOn && canSeeAllocation ? '&allocation=true' : ''

      const isAdminOrExec = role === 'admin' || role === 'executive'

      const fetches: Array<Promise<Response>> = [
        fetch(`/api/revenue/summary?startDate=${startDate}&endDate=${endDate}${branchParam}`),
        fetch(`/api/payroll/range?startDate=${startDate}&endDate=${endDate}${branchParam}`),
        fetch(`/api/fuel/by-week?startDate=${startDate}&endDate=${endDate}${branchParam}`),
        fetch(`/api/fuel/top-consumers?startDate=${startDate}&endDate=${endDate}${branchParam}&limit=20`),
        fetch(`/api/fuel/summary?startDate=${startDate}&endDate=${endDate}${branchParam}`),
      ]

      if (isAdminOrExec) {
        fetches.unshift(fetch(`/api/admin/overview?startDate=${startDate}&endDate=${endDate}${allocParam}`))
      }

      const responses = await Promise.all(fetches)
      const jsons = await Promise.all(responses.map((r) => r.json()))

      if (isAdminOrExec) {
        const [overviewRes, revRes, payRes, fuelWeekRes, fuelConsRes, fuelSumRes] = jsons
        setData({
          overview: overviewRes.success ? overviewRes.data : null,
          revenue: revRes.success ? revRes.data : null,
          payroll: payRes.success ? payRes.data : null,
          fuelByWeek: fuelWeekRes.success ? fuelWeekRes.data : null,
          fuelConsumers: fuelConsRes.success ? fuelConsRes.data : null,
          fuelSummary: fuelSumRes.success ? fuelSumRes.data : null,
          loading: false,
          error: null,
        })
      } else {
        const [revRes, payRes, fuelWeekRes, fuelConsRes, fuelSumRes] = jsons
        setData({
          overview: null,
          revenue: revRes.success ? revRes.data : null,
          payroll: payRes.success ? payRes.data : null,
          fuelByWeek: fuelWeekRes.success ? fuelWeekRes.data : null,
          fuelConsumers: fuelConsRes.success ? fuelConsRes.data : null,
          fuelSummary: fuelSumRes.success ? fuelSumRes.data : null,
          loading: false,
          error: null,
        })
      }
    } catch {
      setData((prev) => ({ ...prev, loading: false, error: 'Failed to load dashboard data' }))
    }
  }, [startDate, endDate, selectedBranchId, allocationOn, canSeeAllocation, role])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Available years from fiscal months ──────────────────────────────────────
  const availableYears = useMemo(() => [...new Set(sortedMonths.map((m) => m.year))].sort(), [sortedMonths])

  // ── Saturdays in selected month (for revenue target table) ──────────────────
  const monthSaturdays = useMemo(() => {
    if (!selectedMonth) return []
    return getSaturdaysInMonth(selectedMonth.startDate, selectedMonth.endDate)
  }, [selectedMonth])

  // ── Tab config ───────────────────────────────────────────────────────────────
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'fuel', label: 'Fuel' },
    { key: 'profits', label: 'Profits' },
  ]

  const tabProps = {
    role, data, branches, selectedBranchId, allocationOn,
    startDate, endDate, isMultiBranch, monthSaturdays,
    selectedMonth,
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* ── Header row ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Dashboard</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Allocation toggle — admin/exec only */}
          {canSeeAllocation && (
            <button
              onClick={() => setAllocationOn(!allocationOn)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: `1px solid ${allocationOn ? '#ff6b00' : '#333333'}`,
                background: allocationOn ? '#ff6b00' : '#2a2a2a',
                color: '#ffffff',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Corp/HQ {allocationOn ? 'ON' : 'OFF'}
            </button>
          )}

          {/* Branch filter — multi-branch roles */}
          {isMultiBranch && (
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid #333333',
                background: '#2a2a2a',
                color: '#cccccc',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <option value=''>All Branches</option>
              {branches.filter((b) => b.isRevenue).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}

          {/* Period selector */}
          <div style={{ display: 'flex', gap: 4, background: '#2a2a2a', borderRadius: 8, padding: 3 }}>
            {(['month', 'quarter', 'year'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: viewMode === v ? '#ff6b00' : 'transparent',
                  color: viewMode === v ? '#ffffff' : '#888888',
                  fontSize: 12,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Period value selector */}
          {viewMode === 'month' && (
            <select
              value={selectedMonthId}
              onChange={(e) => setSelectedMonthId(e.target.value)}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #333333', background: '#2a2a2a', color: '#cccccc', fontSize: 12 }}
            >
              {[...sortedMonths].reverse().map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}

          {viewMode === 'quarter' && (
            <select
              value={selectedQuarterIdx}
              onChange={(e) => setSelectedQuarterIdx(Number(e.target.value))}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #333333', background: '#2a2a2a', color: '#cccccc', fontSize: 12 }}
            >
              {[0, 1, 2, 3].map((qi) => (
                <option key={qi} value={qi}>Q{qi + 1}</option>
              ))}
            </select>
          )}

          {viewMode === 'year' && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #333333', background: '#2a2a2a', color: '#cccccc', fontSize: 12 }}
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #2a2a2a', marginBottom: 20 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 20px',
              border: 'none',
              background: 'none',
              color: activeTab === t.key ? '#ff6b00' : '#666666',
              fontSize: 13,
              fontWeight: activeTab === t.key ? 500 : 400,
              cursor: 'pointer',
              borderBottom: `2px solid ${activeTab === t.key ? '#ff6b00' : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Loading / error ───────────────────────────────────────────────────── */}
      {data.loading && <DashboardSkeleton />}
      {!data.loading && data.error && (
        <div style={{ color: '#cc4444', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          {data.error}
        </div>
      )}

      {/* ── Tab content ──────────────────────────────────────────────────────── */}
      {!data.loading && !data.error && (
        <>
          {activeTab === 'overview' && <OverviewTab {...tabProps} />}
          {activeTab === 'revenue' && <RevenueTab {...tabProps} />}
          {activeTab === 'payroll' && <PayrollTab {...tabProps} />}
          {activeTab === 'fuel' && <FuelTab {...tabProps} />}
          {activeTab === 'profits' && <ProfitsTab {...tabProps} />}
        </>
      )}
    </div>
  )
}
