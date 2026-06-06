'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
// Invoice interface only used by ArCustomerDetail now — kept here for the Customer list type
import type { Role } from '@/lib/supabase/database.types'
import ArImportModal from './ArImportModal'
import ArCustomerDetail from './ArCustomerDetail'
import ArMeetingDashboard from './ArMeetingDashboard'
import { createBrowserClient } from '@/lib/supabase/client'

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
  terms: string | null
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

interface TeamMember { id: string; displayName: string }

interface Props { role: Role; branches: Branch[] }

type ViewMode = 'ar' | 'meeting'
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
        color: active ? '#ff6b00' : 'var(--text-dim)',
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
    <div className="ar-aging-grid">
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
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>
          {loading ? '—' : fmt(summary?.total ?? 0)}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>All buckets</div>
      </div>

      {AGING_BUCKETS.map((b) => (
        <div
          key={b}
          onClick={() => onBucketClick(bucket === b ? '' : b)}
          style={{
            background: bucket === b ? 'var(--bg-secondary)' : 'var(--bg-surface)',
            border: `1px solid ${bucket === b ? BUCKET_COLORS[b] : 'var(--bg-secondary)'}`,
            borderRadius: 12, padding: 16, cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            {b} days
          </div>
          <div style={{ fontSize: 20, fontWeight: 500, color: bucket === b ? BUCKET_COLORS[b] : 'var(--text-primary)' }}>
            {loading ? '—' : fmt(summary?.aging[b] ?? 0)}
          </div>
          {summary && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              {summary.total > 0 ? ((summary.aging[b] / summary.total) * 100).toFixed(1) + '%' : '0%'}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main dashboard ────────────────────────────────────────────────────────────

export default function ArDashboard({ role, branches }: Props) {
  const isAdmin   = role === 'admin'
  // Roles that can filter by AR team member
  const isArAdmin = role === 'admin' || role === 'executive' || role === 'ar_manager'

  const [view, setView]                   = useState<ViewMode>('ar')
  const [showAll, setShowAll]             = useState(false)
  const [entity, setEntity]               = useState('')
  const [branchId, setBranchId]           = useState('')
  const [bucket, setBucket]               = useState('')
  const [search, setSearch]               = useState('')
  const [showExcluded, setShowExcluded]   = useState(false)
  const [sortKey, setSortKey]             = useState<SortKey>('totalAr')
  const [sortDir, setSortDir]             = useState<SortDir>('desc')
  const [assignedUserId, setAssignedUserId] = useState('')
  const [teamMembers, setTeamMembers]     = useState<TeamMember[]>([])

  const [summary, setSummary]               = useState<AgingSummary | null>(null)
  const [customers, setCustomers]           = useState<Customer[]>([])
  const [loadingSummary, setLoadingSummary]     = useState(true)
  const [loadingCustomers, setLoadingCustomers] = useState(true)

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [showImport, setShowImport]               = useState(false)

  // Fetch AR team members for the assignee dropdown (admin/exec/ar_manager only)
  useEffect(() => {
    if (!isArAdmin) return
    fetch('/api/ar/team-members')
      .then((r) => r.ok ? r.json() : { members: [] })
      .then((d) => setTeamMembers(d.members ?? []))
      .catch(() => {})
  }, [isArAdmin])

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true)
    const p = new URLSearchParams()
    if (entity)         p.set('entity', entity)
    if (branchId)       p.set('branchId', branchId)
    if (showAll)        p.set('showAll', 'true')
    if (assignedUserId) p.set('assignedUserId', assignedUserId)
    const res = await fetch(`/api/ar/summary?${p}`)
    if (res.ok) setSummary(await res.json())
    setLoadingSummary(false)
  }, [entity, branchId, showAll, assignedUserId])

  const fetchCustomers = useCallback(async () => {
    setLoadingCustomers(true)
    const p = new URLSearchParams()
    if (entity)         p.set('entity', entity)
    if (branchId)       p.set('branchId', branchId)
    if (showExcluded)   p.set('includeExcluded', 'true')
    if (showAll)        p.set('showAll', 'true')
    if (assignedUserId) p.set('assignedUserId', assignedUserId)
    const res = await fetch(`/api/ar/customers?${p}`)
    if (res.ok) {
      const data = await res.json()
      setCustomers(data.customers ?? [])
    }
    setLoadingCustomers(false)
  }, [entity, branchId, showExcluded, showAll, assignedUserId])

  useEffect(() => { fetchSummary() }, [fetchSummary])
  useEffect(() => { fetchCustomers() }, [fetchCustomers])

  // Reset selected customer when filters change
  useEffect(() => { setSelectedCustomer(null) }, [entity, branchId, assignedUserId])

  // ── Realtime: live customer status / exclude updates ───────────────────────
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const supabase = createBrowserClient()

    const channel = supabase
      .channel('ar-customers-list')
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'ar_customers',
      }, (payload) => {
        const row = payload.new as Record<string, unknown>
        // Optimistically patch the customer in-list so the change is instant,
        // then debounce a full refresh to pick up any other fields.
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === row.id
              ? { ...c, isExcluded: typeof row.is_excluded === 'boolean' ? row.is_excluded : c.isExcluded }
              : c
          )
        )
        // Also update selectedCustomer if it's the one that changed
        setSelectedCustomer((sel) =>
          sel && sel.id === row.id && typeof row.is_excluded === 'boolean'
            ? { ...sel, isExcluded: row.is_excluded as boolean }
            : sel
        )
        // Debounce full re-fetch so rapid multi-row updates collapse into one call
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => {
          fetchCustomers()
        }, 1500)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [fetchCustomers])

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

  // Navigate from meeting dashboard → customer detail
  const handleMeetingSelectCustomer = useCallback((id: string, name: string) => {
    const found = customers.find((c) => c.id === id)
    if (found) {
      setSelectedCustomer(found)
    } else {
      // Customer might not be in the current customers list (e.g. excluded); create a minimal stub
      setSelectedCustomer({
        id, displayName: name, isExcluded: false, terms: null,
        current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, totalAr: 0, invoiceCount: 0,
      })
    }
  }, [customers])

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
    const selectedBranchName = branchId ? (branches.find((b) => b.id === branchId)?.name ?? '') : ''
    return (
      <ArCustomerDetail
        customer={selectedCustomer}
        entity={entity}
        branchId={branchId}
        branchName={selectedBranchName}
        role={role}
        branches={branches}
        onBack={() => setSelectedCustomer(null)}
        onRefresh={handleRefreshAfterToggle}
      />
    )
  }

  // ── Customer list view ─────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div className="ar-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Accounts Receivable</div>
          {view === 'ar' && summary && summary.lastImports.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {summary.lastImports.map((imp) => (
                <span key={imp.entity_code} style={{ marginRight: 16 }}>
                  {imp.entity_code} — {fmtDate(imp.report_date.split('T')[0])}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {role === 'ar_team' ? (
            /* ar_team: My Customers / All AR scope toggle */
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 8, padding: 3, gap: 2 }}>
              {([false, true] as const).map((all) => (
                <button key={String(all)} onClick={() => setShowAll(all)}
                  style={{
                    background: showAll === all ? '#ff6b00' : 'transparent',
                    color: showAll === all ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: 'none', borderRadius: 6,
                    padding: '5px 14px', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer',
                  }}>
                  {all ? 'All AR' : 'My Customers'}
                </button>
              ))}
            </div>
          ) : (
            /* other roles: AR / Meeting view toggle */
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 8, padding: 3, gap: 2 }}>
              {(['ar', 'meeting'] as ViewMode[]).map((v) => (
                <button key={v} onClick={() => setView(v)}
                  style={{
                    background: view === v ? '#ff6b00' : 'transparent',
                    color: view === v ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: 'none', borderRadius: 6,
                    padding: '5px 14px', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer',
                  }}>
                  {v === 'ar' ? 'AR' : 'Meeting'}
                </button>
              ))}
            </div>
          )}
          {isArAdmin && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowImport(true)}
                style={{
                  background: '#ff6b00', color: 'var(--text-primary)', border: 'none',
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
            </div>
          )}
        </div>
      </div>

      {/* Meeting dashboard view */}
      {view === 'meeting' && (
        <ArMeetingDashboard
          entity={entity}
          onSelectCustomer={handleMeetingSelectCustomer}
        />
      )}

      {view === 'ar' && <>
      {/* Aging summary cards */}
      <AgingCards
        summary={summary}
        loading={loadingSummary}
        bucket={bucket}
        onBucketClick={setBucket}
      />

      {/* Filters */}
      <div className="ar-filter-col" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ar-filter-search"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '7px 12px', fontSize: 12, outline: 'none', width: 200 }}
        />
        <div className="ar-filter-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            <option value="">All Entities</option>
            {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>

          {branches.length > 1 && (
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}
            >
              <option value="">All Branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}

          {isArAdmin && teamMembers.length > 0 && (
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}
            >
              <option value="">All Assignees</option>
              {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </select>
          )}

          {isAdmin && (
            <button
              onClick={() => setShowExcluded((v) => !v)}
              style={{
                background: showExcluded ? 'rgba(204,68,68,0.12)' : 'transparent',
                border: `1px solid ${showExcluded ? '#663333' : 'var(--border-emphasis)'}`,
                borderRadius: 8, color: showExcluded ? '#cc4444' : 'var(--text-dim)',
                padding: '7px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {showExcluded ? `Hide excluded (${excludedCount})` : `Excluded${excludedCount > 0 ? ` (${excludedCount})` : ''}`}
            </button>
          )}

          {(entity || branchId || bucket || search || assignedUserId) && (
            <button
              onClick={() => { setEntity(''); setBranchId(''); setBucket(''); setSearch(''); setAssignedUserId('') }}
              style={{ background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-muted)', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}
            >
              Clear
            </button>
          )}
        </div>

        {filteredCustomers.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Customer table — desktop */}
      <div className="ar-table-wrap" style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <SortTh label="Customer"   sortKey="displayName"  current={sortKey} dir={sortDir} onSort={handleSort} />
                <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 400, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>Terms</th>
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
                <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading…</td></tr>
              ) : filteredCustomers.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                  {customers.length === 0 ? 'No AR data. Import a file to get started.' : 'No customers match your filters.'}
                </td></tr>
              ) : (
                filteredCustomers.map((cust) => (
                  <tr key={cust.id} onClick={() => setSelectedCustomer(cust)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', opacity: cust.isExcluded ? 0.45 : 1 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
                      <span style={{ color: cust.isExcluded ? 'var(--text-faint)' : '#ff6b00' }}>{cust.displayName}</span>
                      {cust.isExcluded && <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 8, fontWeight: 400 }}>excluded</span>}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.terms ? 'var(--text-secondary)' : 'var(--text-faint)', whiteSpace: 'nowrap' }}>{cust.terms ?? '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.current > 0 ? 'var(--text-primary)' : 'var(--text-faint)', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{cust.current > 0 ? fmt(cust.current) : '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.d30 > 0 ? BUCKET_COLORS['1-30'] : 'var(--text-faint)', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{cust.d30 > 0 ? fmt(cust.d30) : '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.d60 > 0 ? BUCKET_COLORS['31-60'] : 'var(--text-faint)', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{cust.d60 > 0 ? fmt(cust.d60) : '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.d90 > 0 ? BUCKET_COLORS['61-90'] : 'var(--text-faint)', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{cust.d90 > 0 ? fmt(cust.d90) : '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: cust.d90plus > 0 ? BUCKET_COLORS['>90'] : 'var(--text-faint)', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{cust.d90plus > 0 ? fmt(cust.d90plus) : '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(cust.totalAr)}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-dim)', textAlign: 'right' }}>{cust.invoiceCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer cards — mobile */}
      <div className="ar-card-list">
        {loadingCustomers ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading…</div>
        ) : filteredCustomers.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            {customers.length === 0 ? 'No AR data. Import a file to get started.' : 'No customers match your filters.'}
          </div>
        ) : (
          filteredCustomers.map((cust) => (
            <div key={cust.id} onClick={() => setSelectedCustomer(cust)}
              style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 14, cursor: 'pointer', opacity: cust.isExcluded ? 0.5 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: cust.isExcluded ? 'var(--text-faint)' : '#ff6b00' }}>{cust.displayName}</span>
                <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(cust.totalAr)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {([['Current', cust.current, 'Current'], ['1-30', cust.d30, '1–30d'], ['31-60', cust.d60, '31–60d'], ['61-90', cust.d90, '61–90d'], ['>90', cust.d90plus, '>90d']] as [string, number, string][]).map(([key, val, label]) => (
                  <div key={key} style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '6px 8px' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 12, color: val > 0 ? BUCKET_COLORS[key] : 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                      {val > 0 ? fmt(val) : '—'}
                    </div>
                  </div>
                ))}
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '6px 8px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 2 }}>Invoices</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{cust.invoiceCount}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      </>}

      {showImport && (
        <ArImportModal onClose={() => setShowImport(false)} onSuccess={handleImportSuccess} />
      )}
    </div>
  )
}
