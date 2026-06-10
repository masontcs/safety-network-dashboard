'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Role } from '@/lib/supabase/database.types'

interface Promise {
  id: string
  customer_id: string | null
  customer_name: string
  amount: number
  note: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
}

interface SearchResult { id: string; displayName: string }

interface Props {
  role: Role
  currentUserId: string | null
}

const AR_WRITE_ROLES: Role[] = ['admin', 'executive', 'ar_manager', 'ar_team', 'office_team']

function getMondayOf(d: Date): Date {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const m = new Date(d)
  m.setDate(d.getDate() + diff)
  m.setHours(0, 0, 0, 0)
  return m
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function toYMD(d: Date): string {
  return d.toISOString().split('T')[0]
}

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const start = monday.toLocaleDateString('en-US', opts)
  const end   = sunday.toLocaleDateString('en-US', { ...opts, year: 'numeric' })
  return `${start} – ${end}`
}

function fmtTs(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Add Promise modal ─────────────────────────────────────────────────────────

function AddPromiseModal({
  weekOf,
  onClose,
  onSaved,
}: {
  weekOf: string
  onClose: () => void
  onSaved: (p: Promise) => void
}) {
  const [q, setQ]                     = useState('')
  const [results, setResults]         = useState<SearchResult[]>([])
  const [searching, setSearching]     = useState(false)
  const [selected, setSelected]       = useState<SearchResult | null>(null)
  const [amount, setAmount]           = useState('')
  const [note, setNote]               = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => {
    if (q.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const res = await fetch(`/api/ar/customers/search?q=${encodeURIComponent(q)}`)
      if (res.ok) setResults((await res.json()).customers ?? [])
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const handleSave = async () => {
    setError(null)
    const amt = parseFloat(amount)
    if (!selected) { setError('Select a customer'); return }
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount greater than $0'); return }
    setSaving(true)
    const res = await fetch('/api/ar/promises', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId:   selected.id,
        customerName: selected.displayName,
        weekOf,
        amount:       amt,
        note:         note.trim() || null,
      }),
    })
    if (res.ok) {
      const { promise } = await res.json()
      onSaved(promise)
    } else {
      const j = await res.json().catch(() => ({})) as { error?: string }
      setError(j.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  const inp = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-emphasis)',
    borderRadius: 8,
    color: 'var(--text-secondary)',
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}
    >
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 460, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>Add Promise to Pay</div>

        {/* Customer search */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer</span>
          {selected ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,107,0,0.08)', border: '1px solid rgba(255,107,0,0.25)', borderRadius: 8, padding: '8px 12px' }}>
              <span style={{ fontSize: 13, color: '#ff6b00', fontWeight: 500 }}>{selected.displayName}</span>
              <button onClick={() => { setSelected(null); setQ('') }} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </div>
          ) : (
            <>
              <input
                autoFocus
                placeholder="Search customer…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={inp}
              />
              {searching && <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '4px 0' }}>Searching…</div>}
              {!searching && q.length >= 2 && results.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '4px 0' }}>No customers found</div>
              )}
              {results.length > 0 && (
                <div style={{ border: '1px solid var(--border-emphasis)', borderRadius: 8, overflow: 'hidden', maxHeight: 200, overflowY: 'auto' }}>
                  {results.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => { setSelected(r); setQ(''); setResults([]) }}
                      style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {r.displayName}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Amount */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount Promised</span>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', fontSize: 13 }}>$</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ ...inp, paddingLeft: 24 }}
            />
          </div>
        </div>

        {/* Note */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Note <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(optional)</span></span>
          <textarea
            placeholder="e.g. Customer confirmed payment by Friday…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        {error && <div style={{ fontSize: 12, color: '#cc4444' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{ background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-muted)', padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selected || !amount}
            style={{
              background: '#ff6b00', border: 'none', borderRadius: 8,
              color: '#ffffff', padding: '8px 20px', fontSize: 13, fontWeight: 500,
              cursor: saving || !selected || !amount ? 'default' : 'pointer',
              opacity: saving || !selected || !amount ? 0.55 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save Promise'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main view ─────────────────────────────────────────────────────────────────

export default function ArPromisesView({ role, currentUserId }: Props) {
  const canWrite = AR_WRITE_ROLES.includes(role)
  const isAdmin  = role === 'admin'

  const [monday, setMonday]       = useState<Date>(() => getMondayOf(new Date()))
  const [promises, setPromises]   = useState<Promise[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [showAdd, setShowAdd]     = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const weekOf = toYMD(monday)

  const fetchPromises = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/ar/promises?weekOf=${weekOf}`)
    if (res.ok) {
      const d = await res.json()
      setPromises(d.promises ?? [])
      setTotal(d.total ?? 0)
    }
    setLoading(false)
  }, [weekOf])

  useEffect(() => { fetchPromises() }, [fetchPromises])

  const handlePrev = () => setMonday((m) => addDays(m, -7))
  const handleNext = () => setMonday((m) => addDays(m, 7))

  const isCurrentWeek = toYMD(getMondayOf(new Date())) === weekOf

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    await fetch(`/api/ar/promises/${id}`, { method: 'DELETE' })
    setPromises((prev) => prev.filter((p) => p.id !== id))
    setTotal((prev) => {
      const removed = promises.find((p) => p.id === id)
      return prev - (removed ? Number(removed.amount) : 0)
    })
    setDeletingId(null)
  }

  const handleSaved = (p: Promise) => {
    setPromises((prev) => [p, ...prev])
    setTotal((prev) => prev + Number(p.amount))
    setShowAdd(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Week navigator */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <button
          onClick={handlePrev}
          style={{ background: 'var(--bg-secondary)', border: 'none', borderRadius: 8, color: 'var(--text-secondary)', width: 36, height: 36, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >‹</button>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Week of</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {fmtWeekRange(monday)}
            {isCurrentWeek && (
              <span style={{ fontSize: 10, color: '#ff6b00', background: 'rgba(255,107,0,0.12)', borderRadius: 4, padding: '1px 6px', fontWeight: 500 }}>This Week</span>
            )}
          </div>
        </div>

        <button
          onClick={handleNext}
          style={{ background: 'var(--bg-secondary)', border: 'none', borderRadius: 8, color: 'var(--text-secondary)', width: 36, height: 36, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >›</button>
      </div>

      {/* Total + Add button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 20px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Total Promised</div>
          <div style={{ fontSize: 26, fontWeight: 500, color: loading ? 'var(--text-faint)' : '#ff6b00' }}>
            {loading ? '—' : fmt(total)}
          </div>
          {!loading && (
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
              {promises.length} promise{promises.length !== 1 ? 's' : ''} this week
            </div>
          )}
        </div>

        {canWrite && (
          <button
            onClick={() => setShowAdd(true)}
            style={{
              background: '#ff6b00', border: 'none', borderRadius: 10,
              color: '#ffffff', padding: '12px 20px', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Promise
          </button>
        )}
      </div>

      {/* Promise list */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--text-faint)' }}>Loading…</div>
        ) : promises.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 4 }}>No promises logged for this week.</div>
            {canWrite && (
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Click "Add Promise" to log one.</div>
            )}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>Customer</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>Amount</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>Note</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>Logged By</th>
                <th style={{ padding: '10px 16px', width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {promises.map((p, i) => {
                const canDelete = isAdmin || p.created_by === currentUserId
                return (
                  <tr
                    key={p.id}
                    style={{ borderBottom: i < promises.length - 1 ? '1px solid var(--border)' : 'none' }}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: '#ff6b00' }}>
                      {p.customer_name}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {fmt(Number(p.amount))}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: p.note ? 'var(--text-secondary)' : 'var(--text-faint)', maxWidth: 280 }}>
                      {p.note ?? <span style={{ fontStyle: 'italic' }}>No note</span>}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                      {p.created_by_name ?? '—'}<br />
                      <span style={{ color: 'var(--text-faint)' }}>{fmtTs(p.created_at)}</span>
                    </td>
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(p.id)}
                          disabled={deletingId === p.id}
                          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16, padding: '2px 6px', opacity: deletingId === p.id ? 0.4 : 1 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
                        >×</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddPromiseModal
          weekOf={weekOf}
          onClose={() => setShowAdd(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
