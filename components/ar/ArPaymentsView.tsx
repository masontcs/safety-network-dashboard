'use client'

import { useState, useEffect, useCallback } from 'react'

interface Payment {
  id: string
  entity_code: string
  payment_date: string
  reference_number: string | null
  amount: number
  memo: string | null
  customer_name: string
  customer_id: string | null
  unmatched: boolean
}

const ENTITIES = ['TCS', 'INC', 'STS'] as const

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

interface Props {
  onSelectCustomer?: (customerId: string) => void
}

export default function ArPaymentsView({ onSelectCustomer }: Props) {
  const [entity,   setEntity]   = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [search,   setSearch]   = useState('')
  const [page,     setPage]     = useState(1)

  const [payments, setPayments] = useState<Payment[]>([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)

  const PAGE_SIZE = 100

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (entity)   p.set('entity',   entity)
    if (dateFrom) p.set('dateFrom', dateFrom)
    if (dateTo)   p.set('dateTo',   dateTo)
    if (search)   p.set('search',   search)
    p.set('page', String(page))

    const res = await fetch(`/api/ar/payments?${p}`)
    if (res.ok) {
      const data = await res.json()
      setPayments(data.payments ?? [])
      setTotal(data.total ?? 0)
    }
    setLoading(false)
  }, [entity, dateFrom, dateTo, search, page])

  useEffect(() => { fetchPayments() }, [fetchPayments])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [entity, dateFrom, dateTo, search])

  const clearFilters = () => {
    setEntity(''); setDateFrom(''); setDateTo(''); setSearch(''); setPage(1)
  }

  const hasFilters = entity || dateFrom || dateTo || search
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Compute total of visible payments
  const visibleTotal = payments.reduce((s, p) => s + p.amount, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: '#2a2a2a', border: '1px solid #333', borderRadius: 8,
            color: '#ccc', padding: '7px 12px', fontSize: 12, outline: 'none', width: 200,
          }}
        />

        <select
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}
        >
          <option value="">All Entities</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#666' }}>From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '7px 10px', fontSize: 12, outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#666' }}>To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '7px 10px', fontSize: 12, outline: 'none' }}
          />
        </div>

        {hasFilters && (
          <button
            onClick={clearFilters}
            style={{ background: 'transparent', border: '1px solid #333', borderRadius: 8, color: '#888', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            Clear
          </button>
        )}

        {!loading && (
          <span style={{ fontSize: 12, color: '#555', marginLeft: 4 }}>
            {total.toLocaleString()} payment{total !== 1 ? 's' : ''}
            {hasFilters && payments.length < total ? ` (${payments.length} shown)` : ''}
          </span>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                {['Date', 'Customer', 'Entity', 'Check / Ref #', 'Memo', 'Amount'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '10px 12px',
                      fontSize: 11,
                      color: '#666',
                      fontWeight: 400,
                      textAlign: i === 5 ? 'right' : 'left',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#555', fontSize: 13 }}>
                    Loading…
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#555', fontSize: 13 }}>
                    {hasFilters ? 'No payments match your filters.' : 'No payments imported yet. Use Import Payments to get started.'}
                  </td>
                </tr>
              ) : (
                payments.map((pmt) => (
                  <tr
                    key={pmt.id}
                    style={{ borderBottom: '1px solid #222' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#242424')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>
                      {fmtDate(pmt.payment_date)}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {pmt.customer_id && onSelectCustomer ? (
                        <span
                          onClick={() => onSelectCustomer(pmt.customer_id!)}
                          style={{ color: '#ff6b00', cursor: 'pointer' }}
                        >
                          {pmt.customer_name}
                        </span>
                      ) : (
                        <span style={{ color: pmt.unmatched ? '#666' : '#ccc' }}>
                          {pmt.customer_name}
                          {pmt.unmatched && (
                            <span style={{ fontSize: 10, color: '#555', marginLeft: 6, fontStyle: 'italic' }}>
                              unmatched
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 11, color: '#888' }}>
                      <span style={{
                        background: '#2a2a2a', borderRadius: 4,
                        padding: '2px 7px', fontWeight: 500, color: '#aaa',
                      }}>
                        {pmt.entity_code}
                      </span>
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {pmt.reference_number ?? <span style={{ color: '#444' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pmt.memo ?? <span style={{ color: '#444' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: '#4caf50', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(pmt.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Footer total */}
            {!loading && payments.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td colSpan={5} style={{ padding: '10px 12px', fontSize: 12, color: '#666' }}>
                    {payments.length < total
                      ? `Showing ${payments.length} of ${total.toLocaleString()} payments`
                      : `${payments.length} payment${payments.length !== 1 ? 's' : ''}`}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: '#4caf50', fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(visibleTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              background: '#2a2a2a', border: '1px solid #333', borderRadius: 8,
              color: page === 1 ? '#444' : '#ccc', padding: '6px 14px', fontSize: 12,
              cursor: page === 1 ? 'default' : 'pointer',
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: '#666' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              background: '#2a2a2a', border: '1px solid #333', borderRadius: 8,
              color: page === totalPages ? '#444' : '#ccc', padding: '6px 14px', fontSize: 12,
              cursor: page === totalPages ? 'default' : 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
