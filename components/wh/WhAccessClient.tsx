'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Combobox from '@/components/billing/Combobox'
import { useAlert, useConfirm } from '@/components/ui/DialogProvider'

/**
 * Who can see Western Highways (admin only).
 *
 * The list IS the permission: a person on it can open /wh and upload the QBO reports, and a
 * person off it cannot, whatever role they hold. Everything here goes through /api/wh/access,
 * which re-checks that the caller is an admin on every method — this screen hiding a button is
 * never the thing that stops a write.
 *
 * Styled the way the rest of the WH section is (inline styles over the dashboards' CSS
 * variables) rather than with the CMR tokens, since it sits in the admin area of the dashboards
 * interface.
 */

interface Grant {
  userId: string
  displayName: string
  username: string | null
  email: string
  role: string
  isActive: boolean
  grantedAt: string
  grantedByName: string
}
interface Candidate { id: string; displayName: string; username: string | null; email: string; role: string }

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

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', executive: 'Executive', district_manager: 'District Manager',
  branch_manager: 'Branch Manager', ar_manager: 'AR Manager', ar_team: 'AR Team',
  office_team: 'Office Team', project_manager: 'Project Manager', sales: 'Sales', tech: 'Tech',
  billing_branch_manager: 'Billing Manager', dispatcher: 'Dispatcher', biller: 'Biller',
  accounting: 'Accounting', front_counter: 'Front Counter',
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })

const card = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
} as const

const btn = {
  padding: '8px 14px',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
} as const

export default function WhAccessClient({ currentUserId }: { currentUserId: string }) {
  const confirm = useConfirm()
  const alert = useAlert()

  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newUser, setNewUser] = useState('')
  const [adding, setAdding] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    const r = await api<{ grants: Grant[]; candidates: Candidate[] }>('/api/wh/access')
    if (!r.success) {
      // An admin who lost the role mid-session shouldn't sit on a dead screen.
      if (r.code === 'FORBIDDEN' || r.code === 'UNAUTHORIZED') { window.location.href = '/dashboard'; return }
      setLoadError(r.error)
      return
    }
    setLoadError(null)
    setGrants(r.data.grants)
    setCandidates(r.data.candidates)
  }, [])

  useEffect(() => { void load() }, [load])

  const options = useMemo(
    () => candidates.map((c) => ({
      value: c.id,
      label: c.displayName || c.email || c.username || 'Unnamed user',
      hint: [ROLE_LABEL[c.role] ?? c.role, c.email || c.username || ''].filter(Boolean).join(' · '),
    })),
    [candidates],
  )

  async function addGrant(e: React.FormEvent) {
    e.preventDefault()
    if (!newUser) { await alert('Choose a person to add.'); return }
    const person = candidates.find((c) => c.id === newUser)
    setAdding(true)
    const r = await api<{ userId: string }>('/api/wh/access', { method: 'POST', body: JSON.stringify({ userId: newUser }) })
    setAdding(false)
    if (!r.success) { await alert({ title: 'Could not add access', message: r.error }); return }
    setNewUser('')
    setStatus(`${person?.displayName ?? 'That person'} can now see Western Highways.`)
    await load()
  }

  async function revoke(g: Grant) {
    const self = g.userId === currentUserId
    const ok = await confirm({
      title: self ? 'Remove your own access?' : `Remove ${g.displayName || 'this person'}?`,
      message: self
        ? 'You will lose access to Western Highways immediately. You can add yourself back from this screen — managing the list is an admin right, not a Western Highways one.'
        : `${g.displayName || 'This person'} will lose access to Western Highways right away, including the report uploads.`,
      confirmLabel: 'Remove access',
      danger: true,
    })
    if (!ok) return
    setBusyId(g.userId)
    const r = await api<{ userId: string }>(`/api/wh/access?userId=${encodeURIComponent(g.userId)}`, { method: 'DELETE' })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not remove access', message: r.error }); return }
    setStatus(`${g.displayName || 'That person'} no longer has access to Western Highways.`)
    await load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      <header>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Who can see Western Highways</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Only the people listed here can open Western Highways and upload its A/R and A/P
          reports. Admin or executive rights elsewhere don&rsquo;t carry over — this list is the
          whole rule. Managing it is an admin right, so you can edit it whether or not you&rsquo;re
          on it.
        </p>
      </header>

      <p aria-live="polite" role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{status}</p>

      <section style={card} aria-labelledby="wh-add-title">
        <h2 id="wh-add-title" style={{ fontSize: 13, marginBottom: 12 }}>Add a person</h2>
        <form onSubmit={addGrant} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <Combobox
              value={newUser}
              onChange={setNewUser}
              options={options}
              placeholder={grants === null ? 'Loading people…' : options.length ? 'Search by name, role or email…' : 'Everyone already has access'}
              disabled={grants === null || options.length === 0}
              ariaLabel="Person to give Western Highways access"
            />
          </div>
          <button
            type="submit"
            disabled={adding || !newUser}
            style={{ ...btn, background: newUser && !adding ? '#ff6b00' : 'var(--bg-base)', color: newUser && !adding ? '#fff' : 'var(--text-muted)', borderColor: newUser && !adding ? '#ff6b00' : 'var(--border)' }}
          >
            {adding ? 'Adding…' : 'Add access'}
          </button>
        </form>
      </section>

      <section aria-labelledby="wh-grants-title">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <h2 id="wh-grants-title" style={{ fontSize: 13 }}>People with access</h2>
          {grants && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {grants.length} {grants.length === 1 ? 'person' : 'people'}
            </span>
          )}
        </div>

        {loadError && (
          <div role="alert" style={{ ...card, borderColor: 'var(--danger, #d33)', display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <span style={{ flex: 1, fontSize: 13 }}>{loadError}</span>
            <button type="button" style={btn} onClick={() => void load()}>Retry</button>
          </div>
        )}

        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {grants === null && !loadError && (
            <div aria-busy="true" aria-label="Loading the access list" style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
              Loading…
            </div>
          )}

          {grants && grants.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
              No one has access to Western Highways yet.
            </div>
          )}

          {grants && grants.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {grants.map((g, i) => {
                const self = g.userId === currentUserId
                const busy = busyId === g.userId
                return (
                  <li
                    key={g.userId}
                    aria-busy={busy || undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 29, height: 29, borderRadius: '50%', flexShrink: 0,
                        display: 'grid', placeItems: 'center', fontSize: 11,
                        background: 'var(--bg-base)', border: '1px solid var(--border)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {initials(g.displayName)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {g.displayName || 'Unnamed user'}
                        {self && <span style={{ fontSize: 10, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>You</span>}
                        {!g.isActive && <span style={{ fontSize: 10, color: 'var(--danger, #d33)', border: '1px solid var(--danger, #d33)', borderRadius: 4, padding: '1px 5px' }}>Deactivated</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ROLE_LABEL[g.role] ?? g.role}
                        {' · '}{g.email || g.username || '—'}
                        {' · added '}{dateFmt.format(new Date(g.grantedAt))}
                        {g.grantedByName ? ` by ${g.grantedByName}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revoke(g)}
                      disabled={busy}
                      aria-label={`Remove Western Highways access for ${g.displayName || 'this person'}`}
                      style={{ ...btn, padding: '6px 10px', fontSize: 12, color: 'var(--danger, #d33)', borderColor: 'var(--danger, #d33)' }}
                    >
                      Remove
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
