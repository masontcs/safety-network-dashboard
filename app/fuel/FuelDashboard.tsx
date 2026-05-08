'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Role } from '@/lib/supabase/database.types'
import MetricCard from '@/components/ui/MetricCard'
import BarChart from '@/components/charts/BarChart'
import type { BarChartDataPoint } from '@/components/charts/BarChart'

interface Props {
  role: Role
  branchIds: string[] | null
  branches: Array<{ id: string; name: string }>
}

type Period = 'month' | 'quarter' | 'year'

interface FuelSummary {
  totalWithTax: number
  totalPretax: number
  totalTax: number
  totalGallons: number
}

interface WeekRow {
  weekEndDate: string
  totalCost: number
  totalGallons: number
  avgMpg: number | null
}

interface Consumer {
  employeeId: string
  displayName: string
  branchName: string
  totalGallons: number
  totalCost: number
  avgPpg: number | null
  txnCount: number
}

interface FuelCard {
  id: string
  isConfirmed: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getPeriodDates(period: Period, year: number, month: number, quarter: number): { startDate: string; endDate: string } {
  if (period === 'month') {
    const lastDay = new Date(year, month, 0).getDate()
    return {
      startDate: `${year}-${String(month).padStart(2, '0')}-01`,
      endDate: `${year}-${String(month).padStart(2, '0')}-${lastDay}`,
    }
  }
  if (period === 'quarter') {
    const startMonth = (quarter - 1) * 3 + 1
    const endMonth = quarter * 3
    const lastDay = new Date(year, endMonth, 0).getDate()
    return {
      startDate: `${year}-${String(startMonth).padStart(2, '0')}-01`,
      endDate: `${year}-${String(endMonth).padStart(2, '0')}-${lastDay}`,
    }
  }
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` }
}

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDec(n: number, places = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places })
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${MONTHS[parseInt(m) - 1]} ${parseInt(d)}`
}

export default function FuelDashboard({ role, branchIds, branches }: Props) {
  const router = useRouter()
  const now = new Date()
  const [period, setPeriod] = useState<Period>('month')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3))
  const [selectedBranchId, setSelectedBranchId] = useState<string>('')

  const [summary, setSummary] = useState<FuelSummary | null>(null)
  const [weeks, setWeeks] = useState<WeekRow[]>([])
  const [consumers, setConsumers] = useState<Consumer[]>([])
  const [unlinkedCount, setUnlinkedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const branchParam = selectedBranchId ? `&branchId=${selectedBranchId}`
    : (branchIds?.length === 1 ? `&branchId=${branchIds[0]}` : '')

  const load = useCallback(async () => {
    setLoading(true)
    const { startDate, endDate } = getPeriodDates(period, year, month, quarter)
    const base = `startDate=${startDate}&endDate=${endDate}${branchParam}`

    const [sumRes, weekRes, topRes, cardsRes] = await Promise.all([
      fetch(`/api/fuel/summary?${base}`).then((r) => r.json()),
      fetch(`/api/fuel/by-week?${base}`).then((r) => r.json()),
      fetch(`/api/fuel/top-consumers?${base}&limit=10`).then((r) => r.json()),
      fetch('/api/fuel/cards').then((r) => r.json()),
    ])

    if (sumRes.success) setSummary(sumRes.data)
    if (weekRes.success) setWeeks(weekRes.data)
    if (topRes.success) setConsumers(topRes.data)
    if (cardsRes.success) {
      setUnlinkedCount((cardsRes.data as FuelCard[]).filter((c) => !c.isConfirmed).length)
    }
    setLoading(false)
  }, [period, year, month, quarter, branchParam])

  useEffect(() => { void load() }, [load])

  const chartData: BarChartDataPoint[] = weeks.map((w) => ({
    label: shortDate(w.weekEndDate),
    value: Math.round(w.totalCost * 100) / 100,
  }))

  const avgPpg = summary && summary.totalGallons > 0
    ? summary.totalWithTax / summary.totalGallons
    : null

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)
  const showBranchFilter = (role === 'admin' || role === 'executive' || role === 'district_manager') && branches.length > 1

  const pill = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        padding: '4px 14px',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500,
        background: active ? '#ff6b00' : '#2a2a2a',
        color: active ? '#ffffff' : '#888888',
        transition: 'background 150ms',
      }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ padding: '20px 24px', minHeight: '100%' }}>
      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {pill('Dashboard', true, () => {})}
        {pill('Cards', false, () => router.push('/fuel/cards'))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['month', 'quarter', 'year'] as Period[]).map((p) =>
            pill(p.charAt(0).toUpperCase() + p.slice(1), period === p, () => setPeriod(p))
          )}
        </div>

        {period === 'month' && (
          <>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={selectStyle}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={selectStyle}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        )}
        {period === 'quarter' && (
          <>
            <select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} style={selectStyle}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={selectStyle}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        )}
        {period === 'year' && (
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={selectStyle}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}

        {showBranchFilter && (
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            style={selectStyle}
          >
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <MetricCard
          label="Total Fuel Cost"
          value={loading ? '—' : fmt(summary?.totalWithTax ?? 0)}
          icon={<FuelKpiIcon />}
          variant="hero"
        />
        <MetricCard
          label="Total Gallons"
          value={loading ? '—' : fmtDec(summary?.totalGallons ?? 0, 0)}
          icon={<GallonsIcon />}
        />
        <MetricCard
          label="Avg Cost / Gallon"
          value={loading || avgPpg === null ? '—' : `$${fmtDec(avgPpg, 3)}`}
          icon={<PriceIcon />}
        />
        <MetricCard
          label="Unlinked Cards"
          value={loading ? '—' : String(unlinkedCount)}
          icon={<CardIcon />}
        />
      </div>

      {/* Weekly cost chart */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          Weekly Fuel Cost
        </div>
        {loading ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555555', fontSize: 12 }}>Loading…</div>
        ) : chartData.length === 0 ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555555', fontSize: 12 }}>No data for this period</div>
        ) : (
          <BarChart data={chartData} height={160} color="#cc4444" formatValue={(v) => `$${v.toLocaleString()}`} />
        )}
      </div>

      {/* Top consumers */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
        <div style={{ fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          Top Fuel Consumers
        </div>
        {loading ? (
          <div style={{ color: '#555555', fontSize: 12 }}>Loading…</div>
        ) : consumers.length === 0 ? (
          <div style={{ color: '#555555', fontSize: 12 }}>No data for this period</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Employee', 'Branch', 'Gallons', '$/Gal', 'Total Cost'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, color: '#666666', fontWeight: 400, padding: '0 8px 8px 0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consumers.map((c, i) => (
                <tr key={`${c.employeeId}-${i}`} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: '#cccccc' }}>{c.displayName}</td>
                  <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: '#ff6b00' }}>{c.branchName}</td>
                  <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: '#cccccc' }}>{fmtDec(c.totalGallons, 1)}</td>
                  <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: '#cccccc' }}>
                    {c.avgPpg != null ? `$${fmtDec(c.avgPpg, 3)}` : '—'}
                  </td>
                  <td style={{ padding: '8px 0', fontSize: 12, color: '#cccccc' }}>{fmt(c.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #333333',
  borderRadius: 8,
  padding: '5px 10px',
  fontSize: 12,
  color: '#cccccc',
  cursor: 'pointer',
}

const FuelKpiIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth={1.8}>
    <path d="M3 22V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M3 22h12" />
    <path d="M15 8h2a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2h0" /><path d="M19 22V12" />
    <line x1="7" y1="10" x2="11" y2="10" />
  </svg>
)
const GallonsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth={1.8}>
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
    <path d="M12 6v6l4 2" />
  </svg>
)
const PriceIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth={1.8}>
    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
)
const CardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth={1.8}>
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
  </svg>
)
