'use client'

import { useState, useEffect, useCallback } from 'react'
import Skeleton from '@/components/ui/Skeleton'

interface Branch { id: string; name: string }
interface Entity { id: string; code: string }

type Dataset = 'payroll' | 'revenue' | 'fuel'
type SortDir = 'asc' | 'desc'

interface Filters {
  startDate: string
  endDate: string
  branchId: string
  entityCode: string
  vendor: string
}

// ── Row types ──────────────────────────────────────────────────────────────────

interface PayrollRow {
  id: string; periodDate: string; employeeName: string
  branchId: string; branchName: string; entityCode: string
  payrollCode: string; itemName: string | null; groupName: string | null
  hours: number | null; rate: number | null; amount: number
}

interface RevenueRow {
  id: string; periodDate: string
  branchId: string; branchName: string; entityCode: string; revenueCode: string | null
  labor: number; rental: number; oneTime: number; salesTax: number; total: number
}

interface FuelRow {
  id: string; transactionDate: string; cardDriver: string
  branchId: string | null; branchName: string | null; vendor: string
  product: string | null; siteName: string | null; siteCity: string | null; siteState: string | null
  gallons: number | null; pricePerGallon: number | null
  totalPreTax: number | null; tax: number | null; totalWithTax: number; mpg: number | null
}

type AnyRow = PayrollRow | RevenueRow | FuelRow

// ── Summary types ──────────────────────────────────────────────────────────────

interface PayrollSummary {
  totalAmount: number; totalHours: number; totalTaxes: number
  employeeCount: number; avgPerEmployee: number
}

interface RevenueSummary {
  totalRevenue: number; totalLabor: number; totalRental: number
  totalOneTime: number; totalSalesTax: number; branchCount: number
}

interface FuelSummary {
  totalCost: number; totalGallons: number; avgPricePerGallon: number
  transactionCount: number; uniqueCards: number
}

interface ApiData {
  summary: PayrollSummary | RevenueSummary | FuelSummary
  rows: AnyRow[]
  total: number
  page: number
  pageSize: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function defaultStartDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10)
}

const BLANK_FILTERS: Filters = {
  startDate: defaultStartDate(),
  endDate: defaultEndDate(),
  branchId: '',
  entityCode: '',
  vendor: '',
}

// ── Column definitions ─────────────────────────────────────────────────────────

type ColDef = { key: string; label: string; numeric?: boolean }

const PAYROLL_COLS: ColDef[] = [
  { key: 'periodDate', label: 'Period Date' },
  { key: 'employeeName', label: 'Employee' },
  { key: 'branchName', label: 'Branch' },
  { key: 'entityCode', label: 'Entity' },
  { key: 'payrollCode', label: 'Code' },
  { key: 'itemName', label: 'Item' },
  { key: 'groupName', label: 'Group' },
  { key: 'hours', label: 'Hours', numeric: true },
  { key: 'rate', label: 'Rate', numeric: true },
  { key: 'amount', label: 'Amount', numeric: true },
]

const REVENUE_COLS: ColDef[] = [
  { key: 'periodDate', label: 'Period Date' },
  { key: 'branchName', label: 'Branch' },
  { key: 'entityCode', label: 'Entity' },
  { key: 'revenueCode', label: 'Rev Code' },
  { key: 'labor', label: 'Labor', numeric: true },
  { key: 'rental', label: 'Rental', numeric: true },
  { key: 'oneTime', label: 'One-Time', numeric: true },
  { key: 'salesTax', label: 'Sales Tax', numeric: true },
  { key: 'total', label: 'Total', numeric: true },
]

const FUEL_COLS: ColDef[] = [
  { key: 'transactionDate', label: 'Date' },
  { key: 'cardDriver', label: 'Card/Driver' },
  { key: 'branchName', label: 'Branch' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'product', label: 'Product' },
  { key: 'siteName', label: 'Site' },
  { key: 'siteCity', label: 'City' },
  { key: 'siteState', label: 'State' },
  { key: 'gallons', label: 'Gallons', numeric: true },
  { key: 'pricePerGallon', label: '$/Gal', numeric: true },
  { key: 'totalPreTax', label: 'Pre-tax', numeric: true },
  { key: 'tax', label: 'Tax', numeric: true },
  { key: 'totalWithTax', label: 'Total', numeric: true },
  { key: 'mpg', label: 'MPG', numeric: true },
]

function colsFor(dataset: Dataset): ColDef[] {
  if (dataset === 'payroll') return PAYROLL_COLS
  if (dataset === 'revenue') return REVENUE_COLS
  return FUEL_COLS
}

// ── Cell renderer ──────────────────────────────────────────────────────────────

function renderCell(dataset: Dataset, col: ColDef, row: AnyRow): React.ReactNode {
  const v = (row as unknown as Record<string, unknown>)[col.key]
  if (v === null || v === undefined || v === '') return <span style={{ color: 'var(--text-faint)' }}>—</span>

  if (col.key === 'branchName') {
    return <span style={{ color: '#ff6b00' }}>{String(v)}</span>
  }

  if (col.numeric) {
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    if (isNaN(n)) return <span style={{ color: 'var(--text-faint)' }}>—</span>

    if (col.key === 'amount' || col.key === 'labor' || col.key === 'rental' ||
        col.key === 'oneTime' || col.key === 'salesTax' || col.key === 'total' ||
        col.key === 'totalPreTax' || col.key === 'tax' || col.key === 'totalWithTax') {
      return fmt$(n)
    }
    if (col.key === 'rate' || col.key === 'pricePerGallon') {
      return '$' + fmtNum(n, 4)
    }
    if (col.key === 'gallons') return fmtNum(n, 3)
    if (col.key === 'mpg') return fmtNum(n, 1)
    return fmtNum(n, 2)
  }

  return String(v)
}

// ── Sort ───────────────────────────────────────────────────────────────────────

function sortRows(rows: AnyRow[], col: string, dir: SortDir): AnyRow[] {
  if (!col) return rows
  return [...rows].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[col]
    const bv = (b as unknown as Record<string, unknown>)[col]
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv))
    return dir === 'asc' ? cmp : -cmp
  })
}

// ── Build export URL ───────────────────────────────────────────────────────────

function buildExportUrl(dataset: Dataset, filters: Filters): string {
  const p = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate })
  if (filters.branchId) p.set('branchId', filters.branchId)
  if (filters.entityCode) p.set('entityCode', filters.entityCode)
  if (filters.vendor) p.set('vendor', filters.vendor)
  return `/api/data-explorer/export/${dataset}?${p.toString()}`
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  branches: Branch[]
  entities: Entity[]
}

export default function DataExplorerClient({ branches, entities }: Props) {
  const [dataset, setDataset] = useState<Dataset>('payroll')
  const [pending, setPending] = useState<Filters>(BLANK_FILTERS)
  const [applied, setApplied] = useState<Filters>(BLANK_FILTERS)
  const [appliedDataset, setAppliedDataset] = useState<Dataset>('payroll')

  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [apiData, setApiData] = useState<ApiData | null>(null)

  const [page, setPage] = useState(0)
  const [sortCol, setSortCol] = useState('')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const PAGE_SIZE = 50

  const fetchData = useCallback(async (ds: Dataset, filters: Filters, pg: number) => {
    setLoading(true)
    setFetchError(null)
    try {
      const p = new URLSearchParams({
        startDate: filters.startDate,
        endDate: filters.endDate,
        page: String(pg),
        pageSize: String(PAGE_SIZE),
      })
      if (filters.branchId) p.set('branchId', filters.branchId)
      if (filters.entityCode && ds !== 'fuel') p.set('entityCode', filters.entityCode)
      if (filters.vendor && ds === 'fuel') p.set('vendor', filters.vendor)

      const res = await fetch(`/api/data-explorer/${ds}?${p.toString()}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setApiData(json.data)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-fetch on mount
  useEffect(() => {
    fetchData('payroll', BLANK_FILTERS, 0)
  }, [fetchData])

  function handleApply() {
    setApplied(pending)
    setAppliedDataset(dataset)
    setPage(0)
    setSortCol('')
    setSortDir('asc')
    fetchData(dataset, pending, 0)
  }

  function handleReset() {
    const fresh = BLANK_FILTERS
    setPending(fresh)
    setApplied(fresh)
    setAppliedDataset(dataset)
    setPage(0)
    setSortCol('')
    setSortDir('asc')
    fetchData(dataset, fresh, 0)
  }

  function handleDatasetChange(ds: Dataset) {
    setDataset(ds)
    setSortCol('')
    setSortDir('asc')
  }

  function handlePageChange(newPage: number) {
    setPage(newPage)
    setSortCol('')
    setSortDir('asc')
    fetchData(appliedDataset, applied, newPage)
  }

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const cols = colsFor(appliedDataset)
  const rawRows = (apiData?.rows ?? []) as AnyRow[]
  const displayRows = sortCol ? sortRows(rawRows, sortCol, sortDir) : rawRows
  const total = apiData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ── Styles ───────────────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-emphasis)',
    borderRadius: 8,
    padding: '7px 10px',
    fontSize: 12,
    color: 'var(--text-secondary)',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  }

  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer', appearance: 'none' as const }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    color: 'var(--text-dim)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: 5,
  }

  // ── Summary cards ────────────────────────────────────────────────────────────

  function SummaryCards() {
    if (!apiData) return null
    const summary = apiData.summary

    if (appliedDataset === 'payroll') {
      const s = summary as PayrollSummary
      const cards = [
        { label: 'Total Amount', value: fmt$(s.totalAmount) },
        { label: 'Total Hours', value: fmtNum(s.totalHours, 1) },
        { label: 'Total Taxes', value: fmt$(s.totalTaxes) },
        { label: 'Employees', value: String(s.employeeCount) },
        { label: 'Avg Per Employee', value: fmt$(s.avgPerEmployee) },
      ]
      return <SummaryRow cards={cards} />
    }

    if (appliedDataset === 'revenue') {
      const s = summary as RevenueSummary
      const cards = [
        { label: 'Total Revenue', value: fmt$(s.totalRevenue) },
        { label: 'Labor', value: fmt$(s.totalLabor) },
        { label: 'Rental', value: fmt$(s.totalRental) },
        { label: 'One-Time', value: fmt$(s.totalOneTime) },
        { label: 'Sales Tax', value: fmt$(s.totalSalesTax) },
        { label: 'Branches', value: String(s.branchCount) },
      ]
      return <SummaryRow cards={cards} />
    }

    if (appliedDataset === 'fuel') {
      const s = summary as FuelSummary
      const cards = [
        { label: 'Total Cost', value: fmt$(s.totalCost) },
        { label: 'Total Gallons', value: fmtNum(s.totalGallons, 1) },
        { label: 'Avg Price/Gal', value: '$' + fmtNum(s.avgPricePerGallon, 4) },
        { label: 'Transactions', value: String(s.transactionCount) },
        { label: 'Unique Cards', value: String(s.uniqueCards) },
      ]
      return <SummaryRow cards={cards} />
    }

    return null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Page title */}
      <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Data Explorer</div>

      {/* Filter bar */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Dataset toggle */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['payroll', 'revenue', 'fuel'] as Dataset[]).map((ds) => (
            <button
              key={ds}
              onClick={() => handleDatasetChange(ds)}
              style={{
                background: dataset === ds ? '#ff6b00' : 'var(--bg-secondary)',
                border: 'none',
                borderRadius: 6,
                color: dataset === ds ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: dataset === ds ? 600 : 400,
                padding: '6px 14px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textTransform: 'capitalize' as const,
              }}
            >
              {ds.charAt(0).toUpperCase() + ds.slice(1)}
            </button>
          ))}
        </div>

        {/* Filter row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Start Date</label>
            <input
              type="date"
              value={pending.startDate}
              onChange={(e) => setPending((p) => ({ ...p, startDate: e.target.value }))}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>End Date</label>
            <input
              type="date"
              value={pending.endDate}
              onChange={(e) => setPending((p) => ({ ...p, endDate: e.target.value }))}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Branch</label>
            <select
              value={pending.branchId}
              onChange={(e) => setPending((p) => ({ ...p, branchId: e.target.value }))}
              style={selectStyle}
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {dataset !== 'fuel' && (
            <div>
              <label style={labelStyle}>Entity</label>
              <select
                value={pending.entityCode}
                onChange={(e) => setPending((p) => ({ ...p, entityCode: e.target.value }))}
                style={selectStyle}
              >
                <option value="">All Entities</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.code}>{e.code}</option>
                ))}
              </select>
            </div>
          )}

          {dataset === 'fuel' && (
            <div>
              <label style={labelStyle}>Vendor</label>
              <input
                type="text"
                placeholder="Any vendor"
                value={pending.vendor}
                onChange={(e) => setPending((p) => ({ ...p, vendor: e.target.value }))}
                style={inputStyle}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
            <button
              onClick={handleApply}
              disabled={loading}
              className="btn-primary"
              style={{ fontSize: 12, padding: '7px 16px', opacity: loading ? 0.6 : 1 }}
            >
              Apply
            </button>
            <button
              onClick={handleReset}
              disabled={loading}
              style={{
                background: 'var(--bg-secondary)',
                border: 'none',
                borderRadius: 8,
                color: 'var(--text-muted)',
                fontSize: 12,
                padding: '7px 14px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                opacity: loading ? 0.6 : 1,
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {fetchError && (
        <div style={{ fontSize: 12, color: '#cc4444', padding: '10px 14px', background: '#2a1a1a', borderRadius: 8 }}>
          {fetchError}
        </div>
      )}

      {/* Summary cards */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={72} />)}
        </div>
      ) : (
        <SummaryCards />
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {/* Table header bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {loading ? 'Loading…' : `${total.toLocaleString()} row${total !== 1 ? 's' : ''}`}
          </span>
          {apiData && total > 0 && (
            <a
              href={buildExportUrl(appliedDataset, applied)}
              download
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-emphasis)',
                borderRadius: 6,
                color: 'var(--text-secondary)',
                fontSize: 12,
                padding: '5px 12px',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              <ExportIcon />
              Export CSV
            </a>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={40} />)}
          </div>
        ) : displayRows.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>
            No results for the selected filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr>
                  {cols.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      style={{
                        textAlign: col.numeric ? 'right' : 'left',
                        padding: '9px 14px',
                        fontWeight: 400,
                        fontSize: 11,
                        color: sortCol === col.key ? '#ff6b00' : 'var(--text-dim)',
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.04em',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap' as const,
                        userSelect: 'none' as const,
                      }}
                    >
                      {col.label}
                      {sortCol === col.key && (
                        <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => (
                  <tr key={(row as { id: string }).id} style={{ borderBottom: '1px solid #1e1e1e' }}>
                    {cols.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          padding: '9px 14px',
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          textAlign: col.numeric ? 'right' : 'left',
                          whiteSpace: 'nowrap' as const,
                        }}
                      >
                        {renderCell(appliedDataset, col, row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && total > PAGE_SIZE && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderTop: '1px solid var(--border)',
          }}>
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 0}
              style={{
                background: 'var(--bg-secondary)', border: 'none', borderRadius: 6,
                color: page === 0 ? 'var(--text-faint)' : 'var(--text-secondary)',
                fontSize: 12, padding: '6px 14px', cursor: page === 0 ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Previous
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages - 1}
              style={{
                background: 'var(--bg-secondary)', border: 'none', borderRadius: 6,
                color: page >= totalPages - 1 ? 'var(--text-faint)' : 'var(--text-secondary)',
                fontSize: 12, padding: '6px 14px',
                cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryRow({ cards }: { cards: { label: string; value: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, gap: 10 }}>
      {cards.map((c) => (
        <div key={c.label} className="card" style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 6 }}>
            {c.label}
          </div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

function ExportIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
