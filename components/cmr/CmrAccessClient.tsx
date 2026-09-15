'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Select from '@/components/billing/Select'
import Combobox from '@/components/billing/Combobox'
import CmrIcon from '@/components/cmr/CmrIcon'
import { useAlert, useConfirm } from '@/components/ui/DialogProvider'
import { CMR_ROLES, CMR_ROLE_DESCRIPTION, CMR_ROLE_LABEL, type CmrRole } from '@/lib/cmr/roles'

/**
 * Access admin (Controller only). Lists who can open Cash Ledger, adds people, changes roles,
 * revokes. All writes go through /api/cmr/access, which re-checks the Controller role.
 */

interface Grant {
  userId: string
  displayName: string
  username: string | null
  email: string
  isActive: boolean
  role: CmrRole
  createdAt: string
  createdByName: string
}
interface Candidate { id: string; displayName: string; username: string | null; email: string }

type ApiResult<T> = { success: true; data: T } | { success: false; error: string; code?: string }

async function api<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(input, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
    const json = (await res.json().catch(() => null)) as ApiResult<T> | null
    if (json) return json
    return { success: false, error: `Request failed (${res.status}).` }
  } catch {
    return { success: false, error: 'Network error — check your connection and try again.' }
  }
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return ((p[0][0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })

export default function CmrAccessClient({ currentUserId }: { currentUserId: string }) {
  const confirm = useConfirm()
  const alert = useAlert()

  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [newUser, setNewUser] = useState('')
  const [newRole, setNewRole] = useState<CmrRole>('requester')
  const [adding, setAdding] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    const r = await api<{ grants: Grant[]; candidates: Candidate[] }>('/api/cmr/access')
    if (!r.success) {
      if (r.code === 'FORBIDDEN' || r.code === 'UNAUTHORIZED') { window.location.href = '/cmr'; return }
      setLoadError(r.error)
      return
    }
    setLoadError(null)
    setGrants(r.data.grants)
    setCandidates(r.data.candidates)
  }, [])

  useEffect(() => { void load() }, [load])

  const controllerCount = useMemo(() => (grants ?? []).filter((g) => g.role === 'controller').length, [grants])
  const options = useMemo(
    () => candidates.map((c) => ({ value: c.id, label: c.displayName || c.email || c.username || 'Unnamed user', hint: c.email || c.username || '' })),
    [candidates],
  )

  async function addGrant(e: React.FormEvent) {
    e.preventDefault()
    if (!newUser) { await alert('Choose a person to add.'); return }
    const person = candidates.find((c) => c.id === newUser)
    setAdding(true)
    const r = await api<{ userId: string }>('/api/cmr/access', { method: 'POST', body: JSON.stringify({ userId: newUser, role: newRole }) })
    setAdding(false)
    if (!r.success) { await alert({ title: 'Could not add access', message: r.error }); return }
    setNewUser('')
    setStatus(`${person?.displayName ?? 'User'} added as ${CMR_ROLE_LABEL[newRole]}.`)
    await load()
  }

  async function changeRole(g: Grant, role: CmrRole) {
    if (role === g.role) return
    const self = g.userId === currentUserId
    if (self && g.role === 'controller') {
      const ok = await confirm({
        title: 'Change your own role?',
        message: `You'll become a ${CMR_ROLE_LABEL[role]} and lose access to this screen.`,
        confirmLabel: 'Change my role',
        danger: true,
      })
      if (!ok) return
    }
    setBusyId(g.userId)
    const r = await api<{ userId: string }>('/api/cmr/access', { method: 'POST', body: JSON.stringify({ userId: g.userId, role }) })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not change role', message: r.error }); return }
    if (self && role !== 'controller') { window.location.href = '/cmr'; return }
    setStatus(`${g.displayName} is now a ${CMR_ROLE_LABEL[role]}.`)
    await load()
  }

  async function revoke(g: Grant) {
    const self = g.userId === currentUserId
    const ok = await confirm({
      title: self ? 'Remove your own access?' : `Remove ${g.displayName}?`,
      message: self
        ? 'You will be signed out of Cash Ledger immediately and will need another Controller to add you back.'
        : `${g.displayName} will lose all access to Cash Ledger right away.`,
      confirmLabel: 'Remove access',
      danger: true,
    })
    if (!ok) return
    setBusyId(g.userId)
    const r = await api<{ userId: string }>(`/api/cmr/access?userId=${encodeURIComponent(g.userId)}`, { method: 'DELETE' })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not remove access', message: r.error }); return }
    if (self) { window.location.href = '/cmr/no-access'; return }
    setStatus(`${g.displayName}'s access was removed.`)
    await load()
  }

  return (
    <>
      <header className="cmr-pagehead">
        <div>
          <h1 className="cmr-serif">Access</h1>
          <p>Only the people listed here can open Cash Ledger. Admin rights elsewhere don&rsquo;t carry over.</p>
        </div>
      </header>

      <p className="cmr-sr-only" role="status" aria-live="polite">{status}</p>

      <section className="cmr-sec" aria-labelledby="cmr-add-title">
        <div className="cmr-sh"><h2 id="cmr-add-title">Add a person</h2></div>
        <div className="cmr-card">
          <form className="cmr-grant-form" onSubmit={addGrant}>
            <div className="cmr-field">
              <span className="cmr-label" id="cmr-add-user-label">Person</span>
              <Combobox
                value={newUser}
                onChange={setNewUser}
                options={options}
                placeholder={grants === null ? 'Loading people…' : options.length ? 'Search by name or email…' : 'Everyone already has access'}
                disabled={grants === null || options.length === 0}
                ariaLabel="Person to add"
              />
            </div>
            <label className="cmr-field">
              <span className="cmr-label">Role</span>
              <Select value={newRole} onChange={(v) => setNewRole(v as CmrRole)} ariaLabel="Role for the new person">
                {CMR_ROLES.map((r) => <option key={r} value={r}>{CMR_ROLE_LABEL[r]}</option>)}
              </Select>
            </label>
            <button type="submit" className="cmr-btn" disabled={adding || !newUser}>
              <CmrIcon name="plus" /> {adding ? 'Adding…' : 'Add access'}
            </button>
          </form>
          <div className="cmr-roles">
            {CMR_ROLES.map((r) => (
              <div key={r}>
                <span className={`cmr-pill ${r}`}>{CMR_ROLE_LABEL[r]}</span>
                <p>{CMR_ROLE_DESCRIPTION[r]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cmr-sec" aria-labelledby="cmr-grants-title">
        <div className="cmr-sh">
          <h2 id="cmr-grants-title">People with access</h2>
          {grants && <span className="c">{grants.length} {grants.length === 1 ? 'person' : 'people'}</span>}
        </div>

        {loadError && (
          <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
            <span style={{ flex: 1 }}>{loadError}</span>
            <button type="button" className="cmr-btn sm ghost" onClick={() => void load()}>Retry</button>
          </div>
        )}

        <div className="cmr-card">
          {grants === null && !loadError && (
            <div aria-busy="true" aria-label="Loading access list">
              {[0, 1, 2].map((i) => (
                <div className="cmr-row" key={i}>
                  <span className="cmr-skel" style={{ width: 29, height: 29, borderRadius: '50%' }} />
                  <span className="cmr-skel" style={{ width: '40%', height: 12 }} />
                  <span className="cmr-skel" style={{ width: 120, height: 28, marginLeft: 'auto' }} />
                </div>
              ))}
            </div>
          )}

          {grants && grants.length === 0 && (
            <div className="cmr-empty"><p>No one has access yet.</p></div>
          )}

          {grants && grants.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {grants.map((g) => {
                const self = g.userId === currentUserId
                const lastController = g.role === 'controller' && controllerCount <= 1
                const busy = busyId === g.userId
                return (
                  <li className="cmr-row cmr-grant-row" key={g.userId} aria-busy={busy || undefined}>
                    <span className="cmr-avatar" aria-hidden="true">{initials(g.displayName)}</span>
                    <div className="who">
                      <span className="desc">
                        {g.displayName || 'Unnamed user'}
                        {self && <span className="you">You</span>}
                        {!g.isActive && <span className="cmr-pill danger" style={{ marginLeft: 8 }}>Deactivated</span>}
                      </span>
                      <span className="mt">
                        {g.email || g.username || '—'}
                        {' · added '}{dateFmt.format(new Date(g.createdAt))}
                        {g.createdByName ? ` by ${g.createdByName}` : ''}
                      </span>
                    </div>
                    <div className="role">
                      <Select
                        value={g.role}
                        onChange={(v) => void changeRole(g, v as CmrRole)}
                        disabled={busy || lastController}
                        ariaLabel={`Role for ${g.displayName || 'this user'}`}
                      >
                        {CMR_ROLES.map((r) => <option key={r} value={r}>{CMR_ROLE_LABEL[r]}</option>)}
                      </Select>
                    </div>
                    {lastController ? (
                      <span className="rowact-spacer" aria-hidden="true" />
                    ) : (
                      <button
                        type="button"
                        className="cmr-btn sm danger rowact"
                        onClick={() => void revoke(g)}
                        disabled={busy}
                        aria-label={`Remove access for ${g.displayName || 'this user'}`}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {grants && controllerCount <= 1 && (
          <p className="cmr-hint">The only Controller can&rsquo;t be removed or changed — add another Controller first.</p>
        )}
      </section>
    </>
  )
}
