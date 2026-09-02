'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Manage BILLING users from inside the billing interface.
 *
 * Two ways to be a billing user:
 *   - NATIVE  — an account created here whose whole job is billing (role IS a billing role).
 *   - GRANTED — an existing dashboard or tech user who was given billing access on top of what
 *     they already do (a layered billing_role). Granting is ADMIN ONLY; it never duplicates the
 *     person and never disturbs their existing role.
 *
 * Admin + Billing Manager manage native users. Only admins add/grant existing users or manage a
 * granted user (they're shared accounts).
 */

interface BUser {
  id: string; displayName: string; username: string | null; email: string
  baseRole: string; billingRole: string | null; source: 'native' | 'granted'
  isActive: boolean; branchIds: string[]
}
interface Candidate { id: string; displayName: string; username: string | null; email: string; baseRole: string; isField: boolean; branchIds: string[] }
interface Branch { id: string; name: string }

const ROLE_LABEL: Record<string, string> = { billing_manager: 'Billing Manager', dispatcher: 'Dispatcher', biller: 'Biller' }
const BASE_ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', executive: 'Executive', district_manager: 'District Manager', branch_manager: 'Branch Manager',
  ar_manager: 'AR Manager', ar_team: 'AR Team', office_team: 'Office', project_manager: 'Project Manager',
  sales: 'Sales', tech: 'Technician', billing_manager: 'Billing Manager', dispatcher: 'Dispatcher', biller: 'Biller',
}
const ROLES = ['billing_manager', 'dispatcher', 'biller'] as const
const genPassword = () => 'Bill-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89) + '!'

const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)' }
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)', fontSize: 13 }

type Modal =
  | { mode: 'create' }
  | { mode: 'edit'; user: BUser }
  | { mode: 'addExisting' }
  | null

export default function BillingUsersClient() {
  const [users, setUsers] = useState<BUser[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<Modal>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500) }
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/billing/users').then((r) => r.json()).then((j) => {
      if (!j.success) throw new Error(j.error)
      setUsers(j.data.users); setBranches(j.data.branches); setIsAdmin(!!j.data.isAdmin); setErr(null)
    }).catch((e: Error) => setErr(e.message)).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="bx-h1">Billing Users</h1>
          <div className="bx-sub">Everyone with billing access — dispatchers, billers and billing managers, plus dashboard or field people who’ve been granted billing. All scoped to their branches.</div>
        </div>
        {isAdmin && <button className="bx-btn ghost" onClick={() => setModal({ mode: 'addExisting' })}>+ Add existing user</button>}
        <button className="bx-btn accent" onClick={() => setModal({ mode: 'create' })}>+ New account</button>
      </div>

      {err && <div className="bx-note amber" style={{ marginTop: 12 }}>{err}</div>}

      <div className="card" style={{ marginTop: 14 }}>
        {loading ? <div className="bx-sub">Loading…</div> : users.length === 0 ? <div className="bx-sub">No billing users yet — add one.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Name', 'Login', 'Billing role', 'Branches', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => {
                // Only admins may open a granted user (shared account); native users open for admin + BM.
                const canManage = u.source === 'native' || isAdmin
                return (
                  <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.5 }}>
                    <td style={{ ...td, fontWeight: 500 }}>
                      {u.displayName}
                      {u.source === 'granted' && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{BASE_ROLE_LABEL[u.baseRole] ?? u.baseRole} · also billing</div>
                      )}
                    </td>
                    <td style={td}>{u.username ? <b>{u.username}</b> : '—'}<span style={{ color: 'var(--text-muted)' }}>{u.email ? ` · ${u.email}` : ''}</span></td>
                    <td style={td}>
                      {u.billingRole ? (ROLE_LABEL[u.billingRole] ?? u.billingRole) : '—'}
                      {u.source === 'granted' && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '1px 4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>granted</span>}
                    </td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>{u.branchIds.map(branchName).join(', ') || '—'}</td>
                    <td style={td}>{u.isActive ? <span style={{ color: '#1a7a33', fontWeight: 600, fontSize: 11 }}>ACTIVE</span> : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>INACTIVE</span>}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{canManage
                      ? <button className="bx-btn ghost sm" onClick={() => setModal({ mode: 'edit', user: u })}>Manage</button>
                      : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Admin only</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal?.mode === 'addExisting' && (
        <AddExistingModal branches={branches} onClose={() => setModal(null)} onDone={(m) => { setModal(null); flash(m); load() }} />
      )}
      {(modal?.mode === 'create' || modal?.mode === 'edit') && (
        <UserModal
          mode={modal.mode}
          user={modal.mode === 'edit' ? modal.user : undefined}
          isAdmin={isAdmin}
          branches={branches}
          onClose={() => setModal(null)}
          onDone={(m) => { setModal(null); flash(m); load() }}
        />
      )}
      {toast && <div className="bx-toast">{toast}</div>}
    </div>
  )
}

/* ─── Add an EXISTING dashboard/tech user as a billing user (admin only) ─────────────── */
function AddExistingModal({ branches, onClose, onDone }: { branches: Branch[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Candidate | null>(null)
  const [role, setRole] = useState<string>('biller')
  const [branchIds, setBranchIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/billing/users/grant').then((r) => r.json()).then((j) => {
      if (!j.success) throw new Error(j.error)
      setCandidates(j.data.candidates)
    }).catch((e: Error) => setErr(e.message)).finally(() => setLoading(false))
  }, [])

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id
  const toggleBranch = (id: string) => setBranchIds((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id])
  const needsBranches = picked != null && picked.branchIds.length === 0
  const filtered = candidates.filter((c) => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return c.displayName.toLowerCase().includes(s) || (c.username ?? '').toLowerCase().includes(s) || c.email.toLowerCase().includes(s)
  })

  async function grant() {
    if (busy || !picked) return
    setErr(null)
    if (needsBranches && branchIds.length === 0) return setErr('Choose at least one branch for their billing scope.')
    setBusy(true)
    try {
      const res = await fetch('/api/billing/users/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: picked.id, billingRole: role, branchIds: needsBranches ? branchIds : undefined }) })
      const j = await res.json()
      if (!j.success) return setErr(j.error ?? 'Failed')
      onDone(`${picked.displayName} now has billing access.`)
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px 16px' }}>
      <div onMouseDown={(e) => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 520, maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="bx-cardhead" style={{ marginBottom: 10 }}>
          <h3>Add existing user to billing</h3>
          <button className="bx-iconbtn" onClick={onClose} title="Close" style={{ marginLeft: 'auto' }}>✕</button>
        </div>

        {!picked ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="bx-sub">Grant billing access to someone who already has a dashboard or field account — no new login, they keep everything they already do.</div>
            <input className="bx-f" style={{ width: '100%' }} placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
            {loading ? <div className="bx-sub">Loading…</div> : err ? <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div> : filtered.length === 0 ? (
              <div className="bx-sub">No matching people who can be granted billing. (Admins and existing billing users are excluded.)</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
                {filtered.map((c) => (
                  <button key={c.id} type="button" className="bx-btn ghost" style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '8px 10px' }}
                    onClick={() => { setPicked(c); setBranchIds(c.branchIds) }}>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <b style={{ fontSize: 13 }}>{c.displayName}</b>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {BASE_ROLE_LABEL[c.baseRole] ?? c.baseRole}{c.isField ? ' · field' : ''}{c.username ? ` · ${c.username}` : ''}{c.email ? ` · ${c.email}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 6 }}>
              <b>{picked.displayName}</b>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{BASE_ROLE_LABEL[picked.baseRole] ?? picked.baseRole}{picked.username ? ` · ${picked.username}` : ''}</div>
              <button type="button" className="bx-btn ghost sm" style={{ marginTop: 8 }} onClick={() => setPicked(null)}>← Choose someone else</button>
            </div>

            <div><label className="bx-lbl">Billing role</label>
              <select className="bx-f bx-select" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%' }}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>

            {needsBranches ? (
              <div><label className="bx-lbl">Branches (billing scope)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {branches.map((b) => (
                    <button key={b.id} type="button" className={`bx-btn ${branchIds.includes(b.id) ? 'accent' : 'ghost'} sm`} onClick={() => toggleBranch(b.id)}>{b.name}</button>
                  ))}
                  {branches.length === 0 && <div className="bx-sub">No assignable branches.</div>}
                </div>
              </div>
            ) : (
              <div><label className="bx-lbl">Branches</label>
                <div className="bx-sub">Billing will use their account’s branches: {picked.branchIds.map(branchName).join(', ') || '—'}</div>
              </div>
            )}

            {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="bx-btn accent" onClick={grant} disabled={busy}>{busy ? 'Granting…' : 'Grant billing access'}</button>
              <button className="bx-btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Create native user, or manage an existing billing user (native or granted) ─────── */
function UserModal({ mode, user, isAdmin, branches, onClose, onDone }: {
  mode: 'create' | 'edit'; user?: BUser; isAdmin: boolean; branches: Branch[]
  onClose: () => void; onDone: (msg: string) => void
}) {
  const granted = mode === 'edit' && user!.source === 'granted'
  const [name] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [dName, setDName] = useState(name)
  const [password, setPassword] = useState(mode === 'create' ? genPassword() : '')
  const [role, setRole] = useState<string>(user?.billingRole ?? 'dispatcher')
  const [branchIds, setBranchIds] = useState<string[]>(user?.branchIds ?? [])
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [created, setCreated] = useState<{ username: string; email: string; password: string } | null>(null)

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id
  const toggleBranch = (id: string) => setBranchIds((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id])

  async function save() {
    if (busy) return
    setErr(null)
    if (mode === 'create') {
      if (!dName.trim()) return setErr('Name is required.')
      if (!email.trim()) return setErr('Email is required.')
      if (!/^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase())) return setErr('Username must be 3–20 chars: lowercase letters, numbers, underscore.')
      if (password.length < 8) return setErr('Password must be at least 8 characters.')
      if (branchIds.length === 0) return setErr('Assign at least one branch.')
    }
    if (mode === 'edit' && !granted && branchIds.length === 0) return setErr('Assign at least one branch.')
    setBusy(true)
    try {
      if (mode === 'create') {
        const res = await fetch('/api/billing/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: dName.trim(), email: email.trim(), username: username.trim().toLowerCase(), temporaryPassword: password, role, branchIds }) })
        const j = await res.json()
        if (!j.success) return setErr(j.error ?? 'Failed')
        setCreated({ username: username.trim().toLowerCase(), email: email.trim(), password })
      } else {
        // Native: send role + branches + active. Granted: only the billing role (branches/active
        // follow their account, enforced server-side).
        const payload = granted ? { role } : { role, branchIds, isActive }
        const res = await fetch(`/api/billing/users/${user!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
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

  async function revokeGrant() {
    if (busy || !user) return
    if (!confirm(`Remove billing access from ${user.displayName}? They keep their other access.`)) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/billing/users/grant', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id }) })
      const j = await res.json()
      if (!j.success) return setErr(j.error ?? 'Failed')
      onDone('Billing access removed.')
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  const heading = mode === 'create' ? 'New billing account' : `Manage ${user!.displayName}`

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px 16px' }}>
      <div onMouseDown={(e) => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 480, maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="bx-cardhead" style={{ marginBottom: 10 }}>
          <h3>{heading}</h3>
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
            {granted && (
              <div className="bx-note" style={{ fontSize: 12.5 }}>
                This person is a {BASE_ROLE_LABEL[user!.baseRole] ?? user!.baseRole} who was granted billing access. You’re changing only their billing role; their other access and branches are managed on their account.
              </div>
            )}

            {mode === 'create' && (<>
              <div><label className="bx-lbl">Name</label><input className="bx-f" style={{ width: '100%' }} value={dName} onChange={(e) => setDName(e.target.value)} placeholder="Jane Ramirez" /></div>
              <div><label className="bx-lbl">Email</label><input className="bx-f" type="email" style={{ width: '100%' }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" /></div>
              <div><label className="bx-lbl">Username</label><input className="bx-f" style={{ width: '100%' }} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="jramirez" /></div>
              <div><label className="bx-lbl">Temporary password</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="bx-f" style={{ flex: 1 }} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="bx-btn ghost sm" onClick={() => setPassword(genPassword())}>Generate</button>
                </div>
              </div>
            </>)}

            <div><label className="bx-lbl">Billing role</label>
              <select className="bx-f bx-select" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%' }}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>

            {granted ? (
              <div><label className="bx-lbl">Branches</label>
                <div className="bx-sub">Follows their account: {branchIds.map(branchName).join(', ') || '—'}</div>
              </div>
            ) : (
              <div><label className="bx-lbl">Branches</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {branches.map((b) => (
                    <button key={b.id} type="button" className={`bx-btn ${branchIds.includes(b.id) ? 'accent' : 'ghost'} sm`} onClick={() => toggleBranch(b.id)}>{b.name}</button>
                  ))}
                  {branches.length === 0 && <div className="bx-sub">No assignable branches.</div>}
                </div>
              </div>
            )}

            {mode === 'edit' && (
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                {!granted && (
                  <div>
                    <label className="bx-lbl">Status</label>
                    <button type="button" className={`bx-btn ${isActive ? 'accent' : 'ghost'} sm`} onClick={() => setIsActive((v) => !v)}>{isActive ? 'Active' : 'Inactive'}</button>
                  </div>
                )}
                <div>
                  <label className="bx-lbl">Password</label>
                  <button type="button" className="bx-btn ghost sm" onClick={resetPassword} disabled={busy}>Reset password</button>
                </div>
                {granted && isAdmin && (
                  <div>
                    <label className="bx-lbl">Billing access</label>
                    <button type="button" className="bx-btn ghost sm" onClick={revokeGrant} disabled={busy} style={{ color: 'var(--danger)' }}>Remove</button>
                  </div>
                )}
              </div>
            )}

            {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="bx-btn accent" onClick={save} disabled={busy}>{busy ? 'Working…' : (mode === 'create' ? 'Create account' : 'Save')}</button>
              <button className="bx-btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
