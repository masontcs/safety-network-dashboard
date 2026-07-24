'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Manage field technicians — the crew who get assigned to tickets and dispatched, and
 * whose labor is logged. Add, rename, and activate/deactivate. Deactivating hides a tech
 * from the pickers but keeps their ticket history; a tech with no history can be deleted.
 */

interface Tech { id: string; name: string; isActive: boolean }

export default function TechniciansClient() {
  const [techs, setTechs] = useState<Tech[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const load = useCallback(() => {
    fetch('/api/billing/technicians?includeInactive=1').then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setTechs(j.data) })
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
    if (await call('/api/billing/technicians', 'POST', { name })) { setNewName(''); load() }
  }
  async function saveRename() {
    const name = editName.trim(); if (!name || !editId) return
    if (await call(`/api/billing/technicians/${editId}`, 'PATCH', { name })) { setEditId(null); load() }
  }
  async function setActive(t: Tech, isActive: boolean) {
    if (await call(`/api/billing/technicians/${t.id}`, 'PATCH', { isActive })) load()
  }
  async function remove(t: Tech) {
    if (!confirm(`Delete ${t.name}? This can't be undone.`)) return
    if (await call(`/api/billing/technicians/${t.id}`, 'DELETE')) { flash(`${t.name} deleted.`); load() }
  }

  if (err) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load technicians: {err}</div>

  const active = (techs ?? []).filter((t) => t.isActive)
  const inactive = (techs ?? []).filter((t) => !t.isActive)

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 className="bx-h1">Technicians</h1>
      <div className="bx-sub">The crew assigned to tickets and dispatched. Deactivate someone to hide them from the pickers without losing their history.</div>

      <div className="card">
        <form onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="bx-lbl">Add a technician</label>
            <input className="bx-f" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Jane Ramirez" style={{ width: '100%' }} />
          </div>
          <button className="bx-btn accent" type="submit" disabled={busy || !newName.trim()}>+ Add</button>
        </form>

        {techs === null ? <div className="bx-empty">Loading…</div>
          : (techs.length === 0 ? <div className="bx-empty">No technicians yet — add one above.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thL}>Name</th><th style={thL}>Status</th><th style={thR}></th>
                </tr>
              </thead>
              <tbody>
                {[...active, ...inactive].map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={tdL}>
                      {editId === t.id ? (
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input className="bx-f" value={editName} autoFocus onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditId(null) }} style={{ width: 200 }} />
                          <button className="bx-btn sm" onClick={saveRename} disabled={busy}>Save</button>
                          <button className="bx-btn ghost sm" onClick={() => setEditId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <span style={{ fontWeight: 500, color: t.isActive ? 'var(--ink)' : 'var(--dim)' }}>{t.name}</span>
                      )}
                    </td>
                    <td style={tdL}>
                      {t.isActive ? <span className="tag t-green">active</span> : <span className="tag t-gray">inactive</span>}
                    </td>
                    <td style={{ ...tdR, whiteSpace: 'nowrap' }}>
                      {editId !== t.id && (
                        <>
                          <button className="bx-btn ghost sm" onClick={() => { setEditId(t.id); setEditName(t.name) }} style={{ marginRight: 6 }}>Rename</button>
                          {t.isActive
                            ? <button className="bx-btn ghost sm" onClick={() => setActive(t, false)} disabled={busy} style={{ marginRight: 6 }}>Deactivate</button>
                            : <button className="bx-btn ghost sm" onClick={() => setActive(t, true)} disabled={busy} style={{ marginRight: 6 }}>Activate</button>}
                          <button className="bx-btn danger sm" onClick={() => remove(t)} disabled={busy}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
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
