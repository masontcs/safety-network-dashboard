'use client'

import { useState, useEffect, useCallback } from 'react'
import Skeleton from '@/components/ui/Skeleton'

interface Group {
  id: string
  name: string
  itemCount: number
  system: boolean
  bucket: 'Gross' | 'Fringes' | 'Other'
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

function bucketColor(bucket: Group['bucket']): string {
  if (bucket === 'Fringes') return 'var(--accent)'
  if (bucket === 'Other') return 'var(--warning, var(--accent))'
  return 'var(--text-dim)'
}

export default function PayrollGroupsCard() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/admin/payroll-item-groups')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setGroups(json.data.groups as Group[])
        setFetchError(null)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function addGroup() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch('/api/admin/payroll-item-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setNewName('')
      load()
    } catch {
      setActionError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function saveRename(id: string) {
    const name = editName.trim()
    if (!name || busy) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/payroll-item-groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setEditingId(null)
      load()
    } catch {
      setActionError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string, name: string) {
    if (busy) return
    if (!window.confirm(`Delete the group "${name}"? This can't be undone.`)) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/payroll-item-groups/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      load()
    } catch {
      setActionError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
        Payroll Item Groups
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
        Groups bucket payroll items for the payroll breakdown. <strong>Fringes</strong> and{' '}
        <strong>Other</strong> are system groups the report depends on; everything else rolls into{' '}
        <strong>Gross</strong> wages. Assign items to groups under Admin → Payroll Items.
      </div>

      {fetchError ? (
        <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={38} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map((g) => (
            <div
              key={g.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: 'var(--bg-nav)',
                border: '1px solid var(--border-subtle, var(--border-emphasis))',
                borderRadius: 8,
              }}
            >
              {editingId === g.id ? (
                <>
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(g.id); if (e.key === 'Escape') setEditingId(null) }}
                    style={{ ...inputStyle, maxWidth: 220 }}
                  />
                  <button onClick={() => saveRename(g.id)} disabled={busy} className="btn-primary" style={{ padding: '6px 14px', fontSize: 12 }}>Save</button>
                  <button onClick={() => setEditingId(null)} disabled={busy} style={{ ...ghostBtn }}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{g.name}</span>
                  <span style={{
                    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em',
                    color: bucketColor(g.bucket), border: `1px solid ${bucketColor(g.bucket)}`,
                    borderRadius: 4, padding: '1px 6px',
                  }}>{g.bucket}</span>
                  {g.system && (
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-dim)' }}>
                      🔒 system
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {g.itemCount} item{g.itemCount === 1 ? '' : 's'}
                  </span>
                  {!g.system && (
                    <>
                      <button
                        onClick={() => { setEditingId(g.id); setEditName(g.name); setActionError(null) }}
                        disabled={busy}
                        style={{ ...ghostBtn }}
                      >Rename</button>
                      <button
                        onClick={() => remove(g.id, g.name)}
                        disabled={busy || g.itemCount > 0}
                        title={g.itemCount > 0 ? 'Reassign its items before deleting' : 'Delete group'}
                        style={{ ...ghostBtn, color: g.itemCount > 0 ? 'var(--text-dim)' : 'var(--danger)', opacity: g.itemCount > 0 ? 0.5 : 1 }}
                      >Delete</button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}

          {actionError && (
            <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6 }}>
              {actionError}
            </div>
          )}

          {/* Add new group */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addGroup() }}
              placeholder="New group name"
              style={{ ...inputStyle, maxWidth: 220 }}
            />
            <button onClick={addGroup} disabled={busy || !newName.trim()} className="btn-primary" style={{ padding: '8px 18px', opacity: (busy || !newName.trim()) ? 0.5 : 1 }}>
              Add group
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
