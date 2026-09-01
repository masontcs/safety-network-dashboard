'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Manage BILLING users from inside the billing interface — admin + Billing Manager only.
 * Create / edit dispatcher, biller and billing-manager logins, scope them to branches, and
 * reset passwords, without leaving billing. Never touches admins or dashboard users.
 */

interface BUser { id: string; displayName: string; username: string | null; email: string; role: string; isActive: boolean; branchIds: string[] }
interface Branch { id: string; name: string }

const ROLE_LABEL: Record<string, string> = { billing_manager: 'Billing Manager', dispatcher: 'Dispatcher', biller: 'Biller' }
const ROLES = ['billing_manager', 'dispatcher', 'biller'] as const
const genPassword = () => 'Bill-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89) + '!'

const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)' }
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)', fontSize: 13 }

export default function BillingUsersClient() {
  const [users, setUsers] = useState<BUser[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; user: BUser } | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500) }
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/billing/users').then((r) => r.json()).then((j) => {
      if (!j.success) throw new Error(j.error)
      setUsers(j.data.users); setBranches(j.data.branches); setErr(null)
    }).catch((e: Error) => setErr(e.message)).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="bx-h1">Billing Users</h1>
          <div className="bx-sub">Dispatchers, billers and billing managers — scoped to their branches. They sign in and land in billing.</div>
        </div>
        <button className="bx-btn accent" onClick={() => setModal({ mode: 'create' })}>+ Add user</button>
      </div>

      {err && <div className="bx-note amber" style={{ marginTop: 12 }}>{err}</div>}

      <div className="card" style={{ marginTop: 14 }}>
        {loading ? <div className="bx-sub">Loading…</div> : users.length === 0 ? <div className="bx-sub">No billing users yet — add one.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Name', 'Login', 'Role', 'Branches', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.5 }}>
                  <td style={{ ...td, fontWeight: 500 }}>{u.displayName}</td>
                  <td style={td}>{u.username ? <b>{u.username}</b> : '—'}<span style={{ color: 'var(--text-muted)' }}>{u.email ? ` · ${u.email}` : ''}</span></td>
                  <td style={td}>{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{u.branchIds.map(branchName).join(', ') || '—'}</td>
                  <td style={td}>{u.isActive ? <span style={{ color: '#1a7a33', fontWeight: 600, fontSize: 11 }}>ACTIVE</span> : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>INACTIVE</span>}</td>
                  <td style={{ ...td, textAlign: 'right' }}><button className="bx-btn ghost sm" onClick={() => setModal({ mode: 'edit', user: u })}>Manage</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <UserModal
          mode={modal.mode}
          user={modal.mode === 'edit' ? modal.user : undefined}
          branches={branches}
          onClose={() => setModal(null)}
          onDone={(m) => { setModal(null); flash(m); load() }}
        />
      )}
      {toast && <div className="bx-toast">{toast}</div>}
    </div>
  )
}

function UserModal({ mode, user, branches, onClose, onDone }: {
  mode: 'create' | 'edit'; user?: BUser; branches: Branch[]
  onClose: () => void; onDone: (msg: string) => void
}) {
  const [name, setName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState(mode === 'create' ? genPassword() : '')
  const [role, setRole] = useState<string>(user?.role ?? 'dispatcher')
  const [branchIds, setBranchIds] = useState<string[]>(user?.branchIds ?? [])
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [created, setCreated] = useState<{ username: string; email: string; password: string } | null>(null)

  const toggleBranch = (id: string) => setBranchIds((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id])

  async function save() {
    if (busy) return
    setErr(null)
    if (mode === 'create') {
      if (!name.trim()) return setErr('Name is required.')
      if (!email.trim()) return setErr('Email is required.')
      if (!/^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase())) return setErr('Username must be 3–20 chars: lowercase letters, numbers, underscore.')
      if (password.length < 8) return setErr('Password must be at least 8 characters.')
    }
    if (branchIds.length === 0) return setErr('Assign at least one branch.')
    setBusy(true)
    try {
      if (mode === 'create') {
        const res = await fetch('/api/billing/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: name.trim(), email: email.trim(), username: username.trim().toLowerCase(), temporaryPassword: password, role, branchIds }) })
        const j = await res.json()
        if (!j.success) return setErr(j.error ?? 'Failed')
        setCreated({ username: username.trim().toLowerCase(), email: email.trim(), password })
      } else {
        const res = await fetch(`/api/billing/users/${user!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, branchIds, isActive }) })
        const j = await res.json()
        if (!j.success) return setErr(j.error ?? 'Failed')
        onDone('User updated.')
      }
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  async function resetPassword() {
    if (busy || !user) return
    const pwd = genPassword()
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/billing/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ temporaryPassword: pwd }) })
      const j = await res.json()
      if (!j.success) return setErr(j.error ?? 'Failed')
      setCreated({ username: user.username ?? '', email: user.email, password: pwd })
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px 16px' }}>
      <div onMouseDown={(e) => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 480, maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="bx-cardhead" style={{ marginBottom: 10 }}>
          <h3>{mode === 'create' ? 'Add billing user' : `Manage ${user!.displayName}`}</h3>
          <button className="bx-iconbtn" onClick={onClose} title="Close" style={{ marginLeft: 'auto' }}>✕</button>
        </div>

        {created ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="bx-note" style={{ fontSize: 13 }}>Share these once — they must change the password on first sign-in.</div>
            <div style={{ fontSize: 13, lineHeight: 1.9, background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 6 }}>
              {created.username && <div>Username: <b>{created.username}</b></div>}
              {created.email && <div>Email: <b>{created.email}</b></div>}
              <div>Temp password: <b>{created.password}</b></div>
            </div>
            <button className="bx-btn accent" onClick={() => onDone(mode === 'create' ? 'User created.' : 'Password reset.')}>Done</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mode === 'create' && (<>
              <div><label className="bx-lbl">Name</label><input className="bx-f" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Ramirez" /></div>
              <div><label className="bx-lbl">Email</label><input className="bx-f" type="email" style={{ width: '100%' }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" /></div>
              <div><label className="bx-lbl">Username</label><input className="bx-f" style={{ width: '100%' }} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="jramirez" /></div>
              <div><label className="bx-lbl">Temporary password</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="bx-f" style={{ flex: 1 }} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="bx-btn ghost sm" onClick={() => setPassword(genPassword())}>Generate</button>
                </div>
              </div>
            </>)}

            <div><label className="bx-lbl">Role</label>
              <select className="bx-f bx-select" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%' }}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>

            <div><label className="bx-lbl">Branches</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {branches.map((b) => (
                  <button key={b.id} type="button" className={`bx-btn ${branchIds.includes(b.id) ? 'accent' : 'ghost'} sm`} onClick={() => toggleBranch(b.id)}>{b.name}</button>
                ))}
                {branches.length === 0 && <div className="bx-sub">No assignable branches.</div>}
              </div>
            </div>

            {mode === 'edit' && (
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <label className="bx-lbl">Status</label>
                  <button type="button" className={`bx-btn ${isActive ? 'accent' : 'ghost'} sm`} onClick={() => setIsActive((v) => !v)}>{isActive ? 'Active' : 'Inactive'}</button>
                </div>
                <div>
                  <label className="bx-lbl">Password</label>
                  <button type="button" className="bx-btn ghost sm" onClick={resetPassword} disabled={busy}>Reset password</button>
                </div>
              </div>
            )}

            {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="bx-btn accent" onClick={save} disabled={busy}>{busy ? 'Working…' : (mode === 'create' ? 'Create user' : 'Save')}</button>
              <button className="bx-btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
