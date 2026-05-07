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

interface BranchInfo {
  id: string
  name: string
  entityId: string
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
  branch_id: string | null
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
  branches: BranchInfo[]
  initialBranch: string
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

function snapToSaturday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const daysToSat = (6 - d.getDay() + 7) % 7
  d.setDate(d.getDate() + daysToSat)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
            {[...detail]
              .sort((a, b) => b.amount - a.amount)
              .map((row, i) => (
                <tr key={i} style={{ borderTop: '1px solid #2a2a2a' }}>
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

// ── Branch Comparison Cards (aggregate) ───────────────────────────────────────

function gpColor(pct: number): string {
  if (pct >= 20) return '#4caf50'
  if (pct >= 10) return '#ff9800'
  return '#cc4444'
}

function BranchComparisonCard({
  name,
  rev,
  direct,
  admin,
  fuel,
}: {
  name: string
  rev: number
  direct: number
  admin: number
  fuel: number
}) {
  const totalPay = direct + admin
  const gp = rev - totalPay - fuel
  const gpPct = rev > 0 ? (gp / rev) * 100 : 0
  const noData = rev === 0 && direct === 0 && fuel === 0

  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#ff6b00', marginBottom: 8 }}>
        {name}
      </div>
      {noData ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(17,17,17,0.55)',
            borderRadius: 12,
          }}
        >
          <span style={{ fontSize: 11, color: '#555555' }}>No data</span>
        </div>
      ) : (
        <>
          <div
            style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', lineHeight: 1.2, marginBottom: 8 }}
          >
            {formatCurrency(rev)}
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: '#666666',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Payroll
              </div>
              <div style={{ fontSize: 12, color: '#cccccc' }}>{formatCurrency(totalPay)}</div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: '#666666',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Fuel
              </div>
              <div style={{ fontSize: 12, color: '#cccccc' }}>{formatCurrency(fuel)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#cccccc' }}>{formatCurrency(gp)}</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: gpColor(gpPct),
                background: `${gpColor(gpPct)}18`,
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              {gpPct.toFixed(1)}%
            </span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Revenue Breakdown Table (single-branch) ───────────────────────────────────

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
        <EmptyState message="No data for this period." />
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

// ── Payroll Breakdown Card (single-branch) ────────────────────────────────────

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
        <EmptyState message="No data." />
      ) : (
        <div>
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
            {directPct > 0 && <div style={{ width: `${directPct}%`, background: '#ff6b00' }} />}
            {adminPct > 0 && <div style={{ width: `${adminPct}%`, background: '#888888' }} />}
            {taxPct > 0 && <div style={{ width: `${taxPct}%`, background: '#555555' }} />}
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
                  <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
                  <span style={{ fontSize: 12, color: '#cccccc' }}>{label}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#666666' }}>{pct.toFixed(1)}%</span>
                  <span
                    style={{ fontSize: 12, color: '#ffffff', fontWeight: 500, minWidth: 80, textAlign: 'right' }}
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

export default function DistrictDashboard({ branches, initialBranch }: Props) {
  const validInitialBranch =
    initialBranch === 'all' || branches.some((b) => b.id === initialBranch)
      ? initialBranch
      : 'all'

  const [selectedBranchId, setSelectedBranchId] = useState<string>(validInitialBranch)
  const [fiscalMonths, setFiscalMonths] = useState<FiscalMonth[]>([])
  const [selectedFiscalId, setSelectedFiscalId] = useState<string>('')
  const [isYTD, setIsYTD] = useState(false)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [revTxns, setRevTxns] = useState<RevTxn[]>([])
  const [fuelTxns, setFuelTxns] = useState<FuelTxn[]>([])
  // branchId → periodDate → payroll
  const [weeklyPayrollByBranch, setWeeklyPayrollByBranch] = useState<
    Record<string, Record<string, WeekPayroll>>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isMobile = useIsMobile()
  const isAggregate = selectedBranchId === 'all'

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

  // Fetch data when branch selection or date range changes
  useEffect(() => {
    if (!startDate || !endDate) return
    setLoading(true)
    setError(null)
    setSelectedWeek(null)

    const weeks = getSaturdaysInRange(startDate, endDate)

    const rangeParams = new URLSearchParams({ startDate, endDate })
    if (!isAggregate) rangeParams.set('branchId', selectedBranchId)

    const targetBranches = isAggregate ? branches : branches.filter((b) => b.id === selectedBranchId)

    // Payroll: one call per branch per week
    const payrollCalls: Promise<unknown>[] = []
    const payrollKeys: Array<{ branchId: string; sat: string }> = []
    for (const b of targetBranches) {
      for (const sat of weeks) {
        payrollKeys.push({ branchId: b.id, sat })
        payrollCalls.push(
          fetch(
            `/api/payroll/summary?${new URLSearchParams({ branchId: b.id, periodDate: sat, entityId: b.entityId })}`
          ).then((r) => r.json())
        )
      }
    }

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

        type PayRes = { success: boolean; data?: { directLabor: { total: number; detail: PayrollLine[] }; adminPayroll: { total: number }; taxes?: { total: number } } }
        const byBranch: Record<string, Record<string, WeekPayroll>> = {}
        payrollKeys.forEach(({ branchId, sat }, i) => {
          const pay = payResults[i] as PayRes
          if (pay.success && pay.data) {
            if (!byBranch[branchId]) byBranch[branchId] = {}
            byBranch[branchId][sat] = {
              directTotal: pay.data.directLabor.total,
              adminTotal: pay.data.adminPayroll.total,
              taxTotal: pay.data.taxes?.total ?? 0,
              detail: pay.data.directLabor.detail ?? [],
            }
          }
        })
        setWeeklyPayrollByBranch(byBranch)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [selectedBranchId, startDate, endDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived metrics ───────────────────────────────────────────────────────

  const revenueByBranch = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of revTxns) {
      m[t.branch_id] = (m[t.branch_id] ?? 0) + t.total_revenue
    }
    return m
  }, [revTxns])

  const fuelByBranch = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of fuelTxns) {
      if (t.branch_id) m[t.branch_id] = (m[t.branch_id] ?? 0) + t.total_with_tax
    }
    return m
  }, [fuelTxns])

  const payrollByBranch = useMemo(() => {
    const m: Record<string, { direct: number; admin: number; tax: number }> = {}
    for (const [bId, weeks] of Object.entries(weeklyPayrollByBranch)) {
      m[bId] = {
        direct: Object.values(weeks).reduce((s, w) => s + w.directTotal, 0),
        admin: Object.values(weeks).reduce((s, w) => s + w.adminTotal, 0),
        tax: Object.values(weeks).reduce((s, w) => s + w.taxTotal, 0),
      }
    }
    return m
  }, [weeklyPayrollByBranch])

  const totalRev = revTxns.reduce((s, t) => s + t.total_revenue, 0)
  const totalFuel = fuelTxns.reduce((s, t) => s + t.total_with_tax, 0)
  const totalDirect = Object.values(payrollByBranch).reduce((s, p) => s + p.direct, 0)
  const totalAdmin = Object.values(payrollByBranch).reduce((s, p) => s + p.admin, 0)
  const totalTax = Object.values(payrollByBranch).reduce((s, p) => s + p.tax, 0)
  const totalPayroll = totalDirect + totalAdmin + totalTax
  const grossProfit = totalRev - totalPayroll - totalFuel
  const grossProfitPct = totalRev > 0 ? (grossProfit / totalRev) * 100 : null
  const noData = !loading && totalRev === 0 && totalPayroll === 0 && totalFuel === 0

  // Per-week aggregate bar data
  const fuelByWeek = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of fuelTxns) {
      const sat = snapToSaturday(t.transaction_date)
      m[sat] = (m[sat] ?? 0) + t.total_with_tax
    }
    return m
  }, [fuelTxns])

  const revByWeek = useMemo(() => {
    const m: Record<string, { labor: number; rental: number; oneTime: number; total: number }> = {}
    for (const t of revTxns) {
      // Filter to selected branch in single mode (revTxns already filtered by branchId in API)
      if (!m[t.period_date]) m[t.period_date] = { labor: 0, rental: 0, oneTime: 0, total: 0 }
      m[t.period_date].labor += t.labor
      m[t.period_date].rental += t.rental
      m[t.period_date].oneTime += t.one_time_charges
      m[t.period_date].total += t.total_revenue
    }
    return m
  }, [revTxns])

  // Single branch's per-week payroll (for bar chart + detail panel)
  const singleBranchWeeklyPayroll: Record<string, WeekPayroll> = isAggregate
    ? {}
    : (weeklyPayrollByBranch[selectedBranchId] ?? {})

  const barData = useMemo(() => {
    return saturdays.map((sat) => {
      const directPayroll = isAggregate
        ? Object.values(weeklyPayrollByBranch).reduce(
            (s, bWeeks) => s + (bWeeks[sat]?.directTotal ?? 0),
            0
          )
        : singleBranchWeeklyPayroll[sat]?.directTotal ?? 0

      return {
        periodDate: sat,
        label: fmtShort(sat),
        revenue: revByWeek[sat]?.total ?? 0,
        directPayroll,
        fuel: fuelByWeek[sat] ?? 0,
      }
    })
  }, [saturdays, revByWeek, fuelByWeek, isAggregate, weeklyPayrollByBranch, singleBranchWeeklyPayroll])

  const selectedWeekData = selectedWeek ? (singleBranchWeeklyPayroll[selectedWeek] ?? null) : null
  const periodLabel = startDate && endDate ? rangeLabel(startDate, endDate) : '—'
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

  if (fiscalMonths.length === 0 && !loading) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', marginBottom: 16 }}>
          {pageTitle}
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
        {/* Selectors */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            style={{ ...selectStyle, flex: 1, color: '#ff6b00' }}
          >
            <option value="all">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
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

        {/* Revenue chart */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', marginBottom: 10 }}>
            Weekly Revenue
          </div>
          {loading ? (
            <Skeleton height={160} />
          ) : barData.length === 0 ? (
            <EmptyState message="No data for this period." />
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
                  cursor={!isAggregate ? 'pointer' : undefined}
                  onClick={!isAggregate ? (entry: { periodDate: string }) =>
                    setSelectedWeek((prev) => prev === entry.periodDate ? null : entry.periodDate)
                    : undefined}
                >
                  {barData.map((entry) => (
                    <Cell
                      key={entry.periodDate}
                      fill={!isAggregate && selectedWeek === entry.periodDate ? '#ffaa44' : '#ff6b00'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {!isAggregate && selectedWeek && selectedWeekData && (
          <SelectedWeekPanel
            periodDate={selectedWeek}
            directTotal={selectedWeekData.directTotal}
            adminTotal={selectedWeekData.adminTotal}
            taxTotal={selectedWeekData.taxTotal}
            detail={selectedWeekData.detail}
            onDismiss={() => setSelectedWeek(null)}
          />
        )}

        {/* Aggregate: branch list; Single: revenue table */}
        {isAggregate ? (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', fontSize: 13, fontWeight: 500, color: '#ffffff' }}>
              Branch Performance
            </div>
            {loading ? (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {branches.map((_, i) => <Skeleton key={i} height={44} />)}
              </div>
            ) : (
              branches.map((b) => {
                const bRev = revenueByBranch[b.id] ?? 0
                const bDirect = payrollByBranch[b.id]?.direct ?? 0
                const bAdmin = payrollByBranch[b.id]?.admin ?? 0
                const bFuel = fuelByBranch[b.id] ?? 0
                const bGP = bRev - bDirect - bAdmin - bFuel
                const bGPPct = bRev > 0 ? (bGP / bRev) * 100 : 0
                const bNoData = bRev === 0 && bDirect === 0 && bFuel === 0
                return (
                  <div
                    key={b.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 16px',
                      borderBottom: '1px solid #2a2a2a',
                      minHeight: 44,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#ff6b00' }}>{b.name}</span>
                    {bNoData ? (
                      <span style={{ fontSize: 12, color: '#555555' }}>No data</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#cccccc' }}>{formatCurrency(bRev)}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: gpColor(bGPPct), background: `${gpColor(bGPPct)}1a`, borderRadius: 4, padding: '2px 7px' }}>
                          {bGPPct.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        ) : (
          <RevBreakdownTable saturdays={saturdays} revByWeek={revByWeek} loading={loading} />
        )}
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
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>{pageTitle}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Branch selector */}
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            style={{ ...selectStyle, color: '#ff6b00' }}
          >
            <option value="all">All Assigned Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

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
          Weekly Performance{!isAggregate ? ' — click a bar to see detail' : ''}
        </div>
        {loading ? (
          <Skeleton height={200} />
        ) : barData.length === 0 ? (
          <EmptyState message="No data for this period." />
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
                cursor={!isAggregate ? 'pointer' : undefined}
                onClick={!isAggregate ? (entry: { periodDate: string }) =>
                  setSelectedWeek((prev) => prev === entry.periodDate ? null : entry.periodDate)
                  : undefined}
              >
                {barData.map((entry) => (
                  <Cell
                    key={entry.periodDate}
                    fill={!isAggregate && selectedWeek === entry.periodDate ? '#ffaa44' : '#ff6b00'}
                  />
                ))}
              </Bar>
              <Bar dataKey="directPayroll" name="Direct Payroll" fill="#cc4444" radius={[3, 3, 0, 0]} />
              <Bar dataKey="fuel" name="Fuel" fill="#7a3333" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Selected week panel (single branch only) */}
      {!isAggregate && selectedWeek && selectedWeekData && (
        <SelectedWeekPanel
          periodDate={selectedWeek}
          directTotal={selectedWeekData.directTotal}
          adminTotal={selectedWeekData.adminTotal}
          taxTotal={selectedWeekData.taxTotal}
          detail={selectedWeekData.detail}
          onDismiss={() => setSelectedWeek(null)}
        />
      )}

      {/* ── Aggregate view: branch comparison cards ── */}
      {isAggregate && (
        <>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff' }}>
            Branch Comparison — {periodLabel}
          </div>
          {loading ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              {branches.map((_, i) => (
                <Skeleton key={i} height={140} borderRadius={12} />
              ))}
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              {[...branches]
                .sort((a, b) => (revenueByBranch[b.id] ?? 0) - (revenueByBranch[a.id] ?? 0))
                .map((b) => (
                  <BranchComparisonCard
                    key={b.id}
                    name={b.name}
                    rev={revenueByBranch[b.id] ?? 0}
                    direct={payrollByBranch[b.id]?.direct ?? 0}
                    admin={payrollByBranch[b.id]?.admin ?? 0}
                    fuel={fuelByBranch[b.id] ?? 0}
                  />
                ))}
            </div>
          )}

          {/* Aggregate totals table */}
          {!loading && !noData && (
            <div className="card">
              <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>
                District Totals
              </div>
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
                  {[...branches]
                    .sort((a, b) => (revenueByBranch[b.id] ?? 0) - (revenueByBranch[a.id] ?? 0))
                    .map((b) => {
                      const rev = revenueByBranch[b.id] ?? 0
                      const direct = payrollByBranch[b.id]?.direct ?? 0
                      const admin = payrollByBranch[b.id]?.admin ?? 0
                      const fuel = fuelByBranch[b.id] ?? 0
                      const gp = rev - direct - admin - fuel
                      const gpPct = rev > 0 ? (gp / rev) * 100 : null
                      return (
                        <tr key={b.id} style={{ borderTop: '1px solid #2a2a2a' }}>
                          <td
                            className="table-body branch-name"
                            style={{ padding: '9px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}
                          >
                            {b.name}
                          </td>
                          <td
                            className="table-body"
                            style={{ padding: '9px 10px', textAlign: 'right', color: '#ffffff', fontWeight: 500 }}
                          >
                            {formatCurrency(rev)}
                          </td>
                          <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                            {formatCurrency(direct)}
                          </td>
                          <td
                            className="table-body"
                            style={{ padding: '9px 10px', textAlign: 'right', color: '#888888' }}
                          >
                            {formatCurrency(admin)}
                          </td>
                          <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                            {formatCurrency(fuel)}
                          </td>
                          <td
                            className="table-body"
                            style={{
                              padding: '9px 10px',
                              textAlign: 'right',
                              color: gp >= 0 ? '#cccccc' : '#cc4444',
                            }}
                          >
                            {formatCurrency(gp)}
                          </td>
                          <td className="table-body" style={{ padding: '9px 10px', textAlign: 'right' }}>
                            {gpPct !== null ? (
                              <span style={{ color: gpColor(gpPct) }}>{formatPercent(gpPct)}</span>
                            ) : (
                              <span style={{ color: '#555555' }}>—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
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
                        color: grossProfitPct !== null && grossProfitPct >= 0 ? '#ff6b00' : '#cc4444',
                      }}
                    >
                      {grossProfitPct !== null ? formatPercent(grossProfitPct) : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Single branch view: payroll breakdown + summary + right column ── */}
      {!isAggregate && (
        <>
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

            {/* Right column: GP + Margin + Cost */}
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

          <RevBreakdownTable saturdays={saturdays} revByWeek={revByWeek} loading={loading} />
        </>
      )}
    </div>
  )
}
