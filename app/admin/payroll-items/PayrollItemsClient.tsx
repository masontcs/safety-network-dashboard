'use client'

import { useState, useEffect, useMemo } from 'react'

interface PayrollItem {
  id: string
  name: string
  groupId: string
  groupName: string
  isConfirmed: boolean
  aiSuggestedGroup: string | null
  aiConfidence: number | null
  totalAmount: number | null
  transactionCount: number | null
  stagedCount: number
}

interface Group {
  id: string
  name: string
}

type StatusFilter = 'all' | 'confirmed' | 'pending'
type SortKey = 'name' | 'group' | 'amount'
type SortDir = 'asc' | 'desc'

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PayrollItemsClient() {
  const [items, setItems] = useState<PayrollItem[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Date range for spending column
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [appliedStart, setAppliedStart] = useState('')
  const [appliedEnd, setAppliedEnd] = useState('')
  const [rangeLoading, setRangeLoading] = useState(false)

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Inline group editing state — map of itemId → { pendingGroupId, saving, error }
  const [edits, setEdits] = useState<Record<string, { pendingGroupId: string; saving: boolean; error: string | null }>>({})

  async function fetchItems(start?: string, end?: string) {
    const params = new URLSearchParams()
    if (start) params.set('startDate', start)
    if (end) params.set('endDate', end)
    const url = `/api/admin/payroll-items${params.size > 0 ? '?' + params.toString() : ''}`
    const res = await fetch(url)
    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? 'Failed to load')
    setItems(json.data.items)
    setGroups(json.data.groups)
  }

  useEffect(() => {
    setLoading(true)
    fetchItems()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function applyDateRange() {
    if (!startDate && !endDate) return
    setRangeLoading(true)
    try {
      await fetchItems(startDate || undefined, endDate || undefined)
      setAppliedStart(startDate)
      setAppliedEnd(endDate)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRangeLoading(false)
    }
  }

  async function clearDateRange() {
    setStartDate('')
    setEndDate('')
    setAppliedStart('')
    setAppliedEnd('')
    setLoading(true)
    try {
      await fetchItems()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function startEdit(item: PayrollItem) {
    setEdits((prev) => ({
      ...prev,
      [item.id]: { pendingGroupId: item.groupId, saving: false, error: null },
    }))
  }

  function cancelEdit(itemId: string) {
    setEdits((prev) => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }

  async function saveGroupChange(item: PayrollItem) {
    const edit = edits[item.id]
    if (!edit || edit.pendingGroupId === item.groupId) { cancelEdit(item.id); return }

    setEdits((prev) => ({ ...prev, [item.id]: { ...prev[item.id], saving: true, error: null } }))
    try {
      const res = await fetch(`/api/admin/payroll-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: edit.pendingGroupId }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to save')

      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, groupId: json.data.groupId, groupName: json.data.groupName }
            : i
        )
      )
      cancelEdit(item.id)
    } catch (e) {
      setEdits((prev) => ({
        ...prev,
        [item.id]: { ...prev[item.id], saving: false, error: (e as Error).message },
      }))
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    let result = items
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((i) => i.name.toLowerCase().includes(q))
    }
    if (groupFilter !== 'all') {
      result = result.filter((i) => i.groupId === groupFilter)
    }
    if (statusFilter === 'confirmed') result = result.filter((i) => i.isConfirmed)
    if (statusFilter === 'pending') result = result.filter((i) => !i.isConfirmed)

    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'group') cmp = a.groupName.localeCompare(b.groupName)
      else if (sortKey === 'amount') cmp = (a.totalAmount ?? -1) - (b.totalAmount ?? -1)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [items, search, groupFilter, statusFilter, sortKey, sortDir])

  const rangeLabel = appliedStart || appliedEnd
    ? `${appliedStart || '—'} to ${appliedEnd || '—'}`
    : 'All time'

  const totalFiltered = filtered.reduce((s, i) => s + (i.totalAmount ?? 0), 0)

  if (loading) {
    return <div style={{ padding: '20px 24px', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
  }
  if (error) {
    return <div style={{ padding: '20px 24px', color: '#cc4444', fontSize: 13 }}>{error}</div>
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1100 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>Payroll Items</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{items.length} items · {groups.length} groups</div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={inputStyle}
        />

        {/* Group filter */}
        <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} style={selectStyle}>
          <option value="all">All groups</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 2 }}>
          {(['all', 'confirmed', 'pending'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={pillStyle(statusFilter === s)}
            >
              {s === 'all' ? 'All' : s === 'confirmed' ? 'Confirmed' : 'Pending'}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Spending range:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ ...inputStyle, width: 140 }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ ...inputStyle, width: 140 }}
          />
          <button
            onClick={applyDateRange}
            disabled={rangeLoading || (!startDate && !endDate)}
            style={{
              background: '#ff6b00', color: 'var(--text-primary)', border: 'none', borderRadius: 8,
              padding: '6px 14px', fontSize: 12, cursor: rangeLoading ? 'not-allowed' : 'pointer',
              opacity: rangeLoading ? 0.6 : 1,
            }}
          >
            {rangeLoading ? 'Loading…' : 'Apply'}
          </button>
          {(appliedStart || appliedEnd) && (
            <button onClick={clearDateRange} style={{ background: 'none', border: '1px solid var(--border-emphasis)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', overflowX: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {filtered.length} item{filtered.length !== 1 ? 's' : ''}
          </span>
          {(appliedStart || appliedEnd) && filtered.some((i) => i.totalAmount !== null) && (
            <span style={{ fontSize: 12, color: '#ff6b00' }}>
              {rangeLabel}: {fmt(totalFiltered)}
            </span>
          )}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <SortTh label="Item Name" sortKey="name" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortTh label="Group" sortKey="group" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Transactions</th>
              <SortTh label={`Amount (${rangeLabel})`} sortKey="amount" current={sortKey} dir={sortDir} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
                  No items match your filters
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const edit = edits[item.id]
                const isDirty = edit && edit.pendingGroupId !== item.groupId
                return (
                  <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                    {/* Name */}
                    <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 280 }}>
                      <div>{item.name}</div>
                      {!item.isConfirmed && item.aiSuggestedGroup && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          AI suggestion: <span style={{ color: '#ff6b00' }}>{item.aiSuggestedGroup}</span>
                          {item.aiConfidence != null && (
                            <span style={{ color: 'var(--text-faint)' }}> ({Math.round(item.aiConfidence * 100)}%)</span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Group (inline edit) */}
                    <td style={{ padding: '10px 16px', fontSize: 12 }}>
                      {edit ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <select
                            value={edit.pendingGroupId}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], pendingGroupId: e.target.value },
                              }))
                            }
                            style={{
                              ...selectStyle,
                              borderColor: isDirty ? '#ff6b00' : 'var(--bg-tertiary)',
                            }}
                          >
                            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                          {isDirty && (
                            <button
                              disabled={edit.saving}
                              onClick={() => saveGroupChange(item)}
                              style={{ background: '#ff6b00', color: 'var(--text-primary)', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: edit.saving ? 'not-allowed' : 'pointer', opacity: edit.saving ? 0.6 : 1 }}
                            >
                              {edit.saving ? '…' : 'Save'}
                            </button>
                          )}
                          <button
                            onClick={() => cancelEdit(item.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer', padding: '4px 6px' }}
                          >
                            ✕
                          </button>
                          {edit.error && <span style={{ fontSize: 11, color: '#cc4444' }}>{edit.error}</span>}
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(item)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                          title="Click to change group"
                        >
                          <span style={{ color: 'var(--text-secondary)' }}>{item.groupName}</span>
                          <span style={{ color: 'var(--text-faint)', fontSize: 10, marginLeft: 6 }}>✎</span>
                        </button>
                      )}
                    </td>

                    {/* Status */}
                    <td style={{ padding: '10px 16px' }}>
                      {item.isConfirmed ? (
                        <span style={statusPill('#1a3a1a', '#4caf50')}>Confirmed</span>
                      ) : (
                        <span style={statusPill('#3a2a1a', '#ff9800')}>
                          Pending{item.stagedCount > 0 ? ` · ${item.stagedCount} staged` : ''}
                        </span>
                      )}
                    </td>

                    {/* Transaction count */}
                    <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                      {item.transactionCount != null ? item.transactionCount.toLocaleString() : '—'}
                    </td>

                    {/* Amount */}
                    <td style={{ padding: '10px 16px', fontSize: 12, color: item.totalAmount != null ? 'var(--text-secondary)' : 'var(--text-faint)', textAlign: 'right' }}>
                      {item.totalAmount != null ? fmt(item.totalAmount) : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortTh({
  label, sortKey, current, dir, onClick,
}: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  onClick: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th
      style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', color: active ? 'var(--text-secondary)' : 'var(--text-dim)' }}
      onClick={() => onClick(sortKey)}
    >
      {label} {active ? (dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )
}

function statusPill(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  }
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 12px',
    borderRadius: 6,
    border: `1px solid ${active ? '#ff6b00' : 'var(--bg-tertiary)'}`,
    background: active ? '#1a1000' : 'transparent',
    color: active ? '#ff6b00' : 'var(--text-muted)',
    fontSize: 12,
    cursor: 'pointer',
  }
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  outline: 'none',
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  outline: 'none',
  cursor: 'pointer',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  color: 'var(--text-dim)',
  fontWeight: 400,
  padding: '8px 16px',
  whiteSpace: 'nowrap',
}
