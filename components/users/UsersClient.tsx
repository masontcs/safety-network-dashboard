'use client'

import { useState, useEffect } from 'react'
import Skeleton from '@/components/ui/Skeleton'
import type { Role } from '@/lib/supabase/database.types'

interface Branch { id: string; name: string }
interface User {
  id: string
  displayName: string
  email: string
  role: Role
  branchIds: string[]
}

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  executive: 'Executive',
  district_manager: 'District Manager',
  branch_manager: 'Branch Manager',
}

const ROLE_COLORS: Record<Role, string> = {
  admin: '#ff6b00',
  executive: '#888888',
  district_manager: '#cccccc',
  branch_manager: '#666666',
}

export default function UsersClient() {
  const [users, setUsers] = useState<User[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<Role>('branch_manager')
  const [editBranches, setEditBranches] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setUsers(json.data.users)
        setBranches(json.data.branches)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  function startEdit(user: User) {
    setEditing(user.id)
    setEditRole(user.role)
    setEditBranches(user.branchIds)
  }

  function cancelEdit() {
    setEditing(null)
  }

  async function saveEdit(userId: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: editRole, branchIds: editBranches }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, role: editRole, branchIds: editBranches } : u,
        ),
      )
      setEditing(null)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function toggleBranch(branchId: string) {
    setEditBranches((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId],
    )
  }

  const branchMap = Object.fromEntries(branches.map((b) => [b.id, b.name]))
  const needsBranchScope = (role: Role) =>
    role === 'district_manager' || role === 'branch_manager'

  if (error) {
    return (
      <div style={{ color: '#cc4444', fontSize: 13, padding: 16 }}>
        Failed to load users: {error}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Users</div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map((i) => <Skeleton key={i} height={48} />)}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Email', 'Role', 'Branches', ''].map((h) => (
                  <th
                    key={h}
                    className="table-header"
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      borderBottom: '1px solid #2a2a2a',
                      fontWeight: 400,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isEditing = editing === user.id
                return (
                  <tr key={user.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
                    {/* Name */}
                    <td className="table-body" style={{ padding: '12px 16px', color: '#ffffff' }}>
                      {user.displayName || '—'}
                    </td>

                    {/* Email */}
                    <td className="table-body" style={{ padding: '12px 16px' }}>
                      {user.email}
                    </td>

                    {/* Role */}
                    <td style={{ padding: '12px 16px' }}>
                      {isEditing ? (
                        <select
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as Role)}
                          style={{
                            background: '#2a2a2a',
                            border: '1px solid #333333',
                            borderRadius: 6,
                            padding: '4px 8px',
                            fontSize: 12,
                            color: '#cccccc',
                            fontFamily: 'inherit',
                          }}
                        >
                          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      ) : (
                        <span
                          style={{
                            fontSize: 12,
                            color: ROLE_COLORS[user.role],
                            fontWeight: 500,
                          }}
                        >
                          {ROLE_LABELS[user.role]}
                        </span>
                      )}
                    </td>

                    {/* Branches */}
                    <td style={{ padding: '12px 16px' }}>
                      {isEditing && needsBranchScope(editRole) ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {branches.map((b) => {
                            const on = editBranches.includes(b.id)
                            return (
                              <button
                                key={b.id}
                                onClick={() => toggleBranch(b.id)}
                                style={{
                                  background: on ? '#ff6b00' : '#2a2a2a',
                                  border: 'none',
                                  borderRadius: 4,
                                  padding: '3px 8px',
                                  fontSize: 11,
                                  color: on ? '#ffffff' : '#888888',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                }}
                              >
                                {b.name}
                              </button>
                            )
                          })}
                        </div>
                      ) : user.branchIds.length === 0 ? (
                        <span style={{ fontSize: 12, color: '#555555' }}>
                          {needsBranchScope(user.role) ? 'None assigned' : 'All branches'}
                        </span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {user.branchIds.map((id) => (
                            <span
                              key={id}
                              className="branch-name"
                              style={{ fontSize: 11 }}
                            >
                              {branchMap[id] ?? id}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
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
                            style={{
                              background: '#2a2a2a',
                              border: 'none',
                              borderRadius: 6,
                              padding: '5px 12px',
                              fontSize: 12,
                              color: '#888888',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(user)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ff6b00',
                            fontSize: 12,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          Edit
                        </button>
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
