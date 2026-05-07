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
  Legend,
} from 'recharts'
import MetricCard from '@/components/ui/MetricCard'
import Skeleton from '@/components/ui/Skeleton'
import { formatCurrency, formatPercent } from '@/lib/utils/format'

interface FiscalMonth {
  id: string
  name: string
  year: number
  start_date: string
  end_date: string
}

interface RevTxn {
  period_date: string
  labor: number
  rental: number
  one_time_charges: number
  total_revenue: number
}

interface FuelTxn {
  transaction_date: string
  total_with_tax: number
}

interface PayrollLine {
  employeeId: string
  displayName: string
  amount: number
  hours: number | null
  rate: number | null
}

interface WeekPayroll {
  directTotal: number
  adminTotal: number
  taxTotal: number
  detail: PayrollLine[]
}

interface Props {
  branchId: string
  entityId: string
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

function getSaturdaysInRange(startDate: string, endDate: string): string[] {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const end = new Date(ey, em - 1, ed)
  const saturdays: string[] = []
  const d = new Date(sy, sm - 1, sd)
  d.setDate(d.getDate() + 6)
  while (d <= end) {
    saturdays.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    )
    d.setDate(d.getDate() + 7)
  }
  return saturdays
}

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

const selectStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #333333',
  borderRadius: 8,
  padding: '5px 12px',
  fontSize: 12,
  color: '#cccccc',
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WeeklyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: '#1e1e1e',
        border: '1px solid #333333',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
      }}
    >
      <p style={{ margin: '0 0 6px', color: '#888888', fontSize: 11 }}>{label}</p>
      {payload.map((p: { name: string; value: number; fill: string }) => (
        <p key={p.name} style={{ margin: '2px 0', color: p.fill }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  )
}

// ── Selected Week Panel ───────────────────────────────────────────────────────

function SelectedWeekPanel({
  periodDate,
  directTotal,
  adminTotal,
  taxTotal,
  detail,
  onDismiss,
}: {
  periodDate: string
  directTotal: number
  adminTotal: number
  taxTotal: number
  detail: PayrollLine[]
  onDismiss: () => void
}) {
  const totalPayroll = directTotal + adminTotal + taxTotal
  return (
    <div
      style={{
        background: '#2a2a2a',
        border: '1px solid #333333',
        borderRadius: 12,
        padding: '12px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: '#cccccc' }}>
          Direct Labor — week ending {fmtShort(periodDate)}
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
      {detail.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Employee', 'Hours', 'Rate', 'Amount'].map((h) => (
                <th
                  key={h}
                  className="table-header"
                  style={{ textAlign: h === 'Employee' ? 'left' : 'right', padding: '0 8px 8px', fontWeight: 400 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...detail]
              .sort((a, b) => b.amount - a.amount)
              .map((row) => (
                <tr key={row.employeeId} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td className="table-body" style={{ padding: '7px 8px' }}>
                    {row.displayName}
                  </td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>
                    {row.hours != null ? row.hours.toFixed(1) : '—'}
                  </td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>
                    {row.rate != null ? formatCurrency(row.rate) : '—'}
                  </td>
                  <td className="table-body" style={{ padding: '7px 8px', textAlign: 'right' }}>
                    {formatCurrency(row.amount)}
                  </td>
                </tr>
              ))}
            {adminTotal > 0 && (
              <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                <td className="table-body" style={{ padding: '7px 8px', color: '#888888' }}>
                  Admin Payroll (lump sum)
                </td>
                <td colSpan={2} />
                <td
                  className="table-body"
                  style={{ padding: '7px 8px', textAlign: 'right', color: '#888888' }}
                >
                  {formatCurrency(adminTotal)}
                </td>
              </tr>
            )}
            <tr style={{ borderTop: '1px solid #333333' }}>
              <td style={{ padding: '7px 8px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>
                Total Payroll
              </td>
              <td colSpan={2} />
              <td
                style={{
                  padding: '7px 8px',
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
      ) : (
        <div style={{ fontSize: 12, color: '#888888' }}>No direct labor this week.</div>
      )}
    </div>
  )
}

// ── Revenue Breakdown Table ───────────────────────────────────────────────────

function RevBreakdownTable({
  saturdays,
  revByWeek,
  loading,
}: {
  saturdays: string[]
  revByWeek: Record<string, { labor: number; rental: number; oneTime: number; total: number }>
  loading: boolean
}) {
  const totalLabor = saturdays.reduce((s, sat) => s + (revByWeek[sat]?.labor ?? 0), 0)
  const totalRental = saturdays.reduce((s, sat) => s + (revByWeek[sat]?.rental ?? 0), 0)
  const totalOneTime = saturdays.reduce((s, sat) => s + (revByWeek[sat]?.oneTime ?? 0), 0)
  const totalAll = saturdays.reduce((s, sat) => s + (revByWeek[sat]?.total ?? 0), 0)

  return (
    <div className="card">
      <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
        Revenue Breakdown
      </div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={28} />
          ))}
        </div>
      ) : saturdays.length === 0 ? (
        <div style={{ fontSize: 12, color: '#888888', padding: '16px 0' }}>
          No data for this period.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Week Ending', 'Labor', 'Rental', 'One-Time', 'Total'].map((h) => (
                <th
                  key={h}
                  className="table-header"
                  style={{
                    textAlign: h === 'Week Ending' ? 'left' : 'right',
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
            {saturdays.map((sat) => {
              const row = revByWeek[sat]
              return (
                <tr key={sat} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td className="table-body" style={{ padding: '8px 8px' }}>
                    {fmtShort(sat)}
                  </td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>
                    {row ? formatCurrency(row.labor) : '—'}
                  </td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>
                    {row ? formatCurrency(row.rental) : '—'}
                  </td>
                  <td className="table-body" style={{ padding: '8px 8px', textAlign: 'right' }}>
                    {row ? formatCurrency(row.oneTime) : '—'}
                  </td>
                  <td
                    className="table-body"
                    style={{
                      padding: '8px 8px',
                      textAlign: 'right',
                      color: '#ffffff',
                      fontWeight: 500,
                    }}
                  >
                    {row ? formatCurrency(row.total) : '—'}
                  </td>
                </tr>
              )
            })}
            <tr style={{ borderTop: '1px solid #333333' }}>
              <td style={{ padding: '8px 8px', fontSize: 12, fontWeight: 500, color: '#ffffff' }}>
                Total
              </td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                {formatCurrency(totalLabor)}
              </td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                {formatCurrency(totalRental)}
              </td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: '#cccccc' }}>
                {formatCurrency(totalOneTime)}
              </td>
              <td
                style={{
                  padding: '8px 8px',
                  textAlign: 'right',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#ff6b00',
                }}
              >
                {formatCurrency(totalAll)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Payroll Breakdown Card ────────────────────────────────────────────────────

function PayrollBreakdownCard({
  totalDirect,
  totalAdmin,
  totalTax,
  loading,
  noData,
}: {
  totalDirect: number
  totalAdmin: number
  totalTax: number
  loading: boolean
  noData: boolean
}) {
  const total = totalDirect + totalAdmin + totalTax
  const directPct = total > 0 ? (totalDirect / total) * 100 : 0
  const adminPct = total > 0 ? (totalAdmin / total) * 100 : 0
  const taxPct = total > 0 ? (totalTax / total) * 100 : 0

  return (
    <div className="card">
      <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
        Payroll Breakdown
      </div>
      {loading ? (
        <Skeleton height={120} />
      ) : noData ? (
        <div style={{ fontSize: 12, color: '#555555', textAlign: 'center', padding: '24px 0' }}>
          No data.
        </div>
      ) : (
        <div>
          {/* Stacked bar */}
          <div
            style={{
              display: 'flex',
              height: 18,
              borderRadius: 4,
              overflow: 'hidden',
              marginBottom: 16,
              background: '#2a2a2a',
            }}
          >
            {directPct > 0 && (
              <div style={{ width: `${directPct}%`, background: '#ff6b00' }} />
            )}
            {adminPct > 0 && (
              <div style={{ width: `${adminPct}%`, background: '#888888' }} />
            )}
            {taxPct > 0 && (
              <div style={{ width: `${taxPct}%`, background: '#555555' }} />
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Direct Labor', value: totalDirect, color: '#ff6b00', pct: directPct },
              { label: 'Admin Payroll', value: totalAdmin, color: '#888888', pct: adminPct },
              { label: 'Taxes', value: totalTax, color: '#555555', pct: taxPct },
            ].map(({ label, value, color, pct }) => (
              <div
                key={label}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{ width: 10, height: 10, background: color, borderRadius: 2, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12, color: '#cccccc' }}>{label}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#666666' }}>{pct.toFixed(1)}%</span>
                  <span
                    style={{
                      fontSize: 12,
                      color: '#ffffff',
                      fontWeight: 500,
                      minWidth: 80,
                      textAlign: 'right',
                    }}
                  >
                    {formatCurrency(value)}
                  </span>
                </div>
              </div>
            ))}
            <div
              style={{
                borderTop: '1px solid #333333',
                paddingTop: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 500, color: '#ffffff' }}>Total Payroll</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#ffffff' }}>
                {formatCurrency(total)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManagerDashboard({ branchId, entityId }: Props) {
  const [fiscalMonths, setFiscalMonths] = useState<FiscalMonth[]>([])
  const [selectedFiscalId, setSelectedFiscalId] = useState<string>('')
  const [isYTD, setIsYTD] = useState(false)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [revTxns, setRevTxns] = useState<RevTxn[]>([])
  const [fuelTxns, setFuelTxns] = useState<FuelTxn[]>([])
  const [weeklyPayroll, setWeeklyPayroll] = useState<Record<string, WeekPayroll>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isMobile = useIsMobile()

  // On mount: load fiscal months and find the most recent one with imported data
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
      const match = mostRecent
        ? fms.find((fm) => fm.start_date <= mostRecent && mostRecent <= fm.end_date)
        : null
      setSelectedFiscalId(match?.id ?? fms[0]?.id ?? '')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedFiscal = useMemo(
    () => fiscalMonths.find((fm) => fm.id === selectedFiscalId) ?? null,
    [fiscalMonths, selectedFiscalId]
  )

  const { startDate, endDate } = useMemo(() => {
    if (isYTD) {
      const year = new Date().getFullYear()
      const latest = fiscalMonths[0]
      return { startDate: `${year}-01-01`, endDate: latest?.end_date ?? `${year}-12-31` }
    }
    if (selectedFiscal) {
      return { startDate: selectedFiscal.start_date, endDate: selectedFiscal.end_date }
    }
    return { startDate: '', endDate: '' }
  }, [isYTD, selectedFiscal, fiscalMonths])

  const saturdays = useMemo(() => {
    if (!startDate || !endDate) return []
    return getSaturdaysInRange(startDate, endDate)
  }, [startDate, endDate])

  // Fetch all data for the selected period
  useEffect(() => {
    if (!startDate || !endDate) return
    setLoading(true)
    setError(null)
    setSelectedWeek(null)

    const weeks = getSaturdaysInRange(startDate, endDate)
    const rangeParams = new URLSearchParams({ branchId, startDate, endDate })

    const payrollCalls = weeks.map((sat) =>
      fetch(
        `/api/payroll/summary?${new URLSearchParams({ branchId, periodDate: sat, entityId })}`
      ).then((r) => r.json())
    )

    Promise.all([
      fetch(`/api/revenue/summary?${rangeParams}`).then((r) => r.json()),
      fetch(`/api/fuel/summary?${rangeParams}`).then((r) => r.json()),
      ...payrollCalls,
    ])
      .then(([rev, fuel, ...payResults]) => {
        if (!rev.success) throw new Error(rev.error)
        if (!fuel.success) throw new Error(fuel.error)
        setRevTxns(rev.data.transactions ?? [])
        setFuelTxns(fuel.data.transactions ?? [])

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
      .finally(() => setLoading(false))
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
      const d = new Date(t.transaction_date + 'T00:00:00')
      const daysToSat = (6 - d.getDay() + 7) % 7
      d.setDate(d.getDate() + daysToSat)
      const sat = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      m[sat] = (m[sat] ?? 0) + t.total_with_tax
    }
    return m
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

  const barData = useMemo(
    () =>
      saturdays.map((sat) => ({
        periodDate: sat,
        label: fmtShort(sat),
        revenue: revByWeek[sat]?.total ?? 0,
        directPayroll: weeklyPayroll[sat]?.directTotal ?? 0,
        fuel: fuelByWeek[sat] ?? 0,
      })),
    [saturdays, revByWeek, weeklyPayroll, fuelByWeek]
  )

  const selectedWeekData = selectedWeek ? (weeklyPayroll[selectedWeek] ?? null) : null
  const periodLabel = startDate && endDate ? rangeLabel(startDate, endDate) : '—'

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

  if (fiscalMonths.length === 0 && !loading) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', marginBottom: 16 }}>
          Overview
        </div>
        <div className="card" style={{ padding: 24 }}>
          <p style={{ color: '#888888', fontSize: 13, margin: 0 }}>
            No fiscal months available. Contact your administrator.
          </p>
        </div>
      </div>
    )
  }

  // ── Mobile render ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Period selector */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={selectedFiscalId}
            onChange={(e) => { setIsYTD(false); setSelectedFiscalId(e.target.value) }}
            style={{ ...selectStyle, flex: 1 }}
          >
            {fiscalMonths.map((fm) => (
              <option key={fm.id} value={fm.id}>{fm.name}</option>
            ))}
          </select>
          <button
            onClick={() => setIsYTD((v) => !v)}
            style={{
              background: isYTD ? '#ff6b00' : '#2a2a2a',
              border: '1px solid #333333',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 12,
              color: isYTD ? '#ffffff' : '#888888',
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            YTD
          </button>
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
              <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', lineHeight: 1.2 }}>
                {noData ? '—' : formatCurrency(totalRev)}
              </div>
            </div>
            <div className="card" style={{ padding: '12px 14px', minHeight: 80 }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>Direct Pay</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', lineHeight: 1.2 }}>
                {noData ? '—' : formatCurrency(totalDirect)}
              </div>
            </div>
            <div className="card" style={{ padding: '12px 14px', minHeight: 80 }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>Fuel</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', lineHeight: 1.2 }}>
                {noData ? '—' : formatCurrency(totalFuel)}
              </div>
            </div>
            <div className="card" style={{ padding: '12px 14px', minHeight: 80 }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>Net Profit</div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 500,
                  color: noData ? '#888888' : grossProfit >= 0 ? '#ffffff' : '#cc4444',
                  lineHeight: 1.2,
                }}
              >
                {noData ? '—' : formatCurrency(grossProfit)}
              </div>
              {!noData && grossProfitPct !== null && (
                <div style={{ fontSize: 11, color: grossProfit >= 0 ? '#ff6b00' : '#cc4444', marginTop: 2 }}>
                  {grossProfitPct.toFixed(1)}% margin
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bar chart — revenue only on mobile */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>
            Weekly Revenue
          </div>
          {loading ? (
            <Skeleton height={160} />
          ) : barData.length === 0 ? (
            <div style={{ fontSize: 12, color: '#555555', textAlign: 'center', padding: '20px 0' }}>
              No data for this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={barData} barCategoryGap="30%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: '#555555', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<WeeklyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar
                  dataKey="revenue"
                  name="Revenue"
                  fill="#ff6b00"
                  radius={[3, 3, 0, 0]}
                  cursor="pointer"
                  onClick={(entry: { periodDate: string }) =>
                    setSelectedWeek((prev) => prev === entry.periodDate ? null : entry.periodDate)
                  }
                >
                  {barData.map((entry) => (
                    <Cell
                      key={entry.periodDate}
                      fill={selectedWeek === entry.periodDate ? '#ffaa44' : '#ff6b00'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {selectedWeek && selectedWeekData && (
          <SelectedWeekPanel
            periodDate={selectedWeek}
            directTotal={selectedWeekData.directTotal}
            adminTotal={selectedWeekData.adminTotal}
            taxTotal={selectedWeekData.taxTotal}
            detail={selectedWeekData.detail}
            onDismiss={() => setSelectedWeek(null)}
          />
        )}

        <RevBreakdownTable saturdays={saturdays} revByWeek={revByWeek} loading={loading} />
      </div>
    )
  }

  // ── Desktop render ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
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
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Overview</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={selectedFiscalId}
            onChange={(e) => { setIsYTD(false); setSelectedFiscalId(e.target.value) }}
            style={selectStyle}
          >
            {fiscalMonths.map((fm) => (
              <option key={fm.id} value={fm.id}>{fm.name}</option>
            ))}
          </select>
          <button
            onClick={() => setIsYTD((v) => !v)}
            style={{
              background: isYTD ? '#ff6b00' : '#2a2a2a',
              border: '1px solid #333333',
              borderRadius: 8,
              padding: '5px 14px',
              fontSize: 12,
              color: isYTD ? '#ffffff' : '#888888',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: isYTD ? 500 : 400,
            }}
          >
            YTD
          </button>
        </div>
      </div>

      {/* Top metric row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard
            variant="hero"
            label="Total Revenue"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(totalRev)}
          />
        )}
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard
            label="Direct Payroll"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(totalDirect)}
            delta={totalRev > 0 ? `${formatPercent((totalDirect / totalRev) * 100)} of revenue` : undefined}
            deltaType="down"
          />
        )}
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard
            label="Admin Payroll"
            sub="Lump sum"
            value={noData ? '—' : formatCurrency(totalAdmin)}
            delta={totalRev > 0 ? `${formatPercent((totalAdmin / totalRev) * 100)} of revenue` : undefined}
            deltaType="down"
          />
        )}
        {loading ? <Skeleton height={140} borderRadius={12} /> : (
          <MetricCard
            label="Total Fuel"
            sub={periodLabel}
            value={noData ? '—' : formatCurrency(totalFuel)}
            delta={totalRev > 0 ? `${formatPercent((totalFuel / totalRev) * 100)} of revenue` : undefined}
            deltaType="down"
          />
        )}
      </div>

      {/* Weekly bar chart */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
          Weekly Performance — click a bar to see detail
        </div>
        {loading ? (
          <Skeleton height={200} />
        ) : barData.length === 0 ? (
          <div style={{ fontSize: 12, color: '#555555', textAlign: 'center', padding: '32px 0' }}>
            No data for this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} barCategoryGap="25%" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#555555', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fill: '#555555', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={50}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<WeeklyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Legend
                iconType="square"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, color: '#888888', paddingTop: 8 }}
              />
              <Bar
                dataKey="revenue"
                name="Revenue"
                fill="#ff6b00"
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={(entry: { periodDate: string }) =>
                  setSelectedWeek((prev) => prev === entry.periodDate ? null : entry.periodDate)
                }
              >
                {barData.map((entry) => (
                  <Cell
                    key={entry.periodDate}
                    fill={selectedWeek === entry.periodDate ? '#ffaa44' : '#ff6b00'}
                  />
                ))}
              </Bar>
              <Bar dataKey="directPayroll" name="Direct Payroll" fill="#cc4444" radius={[3, 3, 0, 0]} />
              <Bar dataKey="fuel" name="Fuel" fill="#7a3333" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Selected week direct labor panel */}
      {selectedWeek && selectedWeekData && (
        <SelectedWeekPanel
          periodDate={selectedWeek}
          directTotal={selectedWeekData.directTotal}
          adminTotal={selectedWeekData.adminTotal}
          taxTotal={selectedWeekData.taxTotal}
          detail={selectedWeekData.detail}
          onDismiss={() => setSelectedWeek(null)}
        />
      )}

      {/* Middle row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.7fr', gap: 12 }}>
        <PayrollBreakdownCard
          totalDirect={totalDirect}
          totalAdmin={totalAdmin}
          totalTax={totalTax}
          loading={loading}
          noData={noData}
        />

        {/* Period summary */}
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
            Period Summary
          </div>
          {loading ? (
            <Skeleton height={120} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Total Revenue', value: totalRev, color: '#ff6b00' as const },
                { label: 'Total Payroll', value: -totalPayroll, color: '#cc4444' as const },
                { label: 'Total Fuel', value: -totalFuel, color: '#cc4444' as const },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#cccccc' }}>{label}</span>
                  <span style={{ fontSize: 12, color, fontWeight: 500 }}>
                    {value < 0
                      ? `(${formatCurrency(Math.abs(value))})`
                      : formatCurrency(value)}
                  </span>
                </div>
              ))}
              <div
                style={{
                  borderTop: '1px solid #333333',
                  paddingTop: 10,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500, color: '#ffffff' }}>Gross Profit</span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: grossProfit >= 0 ? '#ffffff' : '#cc4444',
                  }}
                >
                  {formatCurrency(grossProfit)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
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

      {/* Revenue breakdown table */}
      <RevBreakdownTable saturdays={saturdays} revByWeek={revByWeek} loading={loading} />
    </div>
  )
}
