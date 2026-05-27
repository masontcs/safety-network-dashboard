'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Role } from '@/lib/supabase/database.types'
import MetricCard from '@/components/ui/MetricCard'
import BarChart from '@/components/charts/BarChart'
import type { BarChartDataPoint } from '@/components/charts/BarChart'

type FiscalMonth = {
  id: string
  name: string
  year: number
  startDate: string
  endDate: string
  sortOrder: number
}

interface Props {
  role: Role
  branchIds: string[] | null
  branches: Array<{ id: string; name: string }>
  fiscalMonths: FiscalMonth[]
}

type ViewMode = 'month' | 'year'

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
  employeeId: string | null
  displayName: string
  branchName: string
  isGeneral: boolean
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

export default function FuelDashboard({ role, branchIds, branches, fiscalMonths }: Props) {
  const router = useRouter()

  // ── Period selection ──────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('month')

  const sortedMonths = useMemo(
    () => [...fiscalMonths].sort((a, b) => a.year !== b.year ? a.year - b.year : a.sortOrder - b.sortOrder),
    [fiscalMonths]
  )
  const latestMonth = sortedMonths[sortedMonths.length - 1]
  const [selectedMonthId, setSelectedMonthId] = useState<string>(latestMonth?.id ?? '')
  const availableYears = useMemo(() => [...new Set(sortedMonths.map((m) => m.year))].sort(), [sortedMonths])
  const [selectedYear, setSelectedYear] = useState<number>(latestMonth?.year ?? new Date().getFullYear())

  const { startDate, endDate } = useMemo(() => {
    if (viewMode === 'month') {
      const m = sortedMonths.find((m) => m.id === selectedMonthId)
      return m ? { startDate: m.startDate, endDate: m.endDate } : { startDate: '', endDate: '' }
    }
    // Year: span from first to last fiscal month in the selected year
    const inYear = sortedMonths.filter((m) => m.year === selectedYear)
    if (inYear.length === 0) return { startDate: '', endDate: '' }
    return { startDate: inYear[0].startDate, endDate: inYear[inYear.length - 1].endDate }
  }, [viewMode, selectedMonthId, selectedYear, sortedMonths])

  // ── Branch filter ─────────────────────────────────────────────────────────
  const [selectedBranchId, setSelectedBranchId] = useState<string>('')

  const branchParam = selectedBranchId ? `&branchId=${selectedBranchId}`
    : (branchIds?.length === 1 ? `&branchId=${branchIds[0]}` : '')

  // ── Data ──────────────────────────────────────────────────────────────────
  const [summary, setSummary] = useState<FuelSummary | null>(null)
  const [weeks, setWeeks] = useState<WeekRow[]>([])
  const [consumers, setConsumers] = useState<Consumer[]>([])
  const [unlinkedCount, setUnlinkedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!startDate || !endDate) return
    setLoading(true)
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
  }, [startDate, endDate, branchParam])

  useEffect(() => { void load() }, [load])

  const chartData: BarChartDataPoint[] = weeks.map((w) => ({
    label: shortDate(w.weekEndDate),
    value: Math.round(w.totalCost * 100) / 100,
  }))

  const avgPpg = summary && summary.totalGallons > 0
    ? summary.totalWithTax / summary.totalGallons
    : null

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
        background: active ? '#ff6b00' : 'var(--bg-secondary)',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
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

      {/* Period + branch filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
        {/* Month / Year toggle */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary)', borderRadius: 8, padding: 3 }}>
          {(['month', 'year'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: 'none',
                background: viewMode === v ? '#ff6b00' : 'transparent',
                color: viewMode === v ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 12,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Fiscal month dropdown */}
        {viewMode === 'month' && (
          <select
            value={selectedMonthId}
            onChange={(e) => setSelectedMonthId(e.target.value)}
            style={selectStyle}
          >
            {[...sortedMonths].reverse().map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}

        {/* Year dropdown */}
        {viewMode === 'year' && (
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            style={selectStyle}
          >
            {[...availableYears].reverse().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}

        {/* Branch filter */}
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
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          Weekly Fuel Cost
        </div>
        {loading ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12 }}>Loading…</div>
        ) : chartData.length === 0 ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No data for this period</div>
        ) : (
          <BarChart data={chartData} height={160} color="#cc4444" formatValue={(v) => `$${v.toLocaleString()}`} />
        )}
      </div>

      {/* Top consumers */}
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          Top Fuel Consumers
        </div>
        {loading ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>Loading…</div>
        ) : consumers.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>No data for this period</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Employee', 'Branch', 'Gallons', '$/Gal', 'Total Cost'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, padding: '0 8px 8px 0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consumers.map((c, i) => (
                <tr key={`${c.employeeId ?? 'general'}-${c.branchName}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: c.isGeneral ? 'var(--text-muted)' : 'var(--text-secondary)', fontStyle: c.isGeneral ? 'italic' : 'normal' }}>{c.displayName}</td>
                  <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: '#ff6b00' }}>{c.branchName}</td>
                  <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: 'var(--text-secondary)' }}>{fmtDec(c.totalGallons, 1)}</td>
                  <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                    {c.avgPpg != null ? `$${fmtDec(c.avgPpg, 3)}` : '—'}
                  </td>
                  <td style={{ padding: '8px 0', fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(c.totalCost)}</td>
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
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  padding: '5px 10px',
  fontSize: 12,
  color: 'var(--text-secondary)',
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
