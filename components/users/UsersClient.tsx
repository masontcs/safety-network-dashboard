'use client'

import { useState, useEffect } from 'react'
import Skeleton from '@/components/ui/Skeleton'
import BranchMultiSelect, { type SelectableBranch } from '@/components/ui/BranchMultiSelect'
import type { Role } from '@/lib/supabase/database.types'

interface User {
  id: string
  displayName: string
  email: string
  role: Role
  branchIds: string[]
  isActive: boolean
  username: string | null
}

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/

const ROLE_LABELS: Record<Role, string> = {
  admin:            'Admin',
  executive:        'Executive',
  district_manager: 'District Manager',
  branch_manager:   'Branch Manager',
  ar_manager:       'AR Manager',
  ar_team:          'AR Team',
  office_team:      'Office Team',
  project_manager:  'Project Manager',
  sales:            'Sales',
}

const ROLE_COLORS: Record<Role, string> = {
  admin:            '#ff6b00',
  executive:        '#cccccc',
  district_manager: '#cccccc',
  branch_manager:   '#cccccc',
  ar_manager:       '#cccccc',
  ar_team:          '#cccccc',
  office_team:      '#cccccc',
  project_manager:  '#cccccc',
  sales:            '#cccccc',
}

const selectStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #333333',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
  color: '#cccccc',
  fontFamily: 'inherit',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#2a2a2a',
  border: '1px solid #333333',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  color: '#ffffff',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

function generatePassword(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const digits = '0123456789'
  const special = '!@#$%'
  const all = letters + digits + special
  let pwd = letters[Math.floor(Math.random() * letters.length)]
  pwd += digits[Math.floor(Math.random() * digits.length)]
  pwd += special[Math.floor(Math.random() * special.length)]
  for (let i = 3; i < 12; i++) pwd += all[Math.floor(Math.random() * all.length)]
  return pwd.split('').sort(() => Math.random() - 0.5).join('')
}

export default function UsersClient() {
  const [users, setUsers] = useState<User[]>([])
  const [branches, setBranches] = useState<SelectableBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Edit inline state
  const [editing, setEditing] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<Role>('branch_manager')
  const [editBranches, setEditBranches] = useState<string[]>([])
  const [editUsername, setEditUsername] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset password modal state
  const [resetUserId, setResetUserId] = useState<string | null>(null)
  const [resetUserName, setResetUserName] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetCopied, setResetCopied] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState(false)

  // Test accounts state
  type TestAccount = { email: string; displayName: string; role: string; exists: boolean }
  const [testAccounts, setTestAccounts] = useState<TestAccount[]>([])
  const [testLoading, setTestLoading] = useState(true)
  const [testCreating, setTestCreating] = useState(false)
  const [testDeleting, setTestDeleting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Create modal state
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createUsername, setCreateUsername] = useState('')
  const [createRole, setCreateRole] = useState<Role>('branch_manager')
  const [createBranches, setCreateBranches] = useState<string[]>([])
  const [createPassword, setCreatePassword] = useState('')
  const [createConfirm, setCreateConfirm] = useState('')
  const [createCopied, setCreateCopied] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const branchMap = Object.fromEntries(branches.map((b) => [b.id, b.name]))
  const needsBranchScope = (role: Role) =>
    role === 'district_manager' || role === 'branch_manager' || role === 'project_manager' || role === 'sales'

  useEffect(() => {
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setUsers(json.data.users)
        setBranches(json.data.branches)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/admin/test-accounts')
      .then((r) => r.json())
      .then((json) => { if (json.success) setTestAccounts(json.data.accounts) })
      .catch(() => {})
      .finally(() => setTestLoading(false))
  }, [])

  async function handleCreateTestAccounts() {
    setTestCreating(true)
    setTestMsg(null)
    try {
      const res = await fetch('/api/admin/test-accounts', { method: 'POST' })
      const json = await res.json()
      if (!json.success) { setTestMsg({ type: 'error', text: json.error }); return }
      const { created, skipped } = json.data as { created: string[]; skipped: string[] }
      const parts = []
      if (created.length) parts.push(`Created: ${created.length}`)
      if (skipped.length) parts.push(`Already existed: ${skipped.length}`)
      setTestMsg({ type: 'success', text: parts.join(' · ') || 'Done' })
      const refresh = await fetch('/api/admin/test-accounts').then((r) => r.json())
      if (refresh.success) setTestAccounts(refresh.data.accounts)
      const usersRefresh = await fetch('/api/admin/users').then((r) => r.json())
      if (usersRefresh.success) setUsers(usersRefresh.data.users)
    } catch {
      setTestMsg({ type: 'error', text: 'Network error — please try again.' })
    } finally {
      setTestCreating(false)
    }
  }

  async function handleDeleteTestAccounts() {
    if (!confirm('Delete all three test accounts? This cannot be undone.')) return
    setTestDeleting(true)
    setTestMsg(null)
    try {
      const res = await fetch('/api/admin/test-accounts', { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) { setTestMsg({ type: 'error', text: json.error }); return }
      setTestMsg({ type: 'success', text: `Deleted ${json.data.deleted.length} account(s).` })
      const refresh = await fetch('/api/admin/test-accounts').then((r) => r.json())
      if (refresh.success) setTestAccounts(refresh.data.accounts)
      const usersRefresh = await fetch('/api/admin/users').then((r) => r.json())
      if (usersRefresh.success) setUsers(usersRefresh.data.users)
    } catch {
      setTestMsg({ type: 'error', text: 'Network error — please try again.' })
    } finally {
      setTestDeleting(false)
    }
  }

  // ── Edit handlers ──────────────────────────────────────────────────────────

  function startEdit(user: User) {
    setEditing(user.id)
    setEditRole(user.role)
    setEditBranches(user.branchIds)
    setEditUsername(user.username ?? '')
  }

  function cancelEdit() {
    setEditing(null)
  }

  async function saveEdit(userId: string) {
    const uname = editUsername.trim().toLowerCase()
    if (uname && !USERNAME_REGEX.test(uname)) {
      alert('Username must be 3–20 characters: lowercase letters, numbers, underscores only.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: editRole, branchIds: editBranches, username: uname || null }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setUsers((prev) =>
        prev.map((u) => u.id === userId ? { ...u, role: editRole, branchIds: editBranches, username: uname || null } : u),
      )
      setEditing(null)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Active toggle ─────────────────────────────────────────────────────────

  async function handleToggleActive(userId: string, nextActive: boolean) {
    // Optimistic update
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isActive: nextActive } : u))
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) {
        setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isActive: !nextActive } : u))
        alert(json.error ?? 'Failed to update user')
      }
    } catch {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isActive: !nextActive } : u))
      alert('Network error — please try again')
    }
  }

  // ── Reset password handlers ────────────────────────────────────────────────

  function openReset(user: User) {
    setResetUserId(user.id)
    setResetUserName(user.displayName || user.email)
    setResetPassword('')
    setResetConfirm('')
    setResetCopied(false)
    setResetting(false)
    setResetError(null)
    setResetSuccess(false)
  }

  function closeReset() {
    setResetUserId(null)
    setResetError(null)
    setResetSuccess(false)
  }

  function handleGenerateReset() {
    const pwd = generatePassword()
    setResetPassword(pwd)
    setResetConfirm(pwd)
    setResetCopied(false)
  }

  async function handleCopyReset() {
    await navigator.clipboard.writeText(resetPassword)
    setResetCopied(true)
    setTimeout(() => setResetCopied(false), 2000)
  }

  async function handleReset() {
    if (resetPassword.length < 8) { setResetError('Password must be at least 8 characters.'); return }
    if (resetPassword !== resetConfirm) { setResetError('Passwords do not match.'); return }

    setResetting(true)
    setResetError(null)
    try {
      const res = await fetch(`/api/admin/users/${resetUserId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temporaryPassword: resetPassword }),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) { setResetError(json.error ?? 'Unknown error'); return }
      setResetSuccess(true)
    } catch {
      setResetError('Network error — please try again.')
    } finally {
      setResetting(false)
    }
  }

  // ── Create handlers ────────────────────────────────────────────────────────

  function openCreate() {
    setCreateName('')
    setCreateEmail('')
    setCreateUsername('')
    setCreateRole('branch_manager')
    setCreateBranches([])
    setCreatePassword('')
    setCreateConfirm('')
    setCreateCopied(false)
    setCreateError(null)
    setShowCreate(true)
  }

  function closeCreate() {
    setShowCreate(false)
    setCreateError(null)
  }

  function handleGenerateCreate() {
    const pwd = generatePassword()
    setCreatePassword(pwd)
    setCreateConfirm(pwd)
    setCreateCopied(false)
  }

  async function handleCopyCreate() {
    await navigator.clipboard.writeText(createPassword)
    setCreateCopied(true)
    setTimeout(() => setCreateCopied(false), 2000)
  }

  async function handleCreate() {
    if (!createName.trim()) { setCreateError('Display name is required.'); return }
    if (!createEmail.trim()) { setCreateError('Email is required.'); return }
    const uname = createUsername.trim().toLowerCase()
    if (uname && !USERNAME_REGEX.test(uname)) {
      setCreateError('Username must be 3–20 characters: lowercase letters, numbers, underscores only.')
      return
    }
    if (createPassword.length < 8) { setCreateError('Password must be at least 8 characters.'); return }
    if (createPassword !== createConfirm) { setCreateError('Passwords do not match.'); return }

    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: createName.trim(),
          email: createEmail.trim(),
          username: uname || undefined,
          role: createRole,
          branchIds: createBranches,
          temporaryPassword: createPassword,
        }),
      })
      const json = await res.json()
      if (!json.success) { setCreateError(json.error); return }
      // Refresh user list
      const refresh = await fetch('/api/admin/users').then((r) => r.json())
      if (refresh.success) setUsers(refresh.data.users)
      closeCreate()
    } catch {
      setCreateError('Network error — please try again.')
    } finally {
      setCreating(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (fetchError) {
    return <div style={{ color: '#cc4444', fontSize: 13, padding: 16 }}>Failed to load users: {fetchError}</div>
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Users</div>
          <button onClick={openCreate} className="btn-primary" style={{ fontSize: 13, padding: '7px 16px' }}>
            + Add User
          </button>
        </div>

        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map((i) => <Skeleton key={i} height={48} />)}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 64 }} />   {/* Access */}
                <col style={{ width: '18%' }} /> {/* Name */}
                <col style={{ width: '13%' }} /> {/* Username */}
                <col style={{ width: '22%' }} /> {/* Email */}
                <col style={{ width: '13%' }} /> {/* Role */}
                <col />                          {/* Branches — takes remaining */}
                <col style={{ width: 180 }} />   {/* Actions */}
              </colgroup>
              <thead>
                <tr>
                  {['Access', 'Name', 'Username', 'Email', 'Role', 'Branches', ''].map((h) => (
                    <th
                      key={h}
                      className="table-header"
                      style={{ textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid #2a2a2a', fontWeight: 400 }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isEditing = editing === user.id
                  const shownBranches = user.branchIds.slice(0, 3)
                  const extraCount = user.branchIds.length - shownBranches.length
                  return (
                    <tr key={user.id} style={{ borderBottom: '1px solid #2a2a2a', opacity: user.isActive ? 1 : 0.45 }}>
                      {/* Access toggle */}
                      <td style={{ padding: '12px 14px', textAlign: 'center', verticalAlign: 'middle' }}>
                        <button
                          onClick={() => handleToggleActive(user.id, !user.isActive)}
                          title={user.isActive ? 'Deactivate user' : 'Activate user'}
                          style={{
                            width: 30,
                            height: 17,
                            borderRadius: 9,
                            background: user.isActive ? '#4caf50' : '#444',
                            border: 'none',
                            cursor: 'pointer',
                            position: 'relative',
                            transition: 'background 0.18s',
                            padding: 0,
                            flexShrink: 0,
                          }}
                        >
                          <span style={{
                            position: 'absolute',
                            width: 13,
                            height: 13,
                            borderRadius: '50%',
                            background: '#fff',
                            top: 2,
                            left: user.isActive ? 15 : 2,
                            transition: 'left 0.18s',
                            display: 'block',
                          }} />
                        </button>
                      </td>

                      {/* Name */}
                      <td style={{ padding: '12px 14px', verticalAlign: 'middle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span className="table-body" style={{ color: user.isActive ? '#ffffff' : '#888888', fontSize: 13, fontWeight: 500 }}>
                          {user.displayName || '—'}
                        </span>
                      </td>

                      {/* Username */}
                      <td style={{ padding: '12px 14px', verticalAlign: 'middle', overflow: 'hidden' }}>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editUsername}
                            onChange={(e) => setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                            placeholder="username"
                            maxLength={20}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            style={{ ...selectStyle, width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                          />
                        ) : user.username ? (
                          <span style={{ fontSize: 12, color: '#aaaaaa', fontFamily: 'monospace' }}>{user.username}</span>
                        ) : (
                          <span style={{ fontSize: 12, color: '#3a3a3a' }}>—</span>
                        )}
                      </td>

                      {/* Email */}
                      <td style={{ padding: '12px 14px', verticalAlign: 'middle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span className="table-body" style={{ fontSize: 12 }}>{user.email}</span>
                      </td>

                      {/* Role */}
                      <td style={{ padding: '12px 14px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as Role)}
                            style={selectStyle}
                          >
                            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ fontSize: 12, color: ROLE_COLORS[user.role], fontWeight: user.role === 'admin' ? 600 : 400 }}>
                            {ROLE_LABELS[user.role]}
                          </span>
                        )}
                      </td>

                      {/* Branches */}
                      <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                        {isEditing ? (
                          <BranchMultiSelect
                            branches={branches}
                            selectedIds={editBranches}
                            onChange={setEditBranches}
                            role={editRole}
                          />
                        ) : user.branchIds.length === 0 ? (
                          <span style={{ fontSize: 12, color: '#555555' }}>
                            {needsBranchScope(user.role) ? 'None assigned' : 'All branches'}
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 4, alignItems: 'center', overflow: 'hidden' }}>
                            {shownBranches.map((id) => (
                              <span key={id} style={{ fontSize: 11, color: '#ff6b00', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                {branchMap[id] ?? id}
                              </span>
                            ))}
                            {extraCount > 0 && (
                              <span style={{ fontSize: 11, color: '#555555', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                +{extraCount} more
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => saveEdit(user.id)}
                              disabled={saving}
                              className="btn-primary"
                              style={{ fontSize: 12, padding: '5px 12px', opacity: saving ? 0.6 : 1 }}
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#888888', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button
                              onClick={() => startEdit(user)}
                              style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 6, color: '#ff6b00', fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => openReset(user)}
                              style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, color: '#666666', fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              Reset PW
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

        {/* ── Test Accounts ────────────────────────────────────────────────── */}
        <div className="card" style={{ border: '1px solid #3a2a1a' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff' }}>Test Accounts</div>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#ff9800', background: '#3a2a1a', border: '1px solid #5a3a1a', padding: '1px 7px', borderRadius: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Development / Testing Only
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#666666' }}>
                Pre-configured accounts for testing each role. Password: <span style={{ fontFamily: 'monospace', color: '#888888' }}>TestPass2026!</span>
              </div>
            </div>
          </div>

          {testLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 36, borderRadius: 6 }} />)}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {testAccounts.map((a) => (
                <div key={a.email} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', background: '#1a1a1a', borderRadius: 6 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: a.exists ? '#4caf50' : '#444444',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: '#cccccc' }}>{a.displayName}</span>
                    <span style={{ fontSize: 11, color: '#555555', marginLeft: 8 }}>{a.email}</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#666666', flexShrink: 0 }}>{a.role.replace('_', ' ')}</span>
                  <span style={{ fontSize: 11, color: a.exists ? '#4caf50' : '#555555', flexShrink: 0 }}>
                    {a.exists ? 'Active' : 'Not created'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {testMsg && (
            <div style={{ fontSize: 12, color: testMsg.type === 'success' ? '#4caf50' : '#cc4444', padding: '8px 10px', background: testMsg.type === 'success' ? '#1a2a1a' : '#2a1a1a', borderRadius: 6, marginBottom: 12 }}>
              {testMsg.text}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleCreateTestAccounts}
              disabled={testCreating || testDeleting}
              style={{
                background: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: 8,
                color: '#cccccc',
                fontSize: 13,
                padding: '7px 16px',
                cursor: (testCreating || testDeleting) ? 'default' : 'pointer',
                fontFamily: 'inherit',
                opacity: (testCreating || testDeleting) ? 0.6 : 1,
              }}
            >
              {testCreating ? 'Creating…' : 'Create Test Accounts'}
            </button>
            <button
              onClick={handleDeleteTestAccounts}
              disabled={testCreating || testDeleting || testAccounts.every((a) => !a.exists)}
              style={{
                background: 'transparent',
                border: '1px solid #3a1a1a',
                borderRadius: 8,
                color: '#cc4444',
                fontSize: 13,
                padding: '7px 16px',
                cursor: (testCreating || testDeleting || testAccounts.every((a) => !a.exists)) ? 'default' : 'pointer',
                fontFamily: 'inherit',
                opacity: (testCreating || testDeleting || testAccounts.every((a) => !a.exists)) ? 0.4 : 1,
              }}
            >
              {testDeleting ? 'Deleting…' : 'Delete Test Accounts'}
            </button>
          </div>
        </div>
      </div>

      {/* Reset password modal */}
      {resetUserId && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) closeReset() }}
        >
          <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: 28, width: '100%', maxWidth: 440 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', marginBottom: 4 }}>Reset Password</div>
            <div style={{ fontSize: 12, color: '#888888', marginBottom: 20 }}>
              {resetUserName}
            </div>

            {resetSuccess ? (
              <>
                <div style={{ fontSize: 13, color: '#4caf50', padding: '12px 14px', background: '#1a2a1a', border: '1px solid #2a3a2a', borderRadius: 8, marginBottom: 20, lineHeight: 1.5 }}>
                  Password reset successfully. The user will be required to set a new password on their next login.
                </div>
                <button
                  onClick={closeReset}
                  className="btn-primary"
                  style={{ width: '100%' }}
                >
                  Done
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Temporary Password</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={resetPassword}
                      onChange={(e) => { setResetPassword(e.target.value); setResetCopied(false) }}
                      placeholder="Min 8 characters"
                      style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', letterSpacing: '0.05em' }}
                    />
                    <button
                      type="button"
                      onClick={handleCopyReset}
                      disabled={!resetPassword}
                      style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 6, color: resetCopied ? '#4caf50' : '#888888', fontSize: 11, padding: '0 10px', cursor: resetPassword ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: resetPassword ? 1 : 0.4 }}
                    >
                      {resetCopied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerateReset}
                      style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 6, color: '#ff6b00', fontSize: 11, padding: '0 10px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                    >
                      Generate
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Confirm Password</label>
                  <input
                    type="text"
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.05em' }}
                  />
                </div>

                <div style={{ fontSize: 11, color: '#555555', lineHeight: 1.5, padding: '8px 10px', background: '#1a1a1a', borderRadius: 6, border: '1px solid #2a2a2a' }}>
                  Share this temporary password with the user out of band. They will be required to set a new password on their next login.
                </div>

                {resetError && (
                  <div style={{ fontSize: 12, color: '#cc4444', padding: '8px 10px', background: '#2a1a1a', borderRadius: 6 }}>
                    {resetError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={handleReset}
                    disabled={resetting || !resetPassword}
                    className="btn-primary"
                    style={{ flex: 1, opacity: (resetting || !resetPassword) ? 0.6 : 1 }}
                  >
                    {resetting ? 'Resetting…' : 'Reset Password'}
                  </button>
                  <button
                    onClick={closeReset}
                    style={{ flex: 1, background: '#2a2a2a', border: 'none', borderRadius: 8, color: '#888888', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create user modal */}
      {showCreate && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) closeCreate() }}
        >
          <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: 28, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', marginBottom: 4 }}>Add User</div>
            <div style={{ fontSize: 12, color: '#888888', marginBottom: 20 }}>
              Create a new account with a temporary password. The user will be required to change it on first login.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Display name */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Full Name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="First Last"
                  autoComplete="off"
                  style={inputStyle}
                />
              </div>

              {/* Email */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Email</label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="user@safetynetwork.com"
                  autoComplete="off"
                  style={inputStyle}
                />
              </div>

              {/* Username */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                  Username <span style={{ color: '#444444', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={createUsername}
                  onChange={(e) => setCreateUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="e.g. jsmith"
                  maxLength={20}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  style={{ ...inputStyle, fontFamily: 'monospace' }}
                />
                <div style={{ fontSize: 11, color: '#444444', marginTop: 4 }}>
                  3–20 chars · lowercase letters, numbers, underscores · used to log in instead of email
                </div>
              </div>

              {/* Role */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Role</label>
                <select value={createRole} onChange={(e) => setCreateRole(e.target.value as Role)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>

              {/* Branches */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                  Branches {(createRole === 'admin' || createRole === 'executive') && <span style={{ color: '#444444', textTransform: 'none', letterSpacing: 0 }}>(optional — they see all)</span>}
                </label>
                <BranchMultiSelect
                  branches={branches}
                  selectedIds={createBranches}
                  onChange={setCreateBranches}
                  role={createRole}
                />
              </div>

              {/* Temporary password */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Temporary Password</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={createPassword}
                    onChange={(e) => { setCreatePassword(e.target.value); setCreateCopied(false) }}
                    placeholder="Min 8 characters"
                    style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', letterSpacing: '0.05em' }}
                  />
                  <button
                    type="button"
                    onClick={handleCopyCreate}
                    disabled={!createPassword}
                    style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 6, color: createCopied ? '#4caf50' : '#888888', fontSize: 11, padding: '0 10px', cursor: createPassword ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: createPassword ? 1 : 0.4 }}
                  >
                    {createCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateCreate}
                    style={{ background: '#2a2a2a', border: '1px solid #333333', borderRadius: 6, color: '#ff6b00', fontSize: 11, padding: '0 10px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >
                    Generate
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Confirm Password</label>
                <input
                  type="text"
                  value={createConfirm}
                  onChange={(e) => setCreateConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.05em' }}
                />
              </div>

              <div style={{ fontSize: 11, color: '#555555', lineHeight: 1.5, padding: '8px 10px', background: '#1a1a1a', borderRadius: 6, border: '1px solid #2a2a2a' }}>
                Share this temporary password with the user. They will be required to change it on first login.
              </div>

              {createError && (
                <div style={{ fontSize: 12, color: '#cc4444', padding: '8px 10px', background: '#2a1a1a', borderRadius: 6 }}>
                  {createError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={handleCreate}
                  disabled={creating || !createPassword}
                  className="btn-primary"
                  style={{ flex: 1, opacity: (creating || !createPassword) ? 0.6 : 1 }}
                >
                  {creating ? 'Creating…' : 'Create User'}
                </button>
                <button
                  onClick={closeCreate}
                  style={{ flex: 1, background: '#2a2a2a', border: 'none', borderRadius: 8, color: '#888888', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
