'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Manage field technicians — the crew who get assigned to tickets and dispatched, and
 * whose labor is logged. Add, rename, and activate/deactivate. Deactivating hides a tech
 * from the pickers but keeps their ticket history; a tech with no history can be deleted.
 */

interface Tech { id: string; name: string; isActive: boolean; hasLogin?: boolean; username?: string | null; email?: string | null }

export default function TechniciansClient() {
  const [techs, setTechs] = useState<Tech[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [loginFor, setLoginFor] = useState<{ tech: Tech; mode: 'create' | 'reset' } | null>(null)

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
                  <th style={thL}>Name</th><th style={thL}>Status</th><th style={thL}>Login</th><th style={thR}></th>
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
                    <td style={tdL}>
                      {t.hasLogin
                        ? <span style={{ fontSize: 12 }}>{t.username ? <b>{t.username}</b> : 'linked'}{t.email ? <span style={{ color: 'var(--dim)' }}> · {t.email}</span> : null}</span>
                        : <span style={{ fontSize: 12, color: 'var(--dim)' }}>no login</span>}
                    </td>
                    <td style={{ ...tdR, whiteSpace: 'nowrap' }}>
                      {editId !== t.id && (
                        <>
                          {t.hasLogin
                            ? <button className="bx-btn ghost sm" onClick={() => setLoginFor({ tech: t, mode: 'reset' })} disabled={busy} style={{ marginRight: 6 }}>Reset password</button>
                            : <button className="bx-btn accent sm" onClick={() => setLoginFor({ tech: t, mode: 'create' })} disabled={busy} style={{ marginRight: 6 }}>Create login</button>}
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

      {loginFor && (
        <TechLoginModal
          tech={loginFor.tech}
          mode={loginFor.mode}
          onClose={() => { setLoginFor(null); load() }}
        />
      )}

      {msg && <div className="bx-toast">{msg}</div>}
    </div>
  )
}

const genPassword = () => 'Tech-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89) + '!'

function TechLoginModal({ tech, mode, onClose }: { tech: Tech; mode: 'create' | 'reset'; onClose: () => void }) {
  const [email, setEmail] = useState(tech.email ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState(genPassword())
  const [hybrid, setHybrid] = useState(false) // false = field-only tech; true = also full desktop (admin)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ username?: string; email?: string; password: string } | null>(null)

  async function submit() {
    if (busy) return
    setErr(null)
    if (mode === 'create') {
      if (!email.trim()) { setErr('Email is required.'); return }
      if (!/^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase())) { setErr('Username must be 3–20 chars: lowercase letters, numbers, underscore.'); return }
    }
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return }
    setBusy(true)
    try {
      const url = `/api/billing/technicians/${tech.id}/login`
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'create'
          ? { email: email.trim(), username: username.trim().toLowerCase(), temporaryPassword: password, role: hybrid ? 'admin' : 'tech' }
          : { temporaryPassword: password }),
      })
      const j = await res.json()
      if (!j.success) { setErr(j.error ?? 'Failed'); return }
      setDone({ username: mode === 'create' ? username.trim().toLowerCase() : undefined, email: mode === 'create' ? email.trim() : undefined, password })
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 16px 16px' }}>
      <div onMouseDown={(e) => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 440 }}>
        <div className="bx-cardhead" style={{ marginBottom: 10 }}>
          <h3>{mode === 'create' ? 'Create login' : 'Reset password'} — {tech.name}</h3>
          <button className="bx-iconbtn" onClick={onClose} title="Close" style={{ marginLeft: 'auto' }}>✕</button>
        </div>

        {done ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="bx-note" style={{ fontSize: 13 }}>
              {mode === 'create' ? 'Login created.' : 'Password reset.'} Share these once — the tech must change the password on first sign-in.
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.9, background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 6 }}>
              {done.username && <div>Username: <b>{done.username}</b></div>}
              {done.email && <div>Email: <b>{done.email}</b></div>}
              <div>Temp password: <b>{done.password}</b></div>
            </div>
            <button className="bx-btn accent" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mode === 'create' && (<>
              <div><label className="bx-lbl">Email</label>
                <input className="bx-f" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tech@example.com" style={{ width: '100%' }} /></div>
              <div><label className="bx-lbl">Username</label>
                <input className="bx-f" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="jrocha" style={{ width: '100%' }} />
                <div className="bx-sub" style={{ marginTop: 4 }}>Lowercase letters, numbers, underscore (3–20). They can sign in with this or their email.</div></div>
              <div>
                <label className="bx-lbl">Access</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className={`bx-btn ${!hybrid ? 'accent' : 'ghost'} sm`} onClick={() => setHybrid(false)}>Field only</button>
                  <button type="button" className={`bx-btn ${hybrid ? 'accent' : 'ghost'} sm`} onClick={() => setHybrid(true)}>Field + desktop (admin)</button>
                </div>
                <div className="bx-sub" style={{ marginTop: 4 }}>{hybrid ? 'Also gets full desktop access (dashboard + billing/dispatch) and lands there, with a switch to the field app.' : 'Field app only (mobile time capture).'}</div>
              </div>
            </>)}
            <div>
              <label className="bx-lbl">Temporary password</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="bx-f" value={password} onChange={(e) => setPassword(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="bx-btn ghost sm" onClick={() => setPassword(genPassword())}>Generate</button>
              </div>
              <div className="bx-sub" style={{ marginTop: 4 }}>Shown once. The tech is required to change it on first login.</div>
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="bx-btn accent" onClick={submit} disabled={busy}>{busy ? 'Working…' : (mode === 'create' ? 'Create login' : 'Reset password')}</button>
              <button className="bx-btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const thBase: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--dim)', fontWeight: 600, padding: '4px 8px' }
const thL: React.CSSProperties = { ...thBase, textAlign: 'left' }
const thR: React.CSSProperties = { ...thBase, textAlign: 'right' }
const tdL: React.CSSProperties = { padding: '10px 8px', fontSize: 13, textAlign: 'left' }
const tdR: React.CSSProperties = { padding: '10px 8px', fontSize: 13, textAlign: 'right' }
