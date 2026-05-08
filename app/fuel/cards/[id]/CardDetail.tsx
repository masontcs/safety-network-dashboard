'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Role } from '@/lib/supabase/database.types'

interface FuelCard {
  id: string
  cardName: string
  vendor: string
  employeeId: string | null
  employeeDisplayName: string | null
  branchId: string | null
  branchName: string | null
  businessTag: string | null
  isConfirmed: boolean
}

interface Transaction {
  id: string
  transaction_date: string
  transaction_time: string | null
  site_name: string | null
  site_city: string | null
  site_state: string | null
  gallons: number | null
  price_per_gallon: number | null
  total_pretax: number | null
  total_with_tax: number
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  displayName: string
}

interface Props {
  cardId: string
  role: Role
  branches: Array<{ id: string; name: string }>
}

type AssignMode = 'employee' | 'general'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${MONTHS[parseInt(m) - 1]} ${parseInt(d)}, ${y}`
}

export default function CardDetail({ cardId, role, branches }: Props) {
  const router = useRouter()
  const isAdmin = role === 'admin'

  const [card, setCard] = useState<FuelCard | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [assignMode, setAssignMode] = useState<AssignMode>('employee')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [empLoading, setEmpLoading] = useState(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  const loadCard = useCallback(async () => {
    setLoading(true)
    setError('')
    const res = await fetch(`/api/fuel/cards/${cardId}`)
    const json = await res.json()
    if (json.success) {
      setCard(json.data.card)
      setTransactions(json.data.transactions)
      if (json.data.card.branchId) setSelectedBranchId(json.data.card.branchId)
    } else {
      setError(json.error ?? 'Failed to load card')
    }
    setLoading(false)
  }, [cardId])

  useEffect(() => { void loadCard() }, [loadCard])

  // Search employees when input changes
  useEffect(() => {
    if (!isAdmin || assignMode !== 'employee') return
    const t = setTimeout(async () => {
      setEmpLoading(true)
      const res = await fetch(`/api/employees?search=${encodeURIComponent(employeeSearch)}&pageSize=20`)
      const json = await res.json()
      if (json.success) setEmployees(json.data ?? [])
      setEmpLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [employeeSearch, isAdmin, assignMode])

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    setSaveSuccess(false)

    const body: Record<string, string> = {}
    if (assignMode === 'employee') {
      if (!selectedEmployeeId) { setSaveError('Select an employee'); setSaving(false); return }
      body.employeeId = selectedEmployeeId
      if (selectedBranchId) body.branchId = selectedBranchId
    } else {
      if (!selectedBranchId) { setSaveError('Select a branch'); setSaving(false); return }
      body.branchId = selectedBranchId
    }

    const res = await fetch(`/api/admin/review/fuel-cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (json.success) {
      setSaveSuccess(true)
      await loadCard()
    } else {
      setSaveError(json.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  function cardStatusLabel(c: FuelCard): string {
    if (!c.isConfirmed) return 'Unlinked'
    if (c.businessTag) return c.businessTag.replace('_', ' ')
    if (c.employeeId) return 'Linked'
    return 'General'
  }

  function statusColor(c: FuelCard): string {
    if (!c.isConfirmed) return '#cc4444'
    if (c.businessTag) return '#666666'
    if (c.employeeId) return '#ff6b00'
    return '#888888'
  }

  if (loading) {
    return (
      <div style={{ padding: '20px 24px', color: '#555555', fontSize: 12 }}>Loading…</div>
    )
  }

  if (error || !card) {
    return (
      <div style={{ padding: '20px 24px', color: '#cc4444', fontSize: 12 }}>{error || 'Card not found'}</div>
    )
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900 }}>
      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button onClick={() => router.push('/fuel')} style={navPillStyle(false)}>Dashboard</button>
        <button onClick={() => router.push('/fuel/cards')} style={navPillStyle(false)}>Cards</button>
      </div>

      {/* Back link */}
      <button
        onClick={() => router.push('/fuel/cards')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888888', fontSize: 12, padding: 0, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        ← Back to Cards
      </button>

      {/* Card header */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', marginBottom: 4 }}>{card.cardName}</div>
            <div style={{ fontSize: 12, color: '#888888', textTransform: 'capitalize' }}>{card.vendor}</div>
          </div>
          <span style={{
            background: card.isConfirmed ? (card.employeeId ? '#1a2a1a' : '#2a2a2a') : '#2a1a1a',
            color: statusColor(card),
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 500,
          }}>
            {cardStatusLabel(card)}
          </span>
        </div>

        {card.isConfirmed && (
          <div style={{ marginTop: 16, display: 'flex', gap: 32 }}>
            {card.employeeDisplayName && (
              <div>
                <div style={{ fontSize: 11, color: '#666666', marginBottom: 2 }}>Employee</div>
                <div style={{ fontSize: 13, color: '#cccccc' }}>{card.employeeDisplayName}</div>
              </div>
            )}
            {card.branchName && (
              <div>
                <div style={{ fontSize: 11, color: '#666666', marginBottom: 2 }}>Branch</div>
                <div style={{ fontSize: 13, color: '#ff6b00' }}>{card.branchName}</div>
              </div>
            )}
            {card.businessTag && (
              <div>
                <div style={{ fontSize: 11, color: '#666666', marginBottom: 2 }}>Business</div>
                <div style={{ fontSize: 13, color: '#cccccc', textTransform: 'capitalize' }}>{card.businessTag.replace('_', ' ')}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Admin assignment panel */}
      {isAdmin && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 14 }}>
            {card.isConfirmed ? 'Update Assignment' : 'Assign Card'}
          </div>

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
            <button onClick={() => setAssignMode('employee')} style={modeTabStyle(assignMode === 'employee')}>Link to Employee</button>
            <button onClick={() => setAssignMode('general')} style={modeTabStyle(assignMode === 'general')}>General Branch Card</button>
          </div>

          {assignMode === 'employee' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: '#666666', marginBottom: 6 }}>Employee</div>
                <input
                  type="text"
                  placeholder="Search by name…"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  style={inputStyle}
                />
                {(employees.length > 0 || empLoading) && (
                  <div style={{ background: '#2a2a2a', borderRadius: 8, border: '1px solid #333333', marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                    {empLoading ? (
                      <div style={{ padding: '8px 12px', fontSize: 12, color: '#555555' }}>Searching…</div>
                    ) : employees.map((e) => (
                      <div
                        key={e.id}
                        onClick={() => { setSelectedEmployeeId(e.id); setEmployeeSearch(e.displayName); setEmployees([]) }}
                        style={{ padding: '8px 12px', fontSize: 12, color: selectedEmployeeId === e.id ? '#ff6b00' : '#cccccc', cursor: 'pointer' }}
                        onMouseEnter={(ev) => (ev.currentTarget.style.background = '#333333')}
                        onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                      >
                        {e.displayName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#666666', marginBottom: 6 }}>Branch (optional)</div>
                <select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} style={inputStyle}>
                  <option value="">— Select branch —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {assignMode === 'general' && (
            <div>
              <div style={{ fontSize: 11, color: '#666666', marginBottom: 6 }}>Branch</div>
              <select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} style={inputStyle}>
                <option value="">— Select branch —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: '#555555', marginTop: 6 }}>
                This card will be tracked under the branch with no employee assigned.
              </div>
            </div>
          )}

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: '#ff6b00',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '7px 18px',
                fontSize: 13,
                fontWeight: 500,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save Assignment'}
            </button>
            {saveError && <span style={{ fontSize: 12, color: '#cc4444' }}>{saveError}</span>}
            {saveSuccess && <span style={{ fontSize: 12, color: '#4caf50' }}>Saved successfully</span>}
          </div>
        </div>
      )}

      {/* Transaction history */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #2a2a2a', fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Transaction History ({transactions.length})
        </div>
        {transactions.length === 0 ? (
          <div style={{ padding: 24, fontSize: 12, color: '#555555', textAlign: 'center' }}>No transactions found</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                {['Date', 'Site', 'Location', 'Gallons', '$/Gal', 'Total'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, color: '#666666', fontWeight: 400, padding: '8px 12px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#888888', whiteSpace: 'nowrap' }}>{fmtDate(t.transaction_date)}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#cccccc' }}>{t.site_name ?? '—'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#888888' }}>
                    {[t.site_city, t.site_state].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#cccccc' }}>
                    {t.gallons != null ? t.gallons.toFixed(3) : '—'}
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#cccccc' }}>
                    {t.price_per_gallon != null ? `$${t.price_per_gallon.toFixed(3)}` : '—'}
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#cccccc' }}>{fmt(t.total_with_tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function navPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 14px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    background: active ? '#ff6b00' : '#2a2a2a',
    color: active ? '#ffffff' : '#888888',
  }
}

function modeTabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 6,
    border: `1px solid ${active ? '#ff6b00' : '#333333'}`,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    background: active ? '#1a1000' : 'transparent',
    color: active ? '#ff6b00' : '#888888',
  }
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#2a2a2a',
  border: '1px solid #333333',
  borderRadius: 8,
  padding: '7px 12px',
  fontSize: 12,
  color: '#cccccc',
  outline: 'none',
  boxSizing: 'border-box',
}
