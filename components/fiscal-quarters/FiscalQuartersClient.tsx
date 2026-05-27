'use client'

import { useState, useEffect, useCallback } from 'react'
import Skeleton from '@/components/ui/Skeleton'

interface FiscalMonth {
  id: string
  name: string
  year: number
  start_date: string
  end_date: string
  sort_order: number
}

interface QuarterMonth {
  id: string
  name: string
  start_date: string
  end_date: string
  sort_order: number
}

interface FiscalQuarter {
  id: string
  name: string
  quarter_number: number
  year: number
  is_active: boolean
  created_at: string
  months: QuarterMonth[]
}

const BLANK_FORM = {
  name: '',
  quarterNumber: 1 as 1 | 2 | 3 | 4,
  year: new Date().getFullYear(),
  monthIds: ['', '', ''] as [string, string, string],
}

type QuarterForm = typeof BLANK_FORM

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d))
}

function getAvailableMonths(
  allMonths: FiscalMonth[],
  assignedIds: Set<string>,
  editingQuarterMonthIds: string[],
  formMonthIds: [string, string, string],
  slotIndex: number
): FiscalMonth[] {
  const otherSlotIds = new Set(
    formMonthIds.filter((id, i) => i !== slotIndex && id !== '')
  )
  return allMonths.filter((m) => {
    if (otherSlotIds.has(m.id)) return false
    // Available if: not assigned to any other quarter (editing: own quarter months are ok)
    if (assignedIds.has(m.id) && !editingQuarterMonthIds.includes(m.id)) return false
    return true
  })
}

function MonthSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: FiscalMonth[]
  onChange: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-emphasis)',
          borderRadius: 6,
          padding: '5px 8px',
          fontSize: 12,
          color: value ? '#cccccc' : '#555555',
          fontFamily: 'inherit',
          cursor: 'pointer',
          minWidth: 160,
        }}
      >
        <option value="">— select month —</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({fmtDate(m.start_date)}–{fmtDate(m.end_date)})
          </option>
        ))}
      </select>
    </div>
  )
}

function QuarterFormRow({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
  saveLabel,
  allMonths,
  assignedIds,
  editingQuarterMonthIds,
}: {
  form: QuarterForm
  onChange: (v: QuarterForm) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
  saveLabel: string
  allMonths: FiscalMonth[]
  assignedIds: Set<string>
  editingQuarterMonthIds: string[]
}) {
  function setMonthId(i: 0 | 1 | 2, id: string) {
    const next = [...form.monthIds] as [string, string, string]
    next[i] = id
    onChange({ ...form, monthIds: next })
  }

  const opts = ([0, 1, 2] as const).map((i) =>
    getAvailableMonths(allMonths, assignedIds, editingQuarterMonthIds, form.monthIds, i)
  )

  return (
    <div
      style={{
        background: 'var(--bg-nav)',
        border: '1px solid var(--border-emphasis)',
        borderRadius: 8,
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</div>
          <input
            type="text"
            placeholder="e.g. Q1 FY2026"
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-emphasis)',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              fontFamily: 'inherit',
              width: 160,
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quarter #</div>
          <select
            value={form.quarterNumber}
            onChange={(e) => onChange({ ...form, quarterNumber: Number(e.target.value) as 1 | 2 | 3 | 4 })}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-emphasis)',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              width: 72,
            }}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>Q{n}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Year</div>
          <input
            type="number"
            value={form.year}
            onChange={(e) => onChange({ ...form, year: Number(e.target.value) })}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-emphasis)',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              fontFamily: 'inherit',
              width: 80,
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {([0, 1, 2] as const).map((i) => (
          <MonthSelect
            key={i}
            label={`Month ${i + 1}`}
            value={form.monthIds[i]}
            options={opts[i]}
            onChange={(id) => setMonthId(i, id)}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={onSave}
          disabled={saving}
          className="btn-primary"
          style={{ fontSize: 12, padding: '6px 16px', opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
        <button
          onClick={onCancel}
          style={{
            background: 'var(--bg-secondary)', border: 'none', borderRadius: 6, padding: '6px 16px',
            fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
        {error && <div style={{ fontSize: 11, color: '#cc4444' }}>{error}</div>}
      </div>
    </div>
  )
}

export default function FiscalQuartersClient() {
  const [quarters, setQuarters] = useState<FiscalQuarter[]>([])
  const [allMonths, setAllMonths] = useState<FiscalMonth[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState<QuarterForm>(BLANK_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<QuarterForm>(BLANK_FORM)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const assignedIds = useCallback((): Set<string> => {
    const s = new Set<string>()
    for (const q of quarters) {
      for (const m of q.months) s.add(m.id)
    }
    return s
  }, [quarters])

  useEffect(() => {
    Promise.all([
      fetch('/api/fiscal-quarters').then((r) => r.json()),
      fetch('/api/fiscal-months').then((r) => r.json()),
    ])
      .then(([qJson, mJson]) => {
        if (!qJson.success) throw new Error(qJson.error)
        if (!mJson.success) throw new Error(mJson.error)
        setQuarters(qJson.data)
        setAllMonths(mJson.data)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [])

  function validateForm(form: QuarterForm): string | null {
    if (!form.name.trim()) return 'Name is required.'
    if (form.year < 2000) return 'Year must be a valid year.'
    if (!form.monthIds[0] || !form.monthIds[1] || !form.monthIds[2]) return 'All 3 months must be selected.'
    return null
  }

  async function handleAdd() {
    const err = validateForm(addForm)
    if (err) { setAddError(err); return }
    setAddSaving(true)
    setAddError(null)
    try {
      const res = await fetch('/api/fiscal-quarters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name,
          quarterNumber: addForm.quarterNumber,
          year: addForm.year,
          fiscalMonthIds: addForm.monthIds,
        }),
      })
      const json = await res.json()
      if (!json.success) { setAddError(json.error); return }
      setQuarters((prev) => sortQuarters([...prev, json.data]))
      setAdding(false)
      setAddForm(BLANK_FORM)
    } catch {
      setAddError('Network error — please try again.')
    } finally {
      setAddSaving(false)
    }
  }

  function startEdit(q: FiscalQuarter) {
    const sorted = [...q.months].sort((a, b) => a.sort_order - b.sort_order)
    setEditId(q.id)
    setEditForm({
      name: q.name,
      quarterNumber: q.quarter_number as 1 | 2 | 3 | 4,
      year: q.year,
      monthIds: [sorted[0]?.id ?? '', sorted[1]?.id ?? '', sorted[2]?.id ?? ''],
    })
    setEditError(null)
  }

  async function handleEdit() {
    if (!editId) return
    const err = validateForm(editForm)
    if (err) { setEditError(err); return }
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/fiscal-quarters/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          quarterNumber: editForm.quarterNumber,
          year: editForm.year,
          fiscalMonthIds: editForm.monthIds,
        }),
      })
      const json = await res.json()
      if (!json.success) { setEditError(json.error); return }
      setQuarters((prev) => sortQuarters(prev.map((q) => q.id === editId ? json.data : q)))
      setEditId(null)
    } catch {
      setEditError('Network error — please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/fiscal-quarters/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) { alert(json.error); return }
      setQuarters((prev) => prev.filter((q) => q.id !== id))
      setDeleteId(null)
    } catch {
      alert('Network error — please try again.')
    } finally {
      setDeleteLoading(false)
    }
  }

  function sortQuarters(qs: FiscalQuarter[]): FiscalQuarter[] {
    return [...qs].sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.quarter_number - b.quarter_number
    )
  }

  const assigned = assignedIds()
  const unassignedCount = allMonths.filter((m) => !assigned.has(m.id)).length

  if (fetchError) {
    return <div style={{ color: '#cc4444', fontSize: 13, padding: 16 }}>Failed to load: {fetchError}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Fiscal Quarters</div>
        {!adding && !editId && (
          <button
            onClick={() => { setAdding(true); setAddForm(BLANK_FORM); setAddError(null) }}
            className="btn-primary"
            style={{ fontSize: 12, padding: '7px 16px' }}
            disabled={unassignedCount < 3 && allMonths.length > 0}
            title={unassignedCount < 3 ? 'Need at least 3 unassigned fiscal months to create a quarter' : undefined}
          >
            + Add Quarter
          </button>
        )}
      </div>

      {!loading && allMonths.length === 0 && (
        <div
          style={{
            background: '#2a1a00',
            border: '1px solid #cc5500',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            color: '#ff9966',
          }}
        >
          No fiscal months exist yet.{' '}
          <a href="/admin/fiscal-months" style={{ color: '#ff6b00' }}>
            Create fiscal months first
          </a>{' '}
          before building quarters.
        </div>
      )}

      {!loading && allMonths.length > 0 && unassignedCount < 3 && quarters.length === 0 && (
        <div
          style={{
            background: '#2a1a00',
            border: '1px solid #cc5500',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            color: '#ff9966',
          }}
        >
          Only {unassignedCount} unassigned fiscal month{unassignedCount !== 1 ? 's' : ''} available.
          Each quarter requires exactly 3 unassigned months.{' '}
          <a href="/admin/fiscal-months" style={{ color: '#ff6b00' }}>
            Add more fiscal months
          </a>
          .
        </div>
      )}

      {adding && (
        <QuarterFormRow
          form={addForm}
          onChange={setAddForm}
          onSave={handleAdd}
          onCancel={() => { setAdding(false); setAddError(null) }}
          saving={addSaving}
          error={addError}
          saveLabel="Add Quarter"
          allMonths={allMonths}
          assignedIds={assigned}
          editingQuarterMonthIds={[]}
        />
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map((i) => <Skeleton key={i} height={60} />)}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Quarter', 'Months', 'Year', 'Q#', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--border)',
                      fontWeight: 400,
                      fontSize: 11,
                      color: 'var(--text-dim)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quarters.length === 0 && !adding && (
                <tr>
                  <td colSpan={6} style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>
                    No fiscal quarters defined yet. Click &ldquo;Add Quarter&rdquo; to create one.
                  </td>
                </tr>
              )}

              {quarters.map((q) => {
                const isEditing = editId === q.id
                const isDeleting = deleteId === q.id
                const sortedMonths = [...q.months].sort((a, b) => a.sort_order - b.sort_order)
                const editingMonthIds = isEditing ? sortedMonths.map((m) => m.id) : []
                // Assigned ids excluding this quarter's own months during edit
                const assignedExcludingSelf = new Set<string>(
                  [...assigned].filter((id) => !editingMonthIds.includes(id))
                )

                if (isEditing) {
                  return (
                    <tr key={q.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td colSpan={6} style={{ padding: '12px 16px' }}>
                        <QuarterFormRow
                          form={editForm}
                          onChange={setEditForm}
                          onSave={handleEdit}
                          onCancel={() => { setEditId(null); setEditError(null) }}
                          saving={editSaving}
                          error={editError}
                          saveLabel="Save Changes"
                          allMonths={allMonths}
                          assignedIds={assignedExcludingSelf}
                          editingQuarterMonthIds={editingMonthIds}
                        />
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={q.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px', color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>
                      {q.name}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {sortedMonths.map((m) => (
                          <span
                            key={m.id}
                            style={{
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-emphasis)',
                              borderRadius: 4,
                              padding: '2px 8px',
                              fontSize: 11,
                              color: 'var(--text-secondary)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {m.name}
                          </span>
                        ))}
                        {sortedMonths.length < 3 && (
                          <span style={{ fontSize: 11, color: '#cc4444' }}>
                            {sortedMonths.length}/3 months
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {q.year}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                      Q{q.quarter_number}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: q.is_active ? '#4caf50' : '#555555' }}>
                        {q.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isDeleting ? (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#cc4444' }}>Delete &ldquo;{q.name}&rdquo;?</span>
                          <button
                            onClick={() => handleDelete(q.id)}
                            disabled={deleteLoading}
                            style={{ background: '#3a1a1a', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: '#cc4444', cursor: 'pointer', fontFamily: 'inherit', opacity: deleteLoading ? 0.6 : 1 }}
                          >
                            {deleteLoading ? '…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setDeleteId(null)}
                            style={{ background: 'var(--bg-secondary)', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => startEdit(q)}
                            style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteId(q.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
