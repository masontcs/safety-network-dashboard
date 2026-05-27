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
  payment_type: string | null
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
  const [entity,        setEntity]        = useState('')
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')
  const [searchInput,   setSearchInput]   = useState('')   // what the user is typing
  const [searchDebounced, setSearchDebounced] = useState('') // what we actually query
  const [page,          setPage]          = useState(1)

  const [payments, setPayments] = useState<Payment[]>([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)

  const PAGE_SIZE = 100

  // Debounce: wait 350ms after the user stops typing before fetching
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (entity)          p.set('entity',   entity)
    if (dateFrom)        p.set('dateFrom', dateFrom)
    if (dateTo)          p.set('dateTo',   dateTo)
    if (searchDebounced) p.set('search',   searchDebounced)
    p.set('page', String(page))

    const res = await fetch(`/api/ar/payments?${p}`)
    if (res.ok) {
      const data = await res.json()
      setPayments(data.payments ?? [])
      setTotal(data.total ?? 0)
    }
    setLoading(false)
  }, [entity, dateFrom, dateTo, searchDebounced, page])

  useEffect(() => { fetchPayments() }, [fetchPayments])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [entity, dateFrom, dateTo, searchDebounced])

  const clearFilters = () => {
    setEntity(''); setDateFrom(''); setDateTo(''); setSearchInput(''); setSearchDebounced(''); setPage(1)
  }

  const hasFilters = entity || dateFrom || dateTo || searchInput
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
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8,
            color: 'var(--text-secondary)', padding: '7px 12px', fontSize: 12, outline: 'none', width: 200,
          }}
        />

        <select
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}
        >
          <option value="">All Entities</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '7px 10px', fontSize: 12, outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '7px 10px', fontSize: 12, outline: 'none' }}
          />
        </div>

        {hasFilters && (
          <button
            onClick={clearFilters}
            style={{ background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-muted)', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            Clear
          </button>
        )}

        {!loading && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 4 }}>
            {total.toLocaleString()} payment{total !== 1 ? 's' : ''}
            {hasFilters && payments.length < total ? ` (${payments.length} shown)` : ''}
          </span>
        )}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Customer', 'Entity', 'Check / Ref #', 'Memo', 'Amount'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '10px 12px',
                      fontSize: 11,
                      color: 'var(--text-dim)',
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
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                    Loading…
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
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
                    <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
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
                        <span style={{ color: pmt.unmatched ? 'var(--text-dim)' : 'var(--text-secondary)' }}>
                          {pmt.customer_name}
                          {pmt.unmatched && (
                            <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 6, fontStyle: 'italic' }}>
                              unmatched
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{
                          background: 'var(--bg-secondary)', borderRadius: 4,
                          padding: '2px 7px', fontWeight: 500, color: '#aaa',
                        }}>
                          {pmt.entity_code}
                        </span>
                        {pmt.payment_type === 'deposit' && (
                          <span style={{ fontSize: 10, background: '#2a2010', color: '#cc9900', borderRadius: 4, padding: '1px 5px', fontWeight: 500 }}>
                            DEPOSIT
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {pmt.reference_number ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--text-muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pmt.memo ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
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
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td colSpan={5} style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-dim)' }}>
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
              background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8,
              color: page === 1 ? 'var(--text-faint)' : 'var(--text-secondary)', padding: '6px 14px', fontSize: 12,
              cursor: page === 1 ? 'default' : 'pointer',
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8,
              color: page === totalPages ? 'var(--text-faint)' : 'var(--text-secondary)', padding: '6px 14px', fontSize: 12,
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
