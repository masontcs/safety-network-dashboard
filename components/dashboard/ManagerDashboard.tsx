'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts'
import MetricCard from '@/components/ui/MetricCard'
import Skeleton from '@/components/ui/Skeleton'
import FiscalMonthVarianceRow from '@/components/targets/FiscalMonthVarianceRow'
import { formatCurrency, formatPercent } from '@/lib/utils/format'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FiscalMonth { id: string; name: string; year: number; start_date: string; end_date: string }
interface RevTxn { period_date: string; labor: number; rental: number; one_time_charges: number; total_revenue: number }
interface FuelTxn { transaction_date: string; total_with_tax: number; vendor: string }
interface PayrollLine { employeeId: string; displayName: string; amount: number; hours: number | null; rate: number | null }
interface WeekPayroll { directTotal: number; adminTotal: number; taxTotal: number; detail: PayrollLine[] }

interface FuelWeek { weekEndDate: string; totalCost: number; totalGallons: number; avgMpg: number | null }
interface TopConsumer { employeeId: string; displayName: string; branchName: string; totalGallons: number; totalCost: number; avgPpg: number | null; txnCount: number }
interface HoursWeek { periodDate: string; standardHours: number; overtimeHours: number; doubleTimeHours: number; totalDirectCost: number }
interface OtEmployee { employeeId: string; displayName: string; branchName: string; regularHours: number; otHours: number; dtHours: number; otPct: number; totalOtDtCost: number }
interface DlRow { employeeId: string; displayName: string; branchName: string; itemName: string; groupName: string; regularHours: number; otHours: number; dtHours: number; totalHours: number; totalAmount: number; avgRate: number | null }

interface Props { branchId: string; entityId: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d))
}

function rangeLabel(s: string, e: string): string { return `${fmtShort(s)} – ${fmtShort(e)}, ${e.split('-')[0]}` }

function getSaturdaysInRange(startDate: string, endDate: string): string[] {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const end = new Date(ey, em - 1, ed)
  const sats: string[] = []
  const d = new Date(sy, sm - 1, sd)
  d.setDate(d.getDate() + 6)
  while (d <= end) {
    sats.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    d.setDate(d.getDate() + 7)
  }
  return sats
}

function snapToSat(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const n = (6 - d.getDay() + 7) % 7
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const h = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return isMobile
}

const selectStyle: React.CSSProperties = {
  background: '#2a2a2a', border: '1px solid #333333', borderRadius: 8,
  padding: '5px 12px', fontSize: 12, color: '#cccccc', fontFamily: 'inherit',
  cursor: 'pointer', outline: 'none',
}

// ── Tooltips ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
      <p style={{ margin: '0 0 4px', color: '#888888' }}>{label}</p>
      {payload.map((p: { name: string; value: number; fill: string }) => (
        <p key={p.name} style={{ margin: '2px 0', color: p.fill }}>{p.name}: {formatCurrency(p.value)}</p>
      ))}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#ffffff' }}>
      <p style={{ margin: '0 0 4px', color: '#888888' }}>{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ margin: '2px 0', color: p.color }}>{p.name}: {formatCurrency(p.value)}</p>
      ))}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HoursTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#ffffff' }}>
      <p style={{ margin: '0 0 4px', color: '#888888' }}>{label}</p>
      {payload.map((p: { name: string; value: number; fill: string }) => (
        <p key={p.name} style={{ margin: '2px 0', color: p.fill }}>{p.name}: {p.value.toFixed(1)} hrs</p>
      ))}
    </div>
  )
}

// ── SelectedWeekPanel ─────────────────────────────────────────────────────────

function SelectedWeekPanel({ periodDate, directTotal, adminTotal, taxTotal, detail, onDismiss }: {
  periodDate: string; directTotal: number; adminTotal: number; taxTotal: number
  detail: PayrollLine[]; onDismiss: () => void
}) {
  const totalPayroll = directTotal + adminTotal + taxTotal
  return (
    <div style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 12, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#cccccc' }}>Direct Labor — week ending {fmtShort(periodDate)}</span>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#666666', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px', fontFamily: 'inherit' }}>×</button>
      </div>
      {detail.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Employee', 'Hours', 'Rate', 'Amount'].map((h) => (
                <th key={h} className="table-header" style={{ textAlign: h === 'Employee' ? 'left' : 'right', padding: '0 8px 8px', fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...detail].sort((a, b) => b.amount - a.amount).map((row) => (
              <tr key={row.employeeId} style={{ borderTop: '1px solid #2a2a2a' }}>
                <td className="table-body" style={{ padding: '7px 8px' }}>{row.displayName}</td>
                <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{row.hours != null ? row.hours.toFixed(1) : '—'}</td>
                <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{row.rate != null ? formatCurrency(row.rate) : '—'}</td>
                <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{formatCurrency(row.amount)}</td>
              </tr>
            ))}
            {adminTotal > 0 && (
              <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                <td className="table-body" style={{ padding: '7px 8px', color: '#888888' }}>Admin Payroll (lump sum)</td>
                <td colSpan={2} />
                <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right', color: '#888888' }}>{formatCurrency(adminTotal)}</td>
              </tr>
            )}
            <tr style={{ borderTop: '1px solid #333333' }}>
              <td style={{ padding: '7px 8px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>Total Payroll</td>
              <td colSpan={2} />
              <td style={{ padding: '7px 8px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>{formatCurrency(totalPayroll)}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 12, color: '#888888' }}>No direct labor this week.</div>
      )}
    </div>
  )
}

// ── RevBreakdownTable ─────────────────────────────────────────────────────────

function RevBreakdownTable({ saturdays, revByWeek, loading }: {
  saturdays: string[]
  revByWeek: Record<string, { labor: number; rental: number; oneTime: number; total: number }>
  loading: boolean
}) {
  const tL = saturdays.reduce((s, sat) => s + (revByWeek[sat]?.labor ?? 0), 0)
  const tR = saturdays.reduce((s, sat) => s + (revByWeek[sat]?.rental ?? 0), 0)
  const tO = saturdays.reduce((s, sat) => s + (revByWeek[sat]?.oneTime ?? 0), 0)
  const tA = saturdays.reduce((s, sat) => s + (revByWeek[sat]?.total ?? 0), 0)
  return (
    <div className="card">
      <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Revenue Breakdown</div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={28} />)}</div>
      ) : saturdays.length === 0 ? (
        <div style={{ fontSize: 12, color: '#555555', padding: '16px 0' }}>No data for this period.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Week Ending', 'Labor', 'Rental', 'One-Time', 'Total'].map((h) => (
              <th key={h} className="table-header" style={{ textAlign: h === 'Week Ending' ? 'left' : 'right', padding: '0 8px 8px', fontWeight: 400 }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {saturdays.map((sat) => {
              const row = revByWeek[sat]
              return (
                <tr key={sat} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td className="table-body" style={{ padding: '8px 8px' }}>{fmtShort(sat)}</td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>{row ? formatCurrency(row.labor) : '—'}</td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>{row ? formatCurrency(row.rental) : '—'}</td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>{row ? formatCurrency(row.oneTime) : '—'}</td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right', color: '#ffffff', fontWeight: 500 }}>{row ? formatCurrency(row.total) : '—'}</td>
                </tr>
              )
            })}
            <tr style={{ borderTop: '1px solid #333333' }}>
              <td style={{ padding: '8px 8px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>Total</td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>{formatCurrency(tL)}</td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>{formatCurrency(tR)}</td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>{formatCurrency(tO)}</td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#ff6b00' }}>{formatCurrency(tA)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── WeeklyTrendChart ──────────────────────────────────────────────────────────

function WeeklyTrendChart({ data, loading }: {
  data: Array<{ label: string; revenue: number; payroll: number; fuel: number }>
  loading: boolean
}) {
  const hasData = data.some((d) => d.revenue > 0 || d.payroll > 0 || d.fuel > 0)
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff' }}>Weekly Trend</div>
        <div style={{ display: 'flex', gap: 12, fontSize: 9, color: '#888888' }}>
          {[['Revenue', '#ff6b00'], ['Payroll', '#888888'], ['Fuel', '#cc4444']].map(([label, color]) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ display: 'inline-block', width: 16, height: 2, background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>
      {loading ? <Skeleton height={100} /> : !hasData ? (
        <div style={{ fontSize: 12, color: '#555555', textAlign: 'center', padding: '24px 0' }}>No data for this period.</div>
      ) : (
        <ResponsiveContainer width="100%" height={100}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222222" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#333333', strokeWidth: 1 }} />
            <Line dataKey="revenue" name="Revenue" stroke="#ff6b00" strokeWidth={1.5} dot={{ r: 3, fill: '#ff6b00', strokeWidth: 0 }} activeDot={{ r: 4 }} />
            <Line dataKey="payroll" name="Payroll" stroke="#888888" strokeWidth={1.5} dot={{ r: 3, fill: '#888888', strokeWidth: 0 }} activeDot={{ r: 4 }} />
            <Line dataKey="fuel" name="Fuel" stroke="#cc4444" strokeWidth={1.5} dot={{ r: 3, fill: '#cc4444', strokeWidth: 0 }} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── FuelAnalyticsSection ──────────────────────────────────────────────────────

function FuelAnalyticsSection({
  fuelByWeekClient,
  topConsumers,
  vendorTotals,
  fuelWeekApiData,
  saturdays,
  loading,
  isMobile,
}: {
  fuelByWeekClient: Record<string, number>
  topConsumers: TopConsumer[]
  vendorTotals: { interstate: number; flyers: number }
  fuelWeekApiData: FuelWeek[]
  saturdays: string[]
  loading: boolean
  isMobile: boolean
}) {
  const weeklyFuelData = saturdays.map((sat) => ({ label: fmtShort(sat), cost: fuelByWeekClient[sat] ?? 0 }))
  const mpgData = fuelWeekApiData.filter((w) => w.avgMpg != null).map((w) => ({ label: fmtShort(w.weekEndDate), mpg: w.avgMpg ?? 0 }))
  const hasMpg = mpgData.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', paddingTop: 4 }}>Fuel Analytics</div>

      {!isMobile && (
        <>
          {/* Weekly fuel cost line */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>Weekly Fuel Cost</div>
            {loading ? <Skeleton height={80} /> : (
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={weeklyFuelData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222222" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [formatCurrency(v), 'Fuel Cost']} labelStyle={{ color: '#888888' }} />
                  <Line dataKey="cost" name="Fuel Cost" stroke="#cc4444" strokeWidth={1.5} dot={{ r: 3, fill: '#cc4444', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}

      {/* Vendor cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { label: 'Interstate', value: vendorTotals.interstate, color: '#ff6b00' },
          { label: 'Flyers', value: vendorTotals.flyers, color: '#888888' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card" style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: loading ? '#444444' : color }}>{loading ? '—' : formatCurrency(value)}</div>
          </div>
        ))}
      </div>

      {/* Top consumers table */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>
          Top Fuel Consumers{isMobile ? ' (Top 5)' : ' (Top 10)'}
        </div>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={28} />)}</div>
        ) : topConsumers.length === 0 ? (
          <div style={{ fontSize: 12, color: '#555555', padding: '8px 0' }}>No employee fuel data for this period.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Employee', 'Gallons', 'Cost', 'Avg $/Gal', 'Transactions'].map((h) => (
                  <th key={h} className="table-header" style={{ textAlign: h === 'Employee' ? 'left' : 'right', padding: '0 8px 8px', fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(isMobile ? topConsumers.slice(0, 5) : topConsumers).map((r) => (
                <tr key={r.employeeId} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td className="table-body" style={{ padding: '7px 8px' }}>{r.displayName}</td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{r.totalGallons.toFixed(1)}</td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right', color: '#ffffff', fontWeight: 500 }}>{formatCurrency(r.totalCost)}</td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{r.avgPpg != null ? `$${r.avgPpg.toFixed(3)}` : '—'}</td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{r.txnCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* MPG trend (only if data exists) */}
      {!isMobile && hasMpg && (
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>Fleet Avg MPG Trend</div>
          <ResponsiveContainer width="100%" height={80}>
            <LineChart data={mpgData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222222" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip contentStyle={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [v.toFixed(1), 'Avg MPG']} labelStyle={{ color: '#888888' }} />
              <Line dataKey="mpg" name="Avg MPG" stroke="#ff6b00" strokeWidth={1.5} dot={{ r: 3, fill: '#ff6b00', strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── PayrollAnalyticsSection ───────────────────────────────────────────────────

function PayrollAnalyticsSection({
  hoursWeekly,
  weeklyPayroll,
  saturdays,
  overtimeSummary,
  directLaborDetail,
  loading,
  isMobile,
}: {
  hoursWeekly: HoursWeek[]
  weeklyPayroll: Record<string, WeekPayroll>
  saturdays: string[]
  overtimeSummary: OtEmployee[]
  directLaborDetail: DlRow[]
  loading: boolean
  isMobile: boolean
}) {
  const [dlSearch, setDlSearch] = useState('')
  const [dlSort, setDlSort] = useState<{ key: keyof DlRow; dir: 'asc' | 'desc' }>({ key: 'displayName', dir: 'asc' })
  const [dlPage, setDlPage] = useState(0)
  const PAGE_SIZE = 25

  // Payroll cost per week from existing weeklyPayroll
  const payrollCostData = saturdays.map((sat) => ({
    label: fmtShort(sat),
    cost: (weeklyPayroll[sat]?.directTotal ?? 0) + (weeklyPayroll[sat]?.adminTotal ?? 0) + (weeklyPayroll[sat]?.taxTotal ?? 0),
  }))

  // Hours bar data
  const hoursMap: Record<string, HoursWeek> = {}
  for (const w of hoursWeekly) hoursMap[w.periodDate] = w
  const hoursBarData = saturdays.map((sat) => ({
    label: fmtShort(sat),
    standard: hoursMap[sat]?.standardHours ?? 0,
    overtime: hoursMap[sat]?.overtimeHours ?? 0,
    doubleTime: hoursMap[sat]?.doubleTimeHours ?? 0,
  }))

  // Payroll group breakdown totals
  const stdTotal = hoursWeekly.reduce((s, w) => s + w.standardHours, 0)
  const otTotal = hoursWeekly.reduce((s, w) => s + w.overtimeHours, 0)
  const dtTotal = hoursWeekly.reduce((s, w) => s + w.doubleTimeHours, 0)
  const allHours = stdTotal + otTotal + dtTotal

  // Direct labor detail table
  const filtered = useMemo(() => {
    const q = dlSearch.toLowerCase()
    const rows = q ? directLaborDetail.filter((r) => r.displayName.toLowerCase().includes(q) || r.itemName.toLowerCase().includes(q)) : directLaborDetail
    const sorted = [...rows].sort((a, b) => {
      const av = a[dlSort.key] ?? ''
      const bv = b[dlSort.key] ?? ''
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return dlSort.dir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [directLaborDetail, dlSearch, dlSort])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice(dlPage * PAGE_SIZE, dlPage * PAGE_SIZE + PAGE_SIZE)

  function toggleSort(key: keyof DlRow) {
    setDlSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
    setDlPage(0)
  }

  function SortIcon({ col }: { col: keyof DlRow }) {
    if (dlSort.key !== col) return <span style={{ color: '#444444', marginLeft: 2 }}>↕</span>
    return <span style={{ color: '#ff6b00', marginLeft: 2 }}>{dlSort.dir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', paddingTop: 4 }}>Payroll Analytics</div>

      {!isMobile && (
        <>
          {/* Weekly hours stacked bar */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>Weekly Direct Labor Hours</div>
            {loading ? <Skeleton height={120} /> : (
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={hoursBarData} barCategoryGap="25%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222222" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={<HoursTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 10, color: '#888888', paddingTop: 6 }} />
                  <Bar dataKey="standard" name="Standard" stackId="a" fill="#ff6b00" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="overtime" name="Overtime" stackId="a" fill="#ffaa00" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="doubleTime" name="Double-time" stackId="a" fill="#cc4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Weekly payroll cost */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>Weekly Payroll Cost</div>
            {loading ? <Skeleton height={80} /> : (
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={payrollCostData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222222" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [formatCurrency(v), 'Total Payroll']} labelStyle={{ color: '#888888' }} />
                  <Line dataKey="cost" name="Total Payroll" stroke="#888888" strokeWidth={1.5} dot={{ r: 3, fill: '#888888', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Hours group breakdown */}
          {!loading && allHours > 0 && (
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Hours Breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: 'Standard Time', hours: stdTotal, color: '#ff6b00' },
                  { label: 'Overtime', hours: otTotal, color: '#ffaa00' },
                  { label: 'Double-time', hours: dtTotal, color: '#cc4444' },
                ].map(({ label, hours, color }) => {
                  const pct = allHours > 0 ? (hours / allHours) * 100 : 0
                  return (
                    <div key={label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: '#cccccc' }}>{label}</span>
                        <span style={{ color: '#888888' }}>{hours.toFixed(1)} hrs ({pct.toFixed(1)}%)</span>
                      </div>
                      <div style={{ height: 4, background: '#2a2a2a', borderRadius: 2 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Top overtime employees */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>
          Top Overtime Employees{isMobile ? ' (Top 5)' : ' (Top 10)'}
        </div>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={28} />)}</div>
        ) : overtimeSummary.length === 0 ? (
          <div style={{ fontSize: 12, color: '#555555', padding: '8px 0' }}>No overtime for this period.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Employee', 'Reg Hrs', 'OT Hrs', 'DT Hrs', 'OT %', 'OT/DT Cost'].map((h) => (
                  <th key={h} className="table-header" style={{ textAlign: h === 'Employee' ? 'left' : 'right', padding: '0 8px 8px', fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(isMobile ? overtimeSummary.slice(0, 5) : overtimeSummary).map((r) => (
                <tr key={r.employeeId} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td className="table-body" style={{ padding: '7px 8px' }}>{r.displayName}</td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{r.regularHours.toFixed(1)}</td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right', color: '#ffaa00' }}>{r.otHours.toFixed(1)}</td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right', color: '#cc4444' }}>{r.dtHours.toFixed(1)}</td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{r.otPct.toFixed(1)}%</td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right', color: '#ffffff', fontWeight: 500 }}>{formatCurrency(r.totalOtDtCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Direct Labor Detail table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff' }}>Direct Labor Detail</div>
          <input
            type="text"
            value={dlSearch}
            onChange={(e) => { setDlSearch(e.target.value); setDlPage(0) }}
            placeholder="Search employee or code…"
            style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: '#cccccc', outline: 'none', fontFamily: 'inherit', width: isMobile ? '100%' : 220 }}
          />
        </div>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={32} />)}</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 480 : undefined }}>
                <thead>
                  <tr>
                    {([
                      { label: 'Employee', key: 'displayName' as keyof DlRow, align: 'left' },
                      ...(isMobile ? [] : [{ label: 'Code', key: 'itemName' as keyof DlRow, align: 'left' }]),
                      { label: 'Reg Hrs', key: 'regularHours' as keyof DlRow, align: 'right' },
                      { label: 'OT Hrs', key: 'otHours' as keyof DlRow, align: 'right' },
                      ...(isMobile ? [] : [{ label: 'DT Hrs', key: 'dtHours' as keyof DlRow, align: 'right' }]),
                      { label: 'Amount', key: 'totalAmount' as keyof DlRow, align: 'right' },
                      ...(isMobile ? [] : [{ label: 'Avg Rate', key: 'avgRate' as keyof DlRow, align: 'right' }]),
                    ] as Array<{ label: string; key: keyof DlRow; align: string }>).map(({ label, key, align }) => (
                      <th
                        key={label}
                        className="table-header"
                        onClick={() => toggleSort(key)}
                        style={{ textAlign: align as 'left' | 'right', padding: '0 8px 8px', fontWeight: 400, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        {label}<SortIcon col={key} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={isMobile ? 4 : 7} style={{ padding: '16px 8px', fontSize: 12, color: '#555555', textAlign: 'center' }}>No results.</td></tr>
                  ) : pageRows.map((r, i) => (
                    <tr key={`${r.employeeId}-${r.itemName}-${i}`} style={{ borderTop: '1px solid #2a2a2a' }}>
                      <td className="table-body" style={{ padding: '7px 8px' }}>{r.displayName}</td>
                      {!isMobile && <td className="table-body" style={{ padding: '7px 8px', color: '#888888' }}>{r.itemName}</td>}
                      <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{r.regularHours > 0 ? r.regularHours.toFixed(1) : '—'}</td>
                      <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right', color: r.otHours > 0 ? '#ffaa00' : '#cccccc' }}>{r.otHours > 0 ? r.otHours.toFixed(1) : '—'}</td>
                      {!isMobile && <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right', color: r.dtHours > 0 ? '#cc4444' : '#cccccc' }}>{r.dtHours > 0 ? r.dtHours.toFixed(1) : '—'}</td>}
                      <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right', color: '#ffffff', fontWeight: 500 }}>{formatCurrency(r.totalAmount)}</td>
                      {!isMobile && <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>{r.avgRate != null ? formatCurrency(r.avgRate) : '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 12, color: '#888888' }}>
                <span>{filtered.length} rows · page {dlPage + 1} of {totalPages}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={dlPage === 0} onClick={() => setDlPage((p) => p - 1)} style={{ background: '#2a2a2a', border: 'none', borderRadius: 4, padding: '4px 10px', color: dlPage === 0 ? '#444444' : '#cccccc', cursor: dlPage === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>← Prev</button>
                  <button disabled={dlPage >= totalPages - 1} onClick={() => setDlPage((p) => p + 1)} style={{ background: '#2a2a2a', border: 'none', borderRadius: 4, padding: '4px 10px', color: dlPage >= totalPages - 1 ? '#444444' : '#cccccc', cursor: dlPage >= totalPages - 1 ? 'default' : 'pointer', fontFamily: 'inherit' }}>Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManagerDashboard({ branchId, entityId }: Props) {
  // Period selection
  const [fiscalMonths, setFiscalMonths] = useState<FiscalMonth[]>([])
  const [selectedFiscalId, setSelectedFiscalId] = useState<string>('')
  const [isYTD, setIsYTD] = useState(false)

  // Main data
  const [revTxns, setRevTxns] = useState<RevTxn[]>([])
  const [fuelTxns, setFuelTxns] = useState<FuelTxn[]>([])
  const [weeklyPayroll, setWeeklyPayroll] = useState<Record<string, WeekPayroll>>({})
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Analytics data
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [fuelWeekApiData, setFuelWeekApiData] = useState<FuelWeek[]>([])
  const [topConsumers, setTopConsumers] = useState<TopConsumer[]>([])
  const [hoursWeekly, setHoursWeekly] = useState<HoursWeek[]>([])
  const [overtimeSummary, setOvertimeSummary] = useState<OtEmployee[]>([])
  const [directLaborDetail, setDirectLaborDetail] = useState<DlRow[]>([])

  const isMobile = useIsMobile()

  // On mount: load fiscal months and find most recent with data
  useEffect(() => {
    Promise.all([
      fetch('/api/fiscal-months').then((r) => r.json()),
      fetch('/api/periods/available').then((r) => r.json()),
    ]).then(([fmJson, periodsJson]) => {
      if (!fmJson.success) return
      const fms: FiscalMonth[] = fmJson.data
      setFiscalMonths(fms)
      const periods: string[] = periodsJson.success ? periodsJson.data : []
      const mostRecent = periods[0] ?? null
      const match = mostRecent ? fms.find((fm) => fm.start_date <= mostRecent && mostRecent <= fm.end_date) : null
      setSelectedFiscalId(match?.id ?? fms[0]?.id ?? '')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedFiscal = useMemo(() => fiscalMonths.find((fm) => fm.id === selectedFiscalId) ?? null, [fiscalMonths, selectedFiscalId])

  const { startDate, endDate } = useMemo(() => {
    if (isYTD) {
      const year = new Date().getFullYear()
      return { startDate: `${year}-01-01`, endDate: fiscalMonths[0]?.end_date ?? `${year}-12-31` }
    }
    if (selectedFiscal) return { startDate: selectedFiscal.start_date, endDate: selectedFiscal.end_date }
    return { startDate: '', endDate: '' }
  }, [isYTD, selectedFiscal, fiscalMonths])

  const saturdays = useMemo(() => (startDate && endDate ? getSaturdaysInRange(startDate, endDate) : []), [startDate, endDate])

  // Main + analytics fetch
  useEffect(() => {
    if (!startDate || !endDate) return
    setLoading(true)
    setAnalyticsLoading(true)
    setError(null)
    setSelectedWeek(null)

    const weeks = getSaturdaysInRange(startDate, endDate)
    const rangeParams = new URLSearchParams({ branchId, startDate, endDate })
    const payrollCalls = weeks.map((sat) =>
      fetch(`/api/payroll/summary?${new URLSearchParams({ branchId, periodDate: sat, entityId })}`).then((r) => r.json())
    )

    Promise.all([
      fetch(`/api/revenue/summary?${rangeParams}`).then((r) => r.json()),
      fetch(`/api/fuel/summary?${rangeParams}`).then((r) => r.json()),
      fetch(`/api/fuel/by-week?${rangeParams}`).then((r) => r.json()),
      fetch(`/api/fuel/top-consumers?${rangeParams}`).then((r) => r.json()),
      fetch(`/api/payroll/hours-by-week?${rangeParams}`).then((r) => r.json()),
      fetch(`/api/payroll/overtime-summary?${rangeParams}`).then((r) => r.json()),
      fetch(`/api/payroll/direct-labor-detail?${rangeParams}`).then((r) => r.json()),
      ...payrollCalls,
    ])
      .then(([rev, fuel, fuelWk, topCons, hoursWk, otSum, dlDetail, ...payResults]) => {
        if (!rev.success) throw new Error(rev.error)
        if (!fuel.success) throw new Error(fuel.error)
        setRevTxns(rev.data.transactions ?? [])
        setFuelTxns(fuel.data.transactions ?? [])

        if (fuelWk.success) setFuelWeekApiData(fuelWk.data)
        if (topCons.success) setTopConsumers(topCons.data)
        if (hoursWk.success) setHoursWeekly(hoursWk.data)
        if (otSum.success) setOvertimeSummary(otSum.data)
        if (dlDetail.success) setDirectLaborDetail(dlDetail.data)

        const payMap: Record<string, WeekPayroll> = {}
        weeks.forEach((sat, i) => {
          const pay = payResults[i]
          if (pay.success) {
            payMap[sat] = {
              directTotal: pay.data.directLabor.total,
              adminTotal: pay.data.adminPayroll.total,
              taxTotal: pay.data.taxes?.total ?? 0,
              detail: pay.data.directLabor.detail ?? [],
            }
          }
        })
        setWeeklyPayroll(payMap)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => { setLoading(false); setAnalyticsLoading(false) })
  }, [branchId, entityId, startDate, endDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived metrics ───────────────────────────────────────────────────────

  const revByWeek = useMemo(() => {
    const m: Record<string, { labor: number; rental: number; oneTime: number; total: number }> = {}
    for (const t of revTxns) {
      if (!m[t.period_date]) m[t.period_date] = { labor: 0, rental: 0, oneTime: 0, total: 0 }
      m[t.period_date].labor += t.labor
      m[t.period_date].rental += t.rental
      m[t.period_date].oneTime += t.one_time_charges
      m[t.period_date].total += t.total_revenue
    }
    return m
  }, [revTxns])

  const fuelByWeek = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of fuelTxns) {
      const sat = snapToSat(t.transaction_date)
      m[sat] = (m[sat] ?? 0) + t.total_with_tax
    }
    return m
  }, [fuelTxns])

  const vendorTotals = useMemo(() => {
    let interstate = 0, flyers = 0
    for (const t of fuelTxns) {
      if (t.vendor?.toLowerCase().includes('interstate')) interstate += t.total_with_tax
      else flyers += t.total_with_tax
    }
    return { interstate, flyers }
  }, [fuelTxns])

  const totalRev = revTxns.reduce((s, t) => s + t.total_revenue, 0)
  const totalFuel = fuelTxns.reduce((s, t) => s + t.total_with_tax, 0)
  const totalDirect = Object.values(weeklyPayroll).reduce((s, w) => s + w.directTotal, 0)
  const totalAdmin = Object.values(weeklyPayroll).reduce((s, w) => s + w.adminTotal, 0)
  const totalTax = Object.values(weeklyPayroll).reduce((s, w) => s + w.taxTotal, 0)
  const totalPayroll = totalDirect + totalAdmin + totalTax
  const grossProfit = totalRev - totalPayroll - totalFuel
  const grossProfitPct = totalRev > 0 ? (grossProfit / totalRev) * 100 : null
  const noData = !loading && totalRev === 0 && totalPayroll === 0 && totalFuel === 0

  const barData = useMemo(() => saturdays.map((sat) => ({
    periodDate: sat,
    label: fmtShort(sat),
    revenue: revByWeek[sat]?.total ?? 0,
    directPayroll: weeklyPayroll[sat]?.directTotal ?? 0,
    fuel: fuelByWeek[sat] ?? 0,
  })), [saturdays, revByWeek, weeklyPayroll, fuelByWeek])

  const trendData = useMemo(() => saturdays.map((sat) => ({
    label: fmtShort(sat),
    revenue: revByWeek[sat]?.total ?? 0,
    payroll: (weeklyPayroll[sat]?.directTotal ?? 0) + (weeklyPayroll[sat]?.adminTotal ?? 0) + (weeklyPayroll[sat]?.taxTotal ?? 0),
    fuel: fuelByWeek[sat] ?? 0,
  })), [saturdays, revByWeek, weeklyPayroll, fuelByWeek])

  const selectedWeekData = selectedWeek ? (weeklyPayroll[selectedWeek] ?? null) : null
  const periodLabel = startDate && endDate ? rangeLabel(startDate, endDate) : '—'

  if (error) {
    return (
      <div style={{ padding: 32, color: '#cc4444', fontSize: 13 }}>
        Failed to load dashboard: {error}
        <button onClick={() => window.location.reload()} style={{ marginLeft: 12, color: '#ff6b00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>Retry</button>
      </div>
    )
  }

  if (fiscalMonths.length === 0 && !loading) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', marginBottom: 16 }}>Overview</div>
        <div className="card" style={{ padding: 24 }}>
          <p style={{ color: '#888888', fontSize: 13, margin: 0 }}>No fiscal months available. Contact your administrator.</p>
        </div>
      </div>
    )
  }

  // ── Period selector (shared) ───────────────────────────────────────────────

  const selectorBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <select value={selectedFiscalId} onChange={(e) => { setIsYTD(false); setSelectedFiscalId(e.target.value) }} style={selectStyle}>
        {fiscalMonths.map((fm) => <option key={fm.id} value={fm.id}>{fm.name}</option>)}
      </select>
      <button
        onClick={() => setIsYTD((v) => !v)}
        style={{ background: isYTD ? '#ff6b00' : '#2a2a2a', border: '1px solid #333333', borderRadius: 8, padding: '5px 12px', fontSize: 12, color: isYTD ? '#ffffff' : '#888888', cursor: 'pointer', fontFamily: 'inherit', fontWeight: isYTD ? 500 : 400, whiteSpace: 'nowrap' }}
      >
        YTD
      </button>
    </div>
  )

  // ── Mobile render ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {selectorBar}

        {/* 2×2 metric cards */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={80} borderRadius={12} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: '#ff6b00', borderRadius: 12, padding: '12px 14px', minHeight: 80 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Revenue</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff' }}>{noData ? '—' : formatCurrency(totalRev)}</div>
            </div>
            <div className="card" style={{ padding: '12px 14px', minHeight: 80 }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>Direct Pay</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff' }}>{noData ? '—' : formatCurrency(totalDirect)}</div>
            </div>
            <div className="card" style={{ padding: '12px 14px', minHeight: 80 }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>Fuel Cost</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff' }}>{noData ? '—' : formatCurrency(totalFuel)}</div>
            </div>
            <div className="card" style={{ padding: '12px 14px', minHeight: 80 }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>Gross Profit</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: noData ? '#888888' : grossProfit >= 0 ? '#ffffff' : '#cc4444' }}>
                {noData ? '—' : formatCurrency(grossProfit)}
              </div>
              {!noData && grossProfitPct !== null && (
                <div style={{ fontSize: 11, color: grossProfit >= 0 ? '#ff6b00' : '#cc4444', marginTop: 2 }}>{grossProfitPct.toFixed(1)}% margin</div>
              )}
            </div>
          </div>
        )}

        {/* Admin payroll card */}
        {!loading && !noData && (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Admin Payroll</span>
            <span style={{ fontSize: 16, fontWeight: 500, color: '#888888' }}>{formatCurrency(totalAdmin)}</span>
            <span style={{ fontSize: 10, color: '#555555' }}>lump sum only</span>
          </div>
        )}

        {/* Revenue chart */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>Weekly Revenue</div>
          {loading ? <Skeleton height={160} /> : barData.length === 0 ? (
            <div style={{ fontSize: 12, color: '#555555', textAlign: 'center', padding: '20px 0' }}>No data for this period.</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={barData} barCategoryGap="30%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="revenue" name="Revenue" fill="#ff6b00" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(entry: { periodDate: string }) => setSelectedWeek((p) => p === entry.periodDate ? null : entry.periodDate)}>
                  {barData.map((e) => <Cell key={e.periodDate} fill={selectedWeek === e.periodDate ? '#ffaa44' : '#ff6b00'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {selectedWeek && selectedWeekData && (
          <SelectedWeekPanel periodDate={selectedWeek} directTotal={selectedWeekData.directTotal} adminTotal={selectedWeekData.adminTotal} taxTotal={selectedWeekData.taxTotal} detail={selectedWeekData.detail} onDismiss={() => setSelectedWeek(null)} />
        )}

        {/* Fuel analytics — top 5 consumers only on mobile */}
        <FuelAnalyticsSection
          fuelByWeekClient={fuelByWeek}
          topConsumers={topConsumers}
          vendorTotals={vendorTotals}
          fuelWeekApiData={fuelWeekApiData}
          saturdays={saturdays}
          loading={analyticsLoading}
          isMobile
        />

        {/* Payroll analytics — OT table only on mobile */}
        <PayrollAnalyticsSection
          hoursWeekly={hoursWeekly}
          weeklyPayroll={weeklyPayroll}
          saturdays={saturdays}
          overtimeSummary={overtimeSummary}
          directLaborDetail={directLaborDetail}
          loading={analyticsLoading}
          isMobile
        />

        <RevBreakdownTable saturdays={saturdays} revByWeek={revByWeek} loading={loading} />
      </div>
    )
  }

  // ── Desktop render ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Overview</div>
        {selectorBar}
      </div>

      {/* 4 metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard variant="hero" label="Total Revenue" sub={periodLabel} value={noData ? '—' : formatCurrency(totalRev)} />
        )}
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard label="Direct Payroll" sub={periodLabel} value={noData ? '—' : formatCurrency(totalDirect)} delta={totalRev > 0 ? `${formatPercent((totalDirect / totalRev) * 100)} of revenue` : undefined} deltaType="down" />
        )}
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard label="Fuel Cost" sub={periodLabel} value={noData ? '—' : formatCurrency(totalFuel)} delta={totalRev > 0 ? `${formatPercent((totalFuel / totalRev) * 100)} of revenue` : undefined} deltaType="down" />
        )}
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="metric-label">Gross Profit</div>
            <div style={{ fontSize: 11, color: '#666666' }}>{periodLabel}</div>
            <div style={{ fontSize: 26, fontWeight: 500, color: noData ? '#888888' : grossProfit >= 0 ? '#ffffff' : '#cc4444', marginTop: 8 }}>
              {noData ? '—' : formatCurrency(grossProfit)}
            </div>
            {!noData && grossProfitPct !== null && (
              <div style={{ fontSize: 11, color: grossProfit >= 0 ? '#ff6b00' : '#cc4444', marginTop: 2 }}>
                {grossProfit >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(grossProfitPct))} margin
              </div>
            )}
          </div>
        )}
      </div>

      {/* Admin payroll — 5th smaller card */}
      {!loading && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '10px 16px' }}>
          <span style={{ fontSize: 11, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Admin Payroll</span>
          <span style={{ fontSize: 18, fontWeight: 500, color: '#888888' }}>{noData ? '—' : formatCurrency(totalAdmin)}</span>
          <span style={{ fontSize: 11, color: '#555555' }}>Lump sum — detail restricted to admin/executive</span>
        </div>
      )}

      {/* Variance vs target */}
      {!isYTD && selectedFiscalId && (
        <FiscalMonthVarianceRow
          fiscalMonthId={selectedFiscalId}
          branchIds={[branchId]}
          actualRevenue={noData ? null : totalRev}
          actualGrossProfitPct={noData ? null : (grossProfitPct ?? null)}
        />
      )}

      {/* Weekly bar chart */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
          Weekly Performance <span style={{ fontSize: 11, color: '#555555', fontWeight: 400 }}>· click a bar to see detail</span>
        </div>
        {loading ? <Skeleton height={200} /> : barData.length === 0 ? (
          <div style={{ fontSize: 12, color: '#555555', textAlign: 'center', padding: '32px 0' }}>No data for this period.</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} barCategoryGap="25%" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#555555', fontSize: 10 }} axisLine={false} tickLine={false} width={50} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#888888', paddingTop: 8 }} />
              <Bar dataKey="revenue" name="Revenue" fill="#ff6b00" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(entry: { periodDate: string }) => setSelectedWeek((p) => p === entry.periodDate ? null : entry.periodDate)}>
                {barData.map((e) => <Cell key={e.periodDate} fill={selectedWeek === e.periodDate ? '#ffaa44' : '#ff6b00'} />)}
              </Bar>
              <Bar dataKey="directPayroll" name="Direct Payroll" fill="#cc4444" radius={[3, 3, 0, 0]} />
              <Bar dataKey="fuel" name="Fuel" fill="#7a3333" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {selectedWeek && selectedWeekData && (
        <SelectedWeekPanel periodDate={selectedWeek} directTotal={selectedWeekData.directTotal} adminTotal={selectedWeekData.adminTotal} taxTotal={selectedWeekData.taxTotal} detail={selectedWeekData.detail} onDismiss={() => setSelectedWeek(null)} />
      )}

      {/* Weekly trend line chart (replaces PayrollBreakdownCard) */}
      <WeeklyTrendChart data={trendData} loading={loading} />

      {/* Revenue breakdown table */}
      <RevBreakdownTable saturdays={saturdays} revByWeek={revByWeek} loading={loading} />

      {/* Fuel Analytics */}
      <FuelAnalyticsSection
        fuelByWeekClient={fuelByWeek}
        topConsumers={topConsumers}
        vendorTotals={vendorTotals}
        fuelWeekApiData={fuelWeekApiData}
        saturdays={saturdays}
        loading={analyticsLoading}
        isMobile={false}
      />

      {/* Payroll Analytics + Direct Labor Detail */}
      <PayrollAnalyticsSection
        hoursWeekly={hoursWeekly}
        weeklyPayroll={weeklyPayroll}
        saturdays={saturdays}
        overtimeSummary={overtimeSummary}
        directLaborDetail={directLaborDetail}
        loading={analyticsLoading}
        isMobile={false}
      />
    </div>
  )
}
