'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Manage job types — the vocabulary the dispatch picker offers when staging/publishing a shift.
 * Add, rename, reorder, and retire (deactivate) them. Retiring hides a type from the picker but
 * leaves it on shifts that already used it. Admin + Branch Manager only (the 'jobtypes' area).
 */

interface JobType { id: string; name: string; sortOrder: number; isActive: boolean }

export default function JobTypesClient() {
  const [rows, setRows] = useState<JobType[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const load = useCallback(() => {
    fetch('/api/billing/job-types?manage=1').then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setRows(j.data) })
      .catch((e: Error) => setErr(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(null), 2500) }

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      const j = await res.json()
      if (!j.success) { flash(j.error); return false }
      return true
    } catch { flash('Network error — please try again.'); return false }
    finally { setBusy(false) }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim(); if (!name || busy) return
    if (await call('/api/billing/job-types', 'POST', { name })) { setNewName(''); load() }
  }
  async function saveRename() {
    const name = editName.trim(); if (!name || !editId) return
    if (await call(`/api/billing/job-types/${editId}`, 'PATCH', { name })) { setEditId(null); load() }
  }
  async function setActive(t: JobType, isActive: boolean) {
    if (await call(`/api/billing/job-types/${t.id}`, 'PATCH', { isActive })) load()
  }
  async function remove(t: JobType) {
    if (!confirm(`Delete "${t.name}"? This can't be undone. (Shifts that already used it keep the name.)`)) return
    if (await call(`/api/billing/job-types/${t.id}`, 'DELETE')) { flash(`"${t.name}" deleted.`); load() }
  }
  // Swap sort order with the adjacent active row.
  async function move(t: JobType, dir: -1 | 1) {
    if (!rows) return
    const active = rows.filter((r) => r.isActive)
    const i = active.findIndex((r) => r.id === t.id)
    const j = i + dir
    if (j < 0 || j >= active.length) return
    const other = active[j]
    setBusy(true)
    const ok1 = await call(`/api/billing/job-types/${t.id}`, 'PATCH', { sortOrder: other.sortOrder })
    const ok2 = await call(`/api/billing/job-types/${other.id}`, 'PATCH', { sortOrder: t.sortOrder })
    if (ok1 && ok2) load()
  }

  if (err) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load job types: {err}</div>

  const active = (rows ?? []).filter((r) => r.isActive)
  const inactive = (rows ?? []).filter((r) => !r.isActive)

  const renderRow = (t: JobType, idx: number, count: number) => (
    <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
      <td style={tdL}>
        {editId === t.id ? (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="bx-f" value={editName} autoFocus onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditId(null) }} style={{ width: 240 }} />
            <button className="bx-btn sm" onClick={saveRename} disabled={busy}>Save</button>
            <button className="bx-btn ghost sm" onClick={() => setEditId(null)}>Cancel</button>
          </span>
        ) : (
          <span style={{ fontWeight: 500, color: t.isActive ? 'var(--ink)' : 'var(--dim)' }}>{t.name}</span>
        )}
      </td>
      <td style={tdL}>
        {t.isActive ? <span className="tag t-green">active</span> : <span className="tag t-gray">retired</span>}
      </td>
      <td style={tdR}>
        {editId !== t.id && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {t.isActive && (
              <>
                <button className="bx-btn ghost sm" onClick={() => move(t, -1)} disabled={busy || idx === 0} title="Move up">↑</button>
                <button className="bx-btn ghost sm" onClick={() => move(t, 1)} disabled={busy || idx === count - 1} title="Move down">↓</button>
              </>
            )}
            <button className="bx-btn ghost sm" onClick={() => { setEditId(t.id); setEditName(t.name) }}>Rename</button>
            {t.isActive
              ? <button className="bx-btn ghost sm" onClick={() => setActive(t, false)} disabled={busy}>Retire</button>
              : <button className="bx-btn ghost sm" onClick={() => setActive(t, true)} disabled={busy}>Restore</button>}
            <button className="bx-btn danger sm" onClick={() => remove(t)} disabled={busy}>Delete</button>
          </div>
        )}
      </td>
    </tr>
  )

  return (
    <div>
      <h1 className="bx-h1">Job Types</h1>
      <div className="bx-sub">The list a dispatcher picks from when staging or publishing a shift. Reorder to change how they appear; retire one to hide it without touching past shifts.</div>

      <div className="card">
        <form onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="bx-lbl">Add a job type</label>
            <input className="bx-f" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Lane Closure" style={{ width: '100%' }} />
          </div>
          <button className="bx-btn accent" type="submit" disabled={busy || !newName.trim()}>+ Add</button>
        </form>

        {rows === null ? <div className="bx-empty">Loading…</div>
          : (rows.length === 0 ? <div className="bx-empty">No job types yet — add one above.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr><th style={thL}>Name</th><th style={thL}>Status</th><th style={thR}></th></tr>
              </thead>
              <tbody>
                {active.map((t, i) => renderRow(t, i, active.length))}
                {inactive.map((t) => renderRow(t, -1, 0))}
              </tbody>
            </table>
          ))}
      </div>

      {msg && <div className="bx-toast">{msg}</div>}
    </div>
  )
}

const thBase: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--dim)', fontWeight: 600, padding: '4px 8px' }
const thL: React.CSSProperties = { ...thBase, textAlign: 'left' }
const thR: React.CSSProperties = { ...thBase, textAlign: 'right' }
const tdL: React.CSSProperties = { padding: '10px 8px', fontSize: 13, textAlign: 'left' }
const tdR: React.CSSProperties = { padding: '10px 8px', fontSize: 13, textAlign: 'right' }
