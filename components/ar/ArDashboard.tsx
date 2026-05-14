'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Role } from '@/lib/supabase/database.types'
import ArImportModal from './ArImportModal'

interface Branch {
  id: string
  name: string
}

interface AgingSummary {
  aging: Record<string, number>
  total: number
  lastImports: {
    entity_code: string
    report_date: string
    imported_at: string
    invoice_count: number
    total_ar: number
  }[]
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

interface Props {
  role: Role
  branches: Branch[]
}

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

export default function ArDashboard({ role, branches }: Props) {
  const isAdmin = role === 'admin'

  // Filters
  const [entity, setEntity]     = useState<string>('')
  const [branchId, setBranchId] = useState<string>('')
  const [bucket, setBucket]     = useState<string>('')
  const [search, setSearch]     = useState<string>('')
  const [page, setPage]         = useState(1)

  // Data
  const [summary, setSummary]   = useState<AgingSummary | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal]       = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingInvoices, setLoadingInvoices] = useState(true)

  // Import modal
  const [showImport, setShowImport] = useState(false)

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true)
    const params = new URLSearchParams()
    if (entity)   params.set('entity', entity)
    if (branchId) params.set('branchId', branchId)
    const res = await fetch(`/api/ar/summary?${params}`)
    if (res.ok) setSummary(await res.json())
    setLoadingSummary(false)
  }, [entity, branchId])

  const fetchInvoices = useCallback(async () => {
    setLoadingInvoices(true)
    const params = new URLSearchParams({ page: String(page) })
    if (entity)   params.set('entity', entity)
    if (branchId) params.set('branchId', branchId)
    if (bucket)   params.set('agingBucket', bucket)
    if (search)   params.set('search', search)
    const res = await fetch(`/api/ar/invoices?${params}`)
    if (res.ok) {
      const data = await res.json()
      setInvoices(data.invoices)
      setTotal(data.total)
      setPageCount(data.pageCount)
    }
    setLoadingInvoices(false)
  }, [entity, branchId, bucket, search, page])

  useEffect(() => { fetchSummary() }, [fetchSummary])
  useEffect(() => { fetchInvoices() }, [fetchInvoices])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [entity, branchId, bucket, search])

  const handleImportSuccess = () => {
    setShowImport(false)
    fetchSummary()
    fetchInvoices()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Accounts Receivable</div>
          {summary && (
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
              background: '#ff6b00',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
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

      {/* Aging Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        {/* Total card */}
        <div
          style={{
            background: '#ff6b00',
            borderRadius: 12,
            padding: 16,
            cursor: bucket ? 'pointer' : 'default',
          }}
          onClick={() => setBucket('')}
        >
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Total AR
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#fff' }}>
            {loadingSummary ? '—' : fmt(summary?.total ?? 0)}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
            All buckets
          </div>
        </div>

        {AGING_BUCKETS.map((b) => (
          <div
            key={b}
            onClick={() => setBucket(bucket === b ? '' : b)}
            style={{
              background: bucket === b ? '#2a2a2a' : '#1e1e1e',
              border: `1px solid ${bucket === b ? BUCKET_COLORS[b] : '#2a2a2a'}`,
              borderRadius: 12,
              padding: 16,
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
              {b} days
            </div>
            <div style={{ fontSize: 20, fontWeight: 500, color: bucket === b ? BUCKET_COLORS[b] : '#fff' }}>
              {loadingSummary ? '—' : fmt(summary?.aging[b] ?? 0)}
            </div>
            {summary && (
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                {summary.total > 0
                  ? ((summary.aging[b] / summary.total) * 100).toFixed(1) + '%'
                  : '0%'}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          style={{
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: 8,
            color: '#ccc',
            padding: '5px 12px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <option value="">All Entities</option>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>

        {branches.length > 1 && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            style={{
              background: '#2a2a2a',
              border: '1px solid #333',
              borderRadius: 8,
              color: '#ccc',
              padding: '5px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}

        <input
          type="text"
          placeholder="Search invoice #..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: 8,
            color: '#ccc',
            padding: '5px 12px',
            fontSize: 12,
            outline: 'none',
            width: 180,
          }}
        />

        {(entity || branchId || bucket || search) && (
          <button
            onClick={() => { setEntity(''); setBranchId(''); setBucket(''); setSearch('') }}
            style={{
              background: 'transparent',
              border: '1px solid #333',
              borderRadius: 8,
              color: '#888',
              padding: '5px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Invoice Table */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                {['Customer', 'Invoice #', 'Entity', 'Branch', 'PO #', 'Job', 'Invoice Date', 'Due Date', 'Terms', 'Aging', 'Open Balance'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '10px 12px',
                      textAlign: h === 'Open Balance' ? 'right' : 'left',
                      fontSize: 11,
                      color: '#666',
                      fontWeight: 400,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingInvoices ? (
                <tr>
                  <td colSpan={11} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>
                    Loading…
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>
                    No invoices found
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    style={{ borderBottom: '1px solid #222' }}
                  >
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ff6b00', whiteSpace: 'nowrap' }}>
                      {inv.customer?.display_name ?? '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>
                      {inv.invoice_number ?? '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc' }}>
                      {inv.entity_code}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>
                      {inv.branch?.name ?? (
                        <span style={{ color: '#555' }}>{inv.raw_class_code ?? '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>
                      {inv.po_number ?? '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inv.job_name ?? '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>
                      {fmtDate(inv.invoice_date)}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>
                      {fmtDate(inv.due_date)}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>
                      {inv.terms ?? '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                      <span style={{
                        background: `${BUCKET_COLORS[inv.aging_bucket] ?? '#333'}22`,
                        color: BUCKET_COLORS[inv.aging_bucket] ?? '#888',
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                      }}>
                        {inv.aging_bucket}
                      </span>
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#fff', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(inv.open_balance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pageCount > 1 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderTop: '1px solid #2a2a2a',
          }}>
            <span style={{ fontSize: 12, color: '#666' }}>
              {total} invoice{total !== 1 ? 's' : ''}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{
                  background: '#2a2a2a', border: 'none', borderRadius: 6,
                  color: page === 1 ? '#444' : '#ccc',
                  padding: '4px 10px', fontSize: 12, cursor: page === 1 ? 'default' : 'pointer',
                }}
              >
                ‹
              </button>
              <span style={{ fontSize: 12, color: '#888', padding: '4px 8px' }}>
                {page} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page === pageCount}
                style={{
                  background: '#2a2a2a', border: 'none', borderRadius: 6,
                  color: page === pageCount ? '#444' : '#ccc',
                  padding: '4px 10px', fontSize: 12, cursor: page === pageCount ? 'default' : 'pointer',
                }}
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>

      {showImport && (
        <ArImportModal
          onClose={() => setShowImport(false)}
          onSuccess={handleImportSuccess}
        />
      )}
    </div>
  )
}
