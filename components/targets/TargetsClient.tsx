'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatCurrency } from '@/lib/utils/format'

interface Branch {
  id: string
  name: string
}

interface FiscalMonth {
  id: string
  name: string
  year: number
  start_date: string
  end_date: string
}

interface FiscalMonthInfo {
  id: string
  name: string
  start_date: string
  end_date: string
}

interface Target {
  id: string
  branch_id: string
  fiscal_month_id: string
  revenue_target: number | null
  profit_pct_target: number | null
  fiscal_months: FiscalMonthInfo | null
}

interface Props {
  branches: Branch[]
  fiscalMonths: FiscalMonth[]
}

function weeksInFiscalMonth(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const startMs = new Date(sy, sm - 1, sd).getTime()
  const endMs = new Date(ey, em - 1, ed).getTime()
  return Math.round((endMs - startMs + 86_400_000) / (7 * 86_400_000))
}

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d))
}

function fiscalMonthLabel(fm: FiscalMonth): string {
  return `${fm.name} — ${fmtDate(fm.start_date)} to ${fmtDate(fm.end_date)}`
}

export default function TargetsClient({ branches, fiscalMonths }: Props) {
  const [selectedBranchId, setSelectedBranchId] = useState<string>(branches[0]?.id ?? '')
  const [targets, setTargets] = useState<Target[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [newFiscalMonthId, setNewFiscalMonthId] = useState<string>(fiscalMonths[fiscalMonths.length - 1]?.id ?? '')
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
    fetch(`/api/targets?branchId=${selectedBranchId}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        const sorted = (json.data as Target[]).sort((a, b) => {
          const aStart = a.fiscal_months?.start_date ?? ''
          const bStart = b.fiscal_months?.start_date ?? ''
          return bStart < aStart ? -1 : bStart > aStart ? 1 : 0
        })
        setTargets(sorted)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedBranchId])

  useEffect(() => { loadTargets() }, [loadTargets])

  async function handleAdd() {
    if (!newFiscalMonthId) {
      setFormError('Please select a fiscal month.')
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
          fiscalMonthId: newFiscalMonthId,
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

  // Fiscal months that don't already have a target for this branch
  const usedFiscalMonthIds = new Set(targets.map((t) => t.fiscal_month_id))
  const availableFiscalMonths = fiscalMonths.filter((fm) => !usedFiscalMonthIds.has(fm.id))

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 20px 0' }}>
        Performance Targets
      </h1>

      {fiscalMonths.length === 0 ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            No fiscal months created yet. Add fiscal months first at{' '}
            <a href="/admin/fiscal-months" style={{ color: '#ff6b00', textDecoration: 'none' }}>
              Settings → Fiscal Months
            </a>
            .
          </p>
        </div>
      ) : (
        <>
          {/* Controls row */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <select
              value={selectedBranchId}
              onChange={(e) => { setSelectedBranchId(e.target.value); setShowAddForm(false) }}
              style={selectStyle}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            <button
              onClick={() => { setShowAddForm(true); setNewFiscalMonthId(availableFiscalMonths[availableFiscalMonths.length - 1]?.id ?? '') }}
              disabled={availableFiscalMonths.length === 0}
              style={{
                background: '#ff6b00',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: 8,
                padding: '6px 16px',
                fontSize: 13,
                cursor: availableFiscalMonths.length === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                opacity: availableFiscalMonths.length === 0 ? 0.5 : 1,
              }}
            >
              + Add Target
            </button>
          </div>

          {/* Add form */}
          {showAddForm && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-emphasis)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <p style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
                New target — {selectedBranch?.name}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={labelStyle}>Fiscal Month</label>
                  <select
                    value={newFiscalMonthId}
                    onChange={(e) => setNewFiscalMonthId(e.target.value)}
                    style={{ ...selectStyle, fontSize: 13 }}
                  >
                    {availableFiscalMonths.map((fm) => (
                      <option key={fm.id} value={fm.id}>{fiscalMonthLabel(fm)}</option>
                    ))}
                  </select>
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
                <div key={i} style={{ height: 44, background: 'var(--bg-surface)', borderRadius: 8 }} />
              ))}
            </div>
          ) : targets.length === 0 ? (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
                No targets set for {selectedBranch?.name}.
              </p>
            </div>
          ) : (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Fiscal Month', 'Revenue Target', 'Weekly Breakdown', 'GP% Target', ''].map((h) => (
                      <th key={h} style={{ ...thStyle, padding: '10px 16px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t, i) => {
                    const fm = t.fiscal_months
                    const weeks = fm ? weeksInFiscalMonth(fm.start_date, fm.end_date) : null
                    const weeklyRevenue = t.revenue_target != null && weeks ? t.revenue_target / weeks : null

                    return (
                      <tr key={t.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                        <td style={tdStyle}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{fm?.name ?? '—'}</span>
                          {fm && (
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)' }}>
                              {fmtDate(fm.start_date)} – {fmtDate(fm.end_date)}
                              {weeks != null && ` · ${weeks}w`}
                            </span>
                          )}
                        </td>
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
                            t.revenue_target != null
                              ? formatCurrency(t.revenue_target)
                              : <span style={{ color: 'var(--text-faint)' }}>—</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {weeklyRevenue != null && editingId !== t.id ? (
                            <span>
                              {formatCurrency(weeklyRevenue)}
                              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>/wk</span>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-faint)' }}>—</span>
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
                            t.profit_pct_target != null
                              ? `${t.profit_pct_target}%`
                              : <span style={{ color: 'var(--text-faint)' }}>—</span>
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
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  fontSize: 12,
  padding: '5px 12px',
  cursor: 'pointer',
  outline: 'none',
  fontFamily: 'inherit',
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontSize: 13,
  padding: '5px 10px',
  outline: 'none',
  fontFamily: 'inherit',
  display: 'block',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-muted)',
  marginBottom: 4,
}

const btnPrimaryStyle: React.CSSProperties = {
  background: '#ff6b00',
  color: 'var(--text-primary)',
  border: 'none',
  borderRadius: 8,
  padding: '6px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const btnSecondaryStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-emphasis)',
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
  color: 'var(--text-dim)',
}

const tdStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary)',
  padding: '10px 16px',
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  fontSize: 12,
  cursor: 'pointer',
  padding: '2px 4px',
  fontFamily: 'inherit',
}
