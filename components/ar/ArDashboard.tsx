'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Role } from '@/lib/supabase/database.types'
import ArImportModal from './ArImportModal'

interface Branch { id: string; name: string }

interface AgingSummary {
  aging: Record<string, number>
  total: number
  lastImports: { entity_code: string; report_date: string; imported_at: string; invoice_count: number; total_ar: number }[]
}

interface Customer {
  id: string
  displayName: string
  isExcluded: boolean
  current: number
  d30: number
  d60: number
  d90: number
  d90plus: number
  totalAr: number
  invoiceCount: number
}

interface Invoice {
  id: string
  entity_code: string
  invoice_number: string | null
  po_number: string | null
  job_name: string | null
  invoice_date: string | null
  due_date: string | null
  terms: string | null
  open_balance: number
  aging_bucket: string
  aging_days: number | null
  raw_class_code: string | null
  branch: { id: string; name: string } | null
  customer: { id: string; display_name: string } | null
}

interface Props { role: Role; branches: Branch[] }

type SortKey = 'displayName' | 'current' | 'd30' | 'd60' | 'd90' | 'd90plus' | 'totalAr' | 'invoiceCount'
type SortDir = 'asc' | 'desc'

const AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '>90'] as const
const ENTITIES = ['TCS', 'INC', 'STS'] as const

const BUCKET_COLORS: Record<string, string> = {
  'Current': '#ff6b00',
  '1-30':    '#cc9900',
  '31-60':   '#cc6600',
  '61-90':   '#cc4444',
  '>90':     '#992222',
}

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

// ─── Sortable column header ────────────────────────────────────────────────────

function SortTh({
  label, sortKey, current, dir, onSort, right,
}: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
  right?: boolean
}) {
  const active = current === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        padding: '10px 12px',
        textAlign: right ? 'right' : 'left',
        fontSize: 11,
        color: active ? '#ff6b00' : '#666',
        fontWeight: 400,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {label}
      <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3 }}>
        {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </th>
  )
}

// ─── Aging summary cards ───────────────────────────────────────────────────────

function AgingCards({
  summary,
  loading,
  bucket,
  onBucketClick,
}: {
  summary: AgingSummary | null
  loading: boolean
  bucket: string
  onBucketClick: (b: string) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
      <div
        onClick={() => onBucketClick('')}
        style={{
          background: '#ff6b00', borderRadius: 12, padding: 16,
          cursor: bucket ? 'pointer' : 'default',
        }}
      >
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Total AR
        </div>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#fff' }}>
          {loading ? '—' : fmt(summary?.total ?? 0)}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>All buckets</div>
      </div>

      {AGING_BUCKETS.map((b) => (
        <div
          key={b}
          onClick={() => onBucketClick(bucket === b ? '' : b)}
          style={{
            background: bucket === b ? '#2a2a2a' : '#1e1e1e',
            border: `1px solid ${bucket === b ? BUCKET_COLORS[b] : '#2a2a2a'}`,
            borderRadius: 12, padding: 16, cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            {b} days
          </div>
          <div style={{ fontSize: 20, fontWeight: 500, color: bucket === b ? BUCKET_COLORS[b] : '#fff' }}>
            {loading ? '—' : fmt(summary?.aging[b] ?? 0)}
          </div>
          {summary && (
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              {summary.total > 0 ? ((summary.aging[b] / summary.total) * 100).toFixed(1) + '%' : '0%'}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Customer detail view ──────────────────────────────────────────────────────

function CustomerDetail({
  customer, entity, isAdmin, onBack, onRefresh,
}: {
  customer: Customer
  entity: string
  isAdmin: boolean
  onBack: () => void
  onRefresh: () => void
}) {
  const [invoices, setInvoices]   = useState<Invoice[]>([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [loading, setLoading]     = useState(true)
  const [toggling, setToggling]   = useState(false)

  const PAGE_SIZE = 50

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ customerId: customer.id, page: String(page) })
    if (entity) params.set('entity', entity)
    fetch(`/api/ar/invoices?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setInvoices(d.invoices ?? [])
        setTotal(d.total ?? 0)
        setPageCount(d.pageCount ?? 0)
      })
      .finally(() => setLoading(false))
  }, [customer.id, entity, page])

  const handleExcludeToggle = async () => {
    setToggling(true)
    try {
      const res = await fetch(`/api/ar/customers/${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isExcluded: !customer.isExcluded }),
      })
      if (res.ok) onRefresh()
    } finally {
      setToggling(false)
    }
  }

  const custAging: Record<string, number> = {
    'Current': customer.current,
    '1-30':    customer.d30,
    '31-60':   customer.d60,
    '61-90':   customer.d90,
    '>90':     customer.d90plus,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onBack}
          style={{
            background: '#2a2a2a', border: 'none', borderRadius: 8,
            color: '#ccc', padding: '6px 12px', fontSize: 12,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          ← Back
        </button>
        <div style={{ fontSize: 22, fontWeight: 500, color: customer.isExcluded ? '#666' : '#fff', flex: 1 }}>
          {customer.displayName}
          {customer.isExcluded && (
            <span style={{ fontSize: 11, color: '#555', fontWeight: 400, marginLeft: 10, verticalAlign: 'middle' }}>
              Excluded from AR
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#555' }}>
          {customer.invoiceCount} invoice{customer.invoiceCount !== 1 ? 's' : ''} · {fmt(customer.totalAr)} total
        </div>
        {isAdmin && (
          <button
            onClick={handleExcludeToggle}
            disabled={toggling}
            style={{
              background: customer.isExcluded ? '#2a2a2a' : 'rgba(204,68,68,0.12)',
              border: `1px solid ${customer.isExcluded ? '#333' : '#663333'}`,
              borderRadius: 8,
              color: customer.isExcluded ? '#888' : '#cc4444',
              padding: '6px 14px', fontSize: 12,
              cursor: toggling ? 'default' : 'pointer',
              opacity: toggling ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {customer.isExcluded ? 'Restore to AR' : 'Exclude from AR'}
          </button>
        )}
      </div>

      {/* Aging breakdown for this customer */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        <div style={{ background: customer.isExcluded ? '#2a2a2a' : '#ff6b00', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: customer.isExcluded ? '#555' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Total AR
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: customer.isExcluded ? '#666' : '#fff' }}>{fmt(customer.totalAr)}</div>
        </div>
        {AGING_BUCKETS.map((b) => (
          <div key={b} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{b} days</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: custAging[b] > 0 && !customer.isExcluded ? BUCKET_COLORS[b] : '#444' }}>
              {fmt(custAging[b])}
            </div>
          </div>
        ))}
      </div>

      {/* Customer profile */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Contacts placeholder */}
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>Contacts</div>
            {isAdmin && (
              <button style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, color: '#888', padding: '4px 10px', fontSize: 11, cursor: 'not-allowed', opacity: 0.5 }}>
                + Add
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#444' }}>No contacts yet.</div>
        </div>

        {/* Notes placeholder */}
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#fff', marginBottom: 12 }}>Notes</div>
          <div style={{ fontSize: 12, color: '#444' }}>No notes yet.</div>
        </div>
      </div>

      {/* Invoices */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>Open Invoices</span>
          {total > 0 && <span style={{ fontSize: 11, color: '#555', marginLeft: 8 }}>{total} total</span>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                {['Invoice #', 'Entity', 'Branch', 'Job', 'PO #', 'Invoice Date', 'Due Date', 'Terms', 'Aging', 'Open Balance'].map((h) => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: h === 'Open Balance' ? 'right' : 'left', fontSize: 11, color: '#666', fontWeight: 400, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>Loading…</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>No invoices found</td></tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>{inv.invoice_number ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc' }}>{inv.entity_code}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>
                      {inv.branch?.name ?? <span style={{ color: '#555' }}>{inv.raw_class_code ?? '—'}</span>}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.job_name ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>{inv.po_number ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>{fmtDate(inv.invoice_date)}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>{fmtDate(inv.due_date)}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>{inv.terms ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                      <span style={{ background: `${BUCKET_COLORS[inv.aging_bucket] ?? '#333'}22`, color: BUCKET_COLORS[inv.aging_bucket] ?? '#888', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>
                        {inv.aging_bucket}
                      </span>
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#fff', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(Number(inv.open_balance))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid #2a2a2a' }}>
            <span style={{ fontSize: 12, color: '#666' }}>{total} invoice{total !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, color: page === 1 ? '#444' : '#ccc', padding: '4px 10px', fontSize: 12, cursor: page === 1 ? 'default' : 'pointer' }}>‹</button>
              <span style={{ fontSize: 12, color: '#888', padding: '4px 8px' }}>{page} / {pageCount}</span>
              <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount} style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, color: page === pageCount ? '#444' : '#ccc', padding: '4px 10px', fontSize: 12, cursor: page === pageCount ? 'default' : 'pointer' }}>›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main dashboard ────────────────────────────────────────────────────────────

export default function ArDashboard({ role, branches }: Props) {
  const isAdmin = role === 'admin'

  const [entity, setEntity]           = useState('')
  const [branchId, setBranchId]       = useState('')
  const [bucket, setBucket]           = useState('')
  const [search, setSearch]           = useState('')
  const [showExcluded, setShowExcluded] = useState(false)
  const [sortKey, setSortKey]         = useState<SortKey>('totalAr')
  const [sortDir, setSortDir]         = useState<SortDir>('desc')

  const [summary, setSummary]               = useState<AgingSummary | null>(null)
  const [customers, setCustomers]           = useState<Customer[]>([])
  const [loadingSummary, setLoadingSummary]     = useState(true)
  const [loadingCustomers, setLoadingCustomers] = useState(true)

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [showImport, setShowImport]             = useState(false)

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true)
    const p = new URLSearchParams()
    if (entity)   p.set('entity', entity)
    if (branchId) p.set('branchId', branchId)
    const res = await fetch(`/api/ar/summary?${p}`)
    if (res.ok) setSummary(await res.json())
    setLoadingSummary(false)
  }, [entity, branchId])

  const fetchCustomers = useCallback(async () => {
    setLoadingCustomers(true)
    const p = new URLSearchParams()
    if (entity)       p.set('entity', entity)
    if (branchId)     p.set('branchId', branchId)
    if (showExcluded) p.set('includeExcluded', 'true')
    const res = await fetch(`/api/ar/customers?${p}`)
    if (res.ok) {
      const data = await res.json()
      setCustomers(data.customers ?? [])
    }
    setLoadingCustomers(false)
  }, [entity, branchId, showExcluded])

  useEffect(() => { fetchSummary() }, [fetchSummary])
  useEffect(() => { fetchCustomers() }, [fetchCustomers])

  // Reset selected customer when filters change
  useEffect(() => { setSelectedCustomer(null) }, [entity, branchId])

  const handleImportSuccess = () => {
    setShowImport(false)
    fetchSummary()
    fetchCustomers()
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  // Called from CustomerDetail after exclude/restore toggle
  const handleRefreshAfterToggle = useCallback(() => {
    fetchSummary()
    fetchCustomers()
    setSelectedCustomer(null)
  }, [fetchSummary, fetchCustomers])

  // Filter + sort
  const filteredCustomers = customers
    .filter((c) => {
      if (search && !c.displayName.toLowerCase().includes(search.toLowerCase())) return false
      if (bucket) {
        const bucketField: Record<string, keyof Customer> = {
          'Current': 'current', '1-30': 'd30', '31-60': 'd60', '61-90': 'd90', '>90': 'd90plus',
        }
        const field = bucketField[bucket]
        if (field && (c[field] as number) <= 0) return false
      }
      return true
    })
    .sort((a, b) => {
      // Always sort excluded customers to the bottom
      if (a.isExcluded !== b.isExcluded) return a.isExcluded ? 1 : -1
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })

  const excludedCount = customers.filter((c) => c.isExcluded).length

  // ── Customer detail view ───────────────────────────────────────────────────

  if (selectedCustomer) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <CustomerDetail
          customer={selectedCustomer}
          entity={entity}
          isAdmin={isAdmin}
          onBack={() => setSelectedCustomer(null)}
          onRefresh={handleRefreshAfterToggle}
        />
      </div>
    )
  }

  // ── Customer list view ─────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#fff' }}>Accounts Receivable</div>
          {summary && summary.lastImports.length > 0 && (
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {summary.lastImports.map((imp) => (
                <span key={imp.entity_code} style={{ marginRight: 16 }}>
                  {imp.entity_code} — {fmtDate(imp.report_date.split('T')[0])}
                </span>
              ))}
            </div>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowImport(true)}
            style={{
              background: '#ff6b00', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import AR
          </button>
        )}
      </div>

      {/* Aging summary cards */}
      <AgingCards
        summary={summary}
        loading={loadingSummary}
        bucket={bucket}
        onBucketClick={setBucket}
      />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
        >
          <option value="">All Entities</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>

        {branches.length > 1 && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}

        <input
          type="text"
          placeholder="Search customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '5px 12px', fontSize: 12, outline: 'none', width: 180 }}
        />

        {isAdmin && (
          <button
            onClick={() => setShowExcluded((v) => !v)}
            style={{
              background: showExcluded ? 'rgba(204,68,68,0.12)' : 'transparent',
              border: `1px solid ${showExcluded ? '#663333' : '#333'}`,
              borderRadius: 8,
              color: showExcluded ? '#cc4444' : '#666',
              padding: '5px 12px', fontSize: 12, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {showExcluded ? `Hide excluded (${excludedCount})` : `Show excluded${excludedCount > 0 ? ` (${excludedCount})` : ''}`}
          </button>
        )}

        {(entity || branchId || bucket || search) && (
          <button
            onClick={() => { setEntity(''); setBranchId(''); setBucket(''); setSearch('') }}
            style={{ background: 'transparent', border: '1px solid #333', borderRadius: 8, color: '#888', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            Clear
          </button>
        )}

        {filteredCustomers.length > 0 && (
          <span style={{ fontSize: 12, color: '#555', marginLeft: 4 }}>
            {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Customer table */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                <SortTh label="Customer"   sortKey="displayName"  current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Current"    sortKey="current"      current={sortKey} dir={sortDir} onSort={handleSort} right />
                <SortTh label="1–30 days"  sortKey="d30"          current={sortKey} dir={sortDir} onSort={handleSort} right />
                <SortTh label="31–60 days" sortKey="d60"          current={sortKey} dir={sortDir} onSort={handleSort} right />
                <SortTh label="61–90 days" sortKey="d90"          current={sortKey} dir={sortDir} onSort={handleSort} right />
                <SortTh label=">90 days"   sortKey="d90plus"      current={sortKey} dir={sortDir} onSort={handleSort} right />
                <SortTh label="Total AR"   sortKey="totalAr"      current={sortKey} dir={sortDir} onSort={handleSort} right />
                <SortTh label="Invoices"   sortKey="invoiceCount" current={sortKey} dir={sortDir} onSort={handleSort} right />
              </tr>
            </thead>
            <tbody>
              {loadingCustomers ? (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>Loading…</td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>
                    {customers.length === 0 ? 'No AR data. Import a file to get started.' : 'No customers match your filters.'}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((cust) => (
                  <tr
                    key={cust.id}
                    onClick={() => setSelectedCustomer(cust)}
                    style={{
                      borderBottom: '1px solid #222',
                      cursor: 'pointer',
                      opacity: cust.isExcluded ? 0.45 : 1,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#242424')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
                      <span style={{ color: cust.isExcluded ? '#555' : '#ff6b00' }}>{cust.displayName}</span>
                      {cust.isExcluded && (
                        <span style={{ fontSize: 10, color: '#444', marginLeft: 8, fontWeight: 400 }}>excluded</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.current > 0 ? '#fff' : '#444', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {cust.current > 0 ? fmt(cust.current) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.d30 > 0 ? BUCKET_COLORS['1-30'] : '#444', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {cust.d30 > 0 ? fmt(cust.d30) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.d60 > 0 ? BUCKET_COLORS['31-60'] : '#444', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {cust.d60 > 0 ? fmt(cust.d60) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.d90 > 0 ? BUCKET_COLORS['61-90'] : '#444', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {cust.d90 > 0 ? fmt(cust.d90) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.d90plus > 0 ? BUCKET_COLORS['>90'] : '#444', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {cust.d90plus > 0 ? fmt(cust.d90plus) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#fff', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(cust.totalAr)}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: '#666', textAlign: 'right' }}>
                      {cust.invoiceCount}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showImport && (
        <ArImportModal onClose={() => setShowImport(false)} onSuccess={handleImportSuccess} />
      )}
    </div>
  )
}
