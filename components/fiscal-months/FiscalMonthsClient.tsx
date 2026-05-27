'use client'

import { useState, useEffect } from 'react'
import Skeleton from '@/components/ui/Skeleton'

interface FiscalMonth {
  id: string
  name: string
  year: number
  start_date: string
  end_date: string
  sort_order: number
  is_active: boolean
}

const BLANK_FORM = { name: '', year: new Date().getFullYear(), start_date: '', end_date: '', sort_order: 0, is_active: true }

function isSundayStr(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 0
}

function isSaturdayStr(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 6
}

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(y, m - 1, d))
}

function FormRow({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
  saveLabel,
}: {
  value: typeof BLANK_FORM
  onChange: (v: typeof BLANK_FORM) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
  saveLabel: string
}) {
  const field = (key: keyof typeof BLANK_FORM, type: string, placeholder: string, width?: number) => (
    <input
      type={type}
      placeholder={placeholder}
      value={String(value[key])}
      onChange={(e) => onChange({ ...value, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-emphasis)',
        borderRadius: 6,
        padding: '5px 8px',
        fontSize: 12,
        color: 'var(--text-secondary)',
        fontFamily: 'inherit',
        width: width ?? 'auto',
      }}
    />
  )

  return (
    <tr style={{ borderBottom: '1px solid var(--border-emphasis)', background: 'var(--bg-nav)' }}>
      <td style={{ padding: '10px 16px' }}>{field('name', 'text', 'Name e.g. January 2026', 180)}</td>
      <td style={{ padding: '10px 8px' }}>{field('year', 'number', 'Year', 72)}</td>
      <td style={{ padding: '10px 8px' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
          {field('start_date', 'date', '', 130)}
          <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>→</span>
          {field('end_date', 'date', '', 130)}
          {value.start_date && !isSundayStr(value.start_date) && (
            <span style={{ color: '#cc4444', fontSize: 10 }}>start not Sun</span>
          )}
          {value.end_date && !isSaturdayStr(value.end_date) && (
            <span style={{ color: '#cc4444', fontSize: 10 }}>end not Sat</span>
          )}
        </div>
      </td>
      <td style={{ padding: '10px 8px' }}>{field('sort_order', 'number', '0', 56)}</td>
      <td style={{ padding: '10px 8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value.is_active}
            onChange={(e) => onChange({ ...value, is_active: e.target.checked })}
            style={{ accentColor: '#ff6b00' }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Active</span>
        </label>
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onSave}
              disabled={saving}
              className="btn-primary"
              style={{ fontSize: 12, padding: '5px 12px', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : saveLabel}
            </button>
            <button
              onClick={onCancel}
              style={{
                background: 'var(--bg-secondary)', border: 'none', borderRadius: 6, padding: '5px 12px',
                fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
          {error && <div style={{ fontSize: 11, color: '#cc4444', maxWidth: 240 }}>{error}</div>}
        </div>
      </td>
    </tr>
  )
}

export default function FiscalMonthsClient() {
  const [months, setMonths] = useState<FiscalMonth[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Add form state
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState(BLANK_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Edit state
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(BLANK_FORM)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    fetch('/api/fiscal-months')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setMonths(json.data)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [])

  function validateForm(form: typeof BLANK_FORM): string | null {
    if (!form.name.trim()) return 'Name is required.'
    if (!form.year || form.year < 2000) return 'Year must be a valid year.'
    if (!form.start_date) return 'Start date is required.'
    if (!form.end_date) return 'End date is required.'
    if (!isSundayStr(form.start_date)) return 'Start date must be a Sunday.'
    if (!isSaturdayStr(form.end_date)) return 'End date must be a Saturday.'
    if (form.end_date <= form.start_date) return 'End date must be after start date.'
    return null
  }

  async function handleAdd() {
    const err = validateForm(addForm)
    if (err) { setAddError(err); return }
    setAddSaving(true)
    setAddError(null)
    try {
      const res = await fetch('/api/fiscal-months', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      const json = await res.json()
      if (!json.success) { setAddError(json.error); return }
      setMonths((prev) => [...prev, json.data].sort((a, b) =>
        a.year !== b.year ? a.year - b.year :
        a.sort_order !== b.sort_order ? a.sort_order - b.sort_order :
        a.start_date < b.start_date ? -1 : 1
      ))
      setAdding(false)
      setAddForm(BLANK_FORM)
    } catch {
      setAddError('Network error — please try again.')
    } finally {
      setAddSaving(false)
    }
  }

  function startEdit(m: FiscalMonth) {
    setEditId(m.id)
    setEditForm({ name: m.name, year: m.year, start_date: m.start_date, end_date: m.end_date, sort_order: m.sort_order, is_active: m.is_active })
    setEditError(null)
  }

  async function handleEdit() {
    if (!editId) return
    const err = validateForm(editForm)
    if (err) { setEditError(err); return }
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/fiscal-months/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      const json = await res.json()
      if (!json.success) { setEditError(json.error); return }
      setMonths((prev) => prev.map((m) => m.id === editId ? json.data : m).sort((a, b) =>
        a.year !== b.year ? a.year - b.year :
        a.sort_order !== b.sort_order ? a.sort_order - b.sort_order :
        a.start_date < b.start_date ? -1 : 1
      ))
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
      const res = await fetch(`/api/fiscal-months/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) { alert(json.error); return }
      setMonths((prev) => prev.filter((m) => m.id !== id))
      setDeleteId(null)
    } catch {
      alert('Network error — please try again.')
    } finally {
      setDeleteLoading(false)
    }
  }

  if (fetchError) {
    return <div style={{ color: '#cc4444', fontSize: 13, padding: 16 }}>Failed to load fiscal months: {fetchError}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Fiscal Months</div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setAddForm(BLANK_FORM); setAddError(null) }}
            className="btn-primary"
            style={{ fontSize: 12, padding: '7px 16px' }}
          >
            + Add Fiscal Month
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map((i) => <Skeleton key={i} height={44} />)}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Year', 'Date Range', 'Sort', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    className="table-header"
                    style={{ textAlign: 'left', padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 400, fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Add form row */}
              {adding && (
                <FormRow
                  value={addForm}
                  onChange={setAddForm}
                  onSave={handleAdd}
                  onCancel={() => { setAdding(false); setAddError(null) }}
                  saving={addSaving}
                  error={addError}
                  saveLabel="Add"
                />
              )}

              {months.length === 0 && !adding && (
                <tr>
                  <td colSpan={6} style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>
                    No fiscal months defined. Click &ldquo;Add Fiscal Month&rdquo; to create one.
                  </td>
                </tr>
              )}

              {months.map((m) => {
                if (editId === m.id) {
                  return (
                    <FormRow
                      key={m.id}
                      value={editForm}
                      onChange={setEditForm}
                      onSave={handleEdit}
                      onCancel={() => { setEditId(null); setEditError(null) }}
                      saving={editSaving}
                      error={editError}
                      saveLabel="Save"
                    />
                  )
                }

                const isDeleting = deleteId === m.id

                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="table-body" style={{ padding: '10px 16px', color: 'var(--text-primary)', fontWeight: 500 }}>
                      {m.name}
                    </td>
                    <td className="table-body" style={{ padding: '10px 16px' }}>
                      {m.year}
                    </td>
                    <td className="table-body" style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {fmtDate(m.start_date)} → {fmtDate(m.end_date)}
                    </td>
                    <td className="table-body" style={{ padding: '10px 16px' }}>
                      {m.sort_order}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 500,
                        color: m.is_active ? '#4caf50' : '#555555',
                      }}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isDeleting ? (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#cc4444' }}>Delete &ldquo;{m.name}&rdquo;?</span>
                          <button
                            onClick={() => handleDelete(m.id)}
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
                            onClick={() => startEdit(m)}
                            style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteId(m.id)}
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
