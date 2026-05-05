'use client'

import { useState, useEffect, useCallback } from 'react'
import { getMostRecentSaturday, toISODate } from '@/lib/utils/date'
import { formatCurrency, formatPercent } from '@/lib/utils/format'

interface Branch {
  id: string
  name: string
}

interface Target {
  id: string
  branch_id: string
  period_type: string
  target_date: string
  revenue_target: number | null
  profit_pct_target: number | null
}

interface Props {
  branches: Branch[]
}

type PeriodType = 'weekly' | 'monthly'

function formatTargetDate(dateStr: string, periodType: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (periodType === 'monthly') {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function nextSaturday(): string {
  return toISODate(getMostRecentSaturday())
}

function firstOfCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

export default function TargetsClient({ branches }: Props) {
  const [selectedBranchId, setSelectedBranchId] = useState<string>(branches[0]?.id ?? '')
  const [periodType, setPeriodType] = useState<PeriodType>('weekly')
  const [targets, setTargets] = useState<Target[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newRevenue, setNewRevenue] = useState('')
  const [newProfitPct, setNewProfitPct] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRevenue, setEditRevenue] = useState('')
  const [editProfitPct, setEditProfitPct] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const loadTargets = useCallback(() => {
    if (!selectedBranchId) return
    setLoading(true)
    setError(null)
    fetch(`/api/targets?branchId=${selectedBranchId}&periodType=${periodType}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setTargets(json.data as Target[])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedBranchId, periodType])

  useEffect(() => { loadTargets() }, [loadTargets])

  // Reset add form when period type changes
  useEffect(() => {
    setNewDate(periodType === 'weekly' ? nextSaturday() : firstOfCurrentMonth())
    setShowAddForm(false)
    setFormError(null)
  }, [periodType])

  async function handleAdd() {
    if (!newDate) {
      setFormError('Date is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: selectedBranchId,
          periodType,
          targetDate: newDate,
          revenueTarget: newRevenue ? parseFloat(newRevenue) : null,
          profitPctTarget: newProfitPct ? parseFloat(newProfitPct) : null,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setShowAddForm(false)
      setNewRevenue('')
      setNewProfitPct('')
      loadTargets()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save target')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(t: Target) {
    setEditingId(t.id)
    setEditRevenue(t.revenue_target != null ? String(t.revenue_target) : '')
    setEditProfitPct(t.profit_pct_target != null ? String(t.profit_pct_target) : '')
    setEditError(null)
  }

  async function handleEditSave(id: string) {
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/targets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revenueTarget: editRevenue ? parseFloat(editRevenue) : null,
          profitPctTarget: editProfitPct ? parseFloat(editProfitPct) : null,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setEditingId(null)
      loadTargets()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this target?')) return
    try {
      const res = await fetch(`/api/targets/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      loadTargets()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const selectedBranch = branches.find((b) => b.id === selectedBranchId)

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', margin: '0 0 20px 0' }}>
        Performance Targets
      </h1>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Branch selector */}
        <select
          value={selectedBranchId}
          onChange={(e) => setSelectedBranchId(e.target.value)}
          style={selectStyle}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        {/* Period type toggle */}
        <div style={{ display: 'flex', background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8, overflow: 'hidden' }}>
          {(['weekly', 'monthly'] as PeriodType[]).map((pt) => (
            <button
              key={pt}
              onClick={() => setPeriodType(pt)}
              style={{
                padding: '5px 14px',
                fontSize: 12,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: periodType === pt ? '#ff6b00' : 'transparent',
                color: periodType === pt ? '#ffffff' : '#888888',
                textTransform: 'capitalize',
              }}
            >
              {pt}
            </button>
          ))}
        </div>

        <button
          onClick={() => { setShowAddForm(true); setNewDate(periodType === 'weekly' ? nextSaturday() : firstOfCurrentMonth()) }}
          style={{
            background: '#ff6b00',
            color: '#ffffff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 16px',
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          + Add Target
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div style={{ background: '#1e1e1e', border: '1px solid #333333', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <p style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 500, color: '#cccccc' }}>
            New {periodType} target — {selectedBranch?.name}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>
                {periodType === 'weekly' ? 'Week ending (Saturday)' : 'Month (first day)'}
              </label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Revenue Target ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 85000"
                value={newRevenue}
                onChange={(e) => setNewRevenue(e.target.value)}
                style={{ ...inputStyle, width: 130 }}
              />
            </div>
            <div>
              <label style={labelStyle}>Gross Profit % Target</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                placeholder="e.g. 18.5"
                value={newProfitPct}
                onChange={(e) => setNewProfitPct(e.target.value)}
                style={{ ...inputStyle, width: 110 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                style={{ ...btnPrimaryStyle, opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setShowAddForm(false)} style={btnSecondaryStyle}>
                Cancel
              </button>
            </div>
          </div>
          {formError && <p style={{ color: '#cc4444', fontSize: 12, marginTop: 8, marginBottom: 0 }}>{formError}</p>}
        </div>
      )}

      {/* Targets table */}
      {error ? (
        <p style={{ color: '#cc4444', fontSize: 13 }}>{error}</p>
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 40, background: '#1e1e1e', borderRadius: 8 }} />
          ))}
        </div>
      ) : targets.length === 0 ? (
        <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <p style={{ color: '#888888', fontSize: 13, margin: 0 }}>
            No {periodType} targets set for {selectedBranch?.name}.
          </p>
        </div>
      ) : (
        <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                {['Period', 'Revenue Target', 'GP% Target', ''].map((h) => (
                  <th key={h} style={{ ...thStyle, padding: '10px 16px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {targets.map((t, i) => (
                <tr key={t.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #2a2a2a' }}>
                  <td style={tdStyle}>{formatTargetDate(t.target_date, t.period_type)}</td>
                  <td style={tdStyle}>
                    {editingId === t.id ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editRevenue}
                        onChange={(e) => setEditRevenue(e.target.value)}
                        style={{ ...inputStyle, width: 120, padding: '3px 8px', fontSize: 12 }}
                      />
                    ) : (
                      t.revenue_target != null ? formatCurrency(t.revenue_target) : <span style={{ color: '#555555' }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {editingId === t.id ? (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={editProfitPct}
                        onChange={(e) => setEditProfitPct(e.target.value)}
                        style={{ ...inputStyle, width: 90, padding: '3px 8px', fontSize: 12 }}
                      />
                    ) : (
                      t.profit_pct_target != null ? `${t.profit_pct_target}%` : <span style={{ color: '#555555' }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {editingId === t.id ? (
                      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleEditSave(t.id)}
                          disabled={editSaving}
                          style={{ ...btnPrimaryStyle, fontSize: 11, padding: '3px 10px' }}
                        >
                          {editSaving ? '…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingId(null)} style={{ ...btnSecondaryStyle, fontSize: 11, padding: '3px 10px' }}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => startEdit(t)} style={iconBtnStyle}>Edit</button>
                        <button onClick={() => handleDelete(t.id)} style={{ ...iconBtnStyle, color: '#cc4444' }}>Delete</button>
                      </span>
                    )}
                    {editingId === t.id && editError && (
                      <p style={{ color: '#cc4444', fontSize: 11, margin: '4px 0 0', textAlign: 'right' }}>{editError}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #333333',
  borderRadius: 8,
  color: '#cccccc',
  fontSize: 12,
  padding: '5px 12px',
  cursor: 'pointer',
  outline: 'none',
  fontFamily: 'inherit',
}

const inputStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #333333',
  borderRadius: 8,
  color: '#ffffff',
  fontSize: 13,
  padding: '5px 10px',
  outline: 'none',
  fontFamily: 'inherit',
  display: 'block',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#888888',
  marginBottom: 4,
}

const btnPrimaryStyle: React.CSSProperties = {
  background: '#ff6b00',
  color: '#ffffff',
  border: 'none',
  borderRadius: 8,
  padding: '6px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const btnSecondaryStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#cccccc',
  border: '1px solid #333333',
  borderRadius: 8,
  padding: '6px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 400,
  color: '#666666',
}

const tdStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#cccccc',
  padding: '10px 16px',
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888888',
  fontSize: 12,
  cursor: 'pointer',
  padding: '2px 4px',
  fontFamily: 'inherit',
}
