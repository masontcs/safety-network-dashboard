'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Toggle from '@/components/billing/Toggle'
import CmrIcon from '@/components/cmr/CmrIcon'
import { useAlert, useConfirm } from '@/components/ui/DialogProvider'
import {
  CMR_ACCOUNT_NAME_MAX,
  CMR_ACCOUNT_TYPE_MAX,
  CMR_ACCOUNT_TYPE_SUGGESTIONS,
  type CmrAccount,
} from '@/lib/cmr/accounts'

/**
 * Accounts (Controller only). The cash accounts later phases group by: add, rename, set type,
 * deactivate / reactivate, and reorder (drag with @dnd-kit — pointer or keyboard — plus
 * up/down buttons as the single-pointer alternative, WCAG 2.5.7). Every write goes through
 * /api/cmr/accounts, which re-checks the Controller role. Nothing is ever deleted.
 */

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

// Drag only moves up/down.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const TYPE_LIST_ID = 'cmr-account-type-suggestions'

export default function CmrAccountsClient() {
  const confirm = useConfirm()
  const alert = useAlert()

  const [accounts, setAccounts] = useState<CmrAccount[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const [status, setStatus] = useState('')

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('')
  const [adding, setAdding] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const editBtnRefs = useRef(new Map<string, HTMLButtonElement>())

  const load = useCallback(async () => {
    const r = await api<{ accounts: CmrAccount[] }>('/api/cmr/accounts')
    if (!r.success) {
      if (r.code === 'FORBIDDEN' || r.code === 'UNAUTHORIZED') { window.location.href = '/cmr'; return }
      setLoadError(r.error)
      return
    }
    setLoadError(null)
    setAccounts(r.data.accounts)
  }, [])

  useEffect(() => { void load() }, [load])

  const inactiveCount = useMemo(() => (accounts ?? []).filter((a) => !a.active).length, [accounts])
  const nameOf = useCallback(
    (id: UniqueIdentifier | undefined) => (accounts ?? []).find((a) => a.id === id)?.name ?? 'account',
    [accounts],
  )

  async function addAccount(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) { await alert('Enter an account name.'); return }
    setAdding(true)
    const r = await api<{ account: CmrAccount }>('/api/cmr/accounts', {
      method: 'POST',
      body: JSON.stringify({ name, accountType: newType.trim() || null }),
    })
    setAdding(false)
    if (!r.success) { await alert({ title: 'Could not add the account', message: r.error }); return }
    setNewName('')
    setNewType('')
    setStatus(`${r.data.account.name} added.`)
    await load()
  }

  async function saveEdit(a: CmrAccount, name: string, accountType: string): Promise<boolean> {
    const body: Record<string, unknown> = { id: a.id }
    if (name.trim() !== a.name) body.name = name
    if ((accountType.trim() || null) !== a.accountType) body.accountType = accountType.trim() || null
    if (Object.keys(body).length === 1) return true
    setBusyId(a.id)
    const r = await api<{ account: CmrAccount }>('/api/cmr/accounts', { method: 'PATCH', body: JSON.stringify(body) })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not save the account', message: r.error }); return false }
    setStatus(`${r.data.account.name} saved.`)
    await load()
    return true
  }

  function finishEdit(id: string) {
    setEditingId(null)
    // Return focus to the row's Edit button once it re-renders.
    requestAnimationFrame(() => editBtnRefs.current.get(id)?.focus())
  }

  async function setActive(a: CmrAccount, active: boolean) {
    if (!active) {
      const ok = await confirm({
        title: `Deactivate ${a.name}?`,
        message:
          `${a.name} stays in this list, marked Inactive, and keeps its history — but it won't be offered for new ledger lines, recurring vendors or requests. You can reactivate it any time.`,
        confirmLabel: 'Deactivate',
        danger: true,
      })
      if (!ok) return
    }
    setBusyId(a.id)
    const r = await api<{ account: CmrAccount }>('/api/cmr/accounts', { method: 'PATCH', body: JSON.stringify({ id: a.id, active }) })
    setBusyId(null)
    if (!r.success) {
      await alert({ title: active ? 'Could not reactivate' : 'Could not deactivate', message: r.error })
      return
    }
    setStatus(`${a.name} ${active ? 'reactivated' : 'deactivated'}.`)
    await load()
  }

  // Optimistic reorder; one request at a time (controls are disabled while it saves).
  async function commitOrder(next: CmrAccount[], movedId: string) {
    const prev = accounts
    if (!prev || reordering) return
    setAccounts(next)
    setReordering(true)
    const r = await api<{ changed: boolean }>('/api/cmr/accounts/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids: next.map((a) => a.id) }),
    })
    setReordering(false)
    if (!r.success) {
      setAccounts(prev)
      await alert({ title: 'Could not save the new order', message: r.error })
      if (r.code === 'STALE') await load()
      return
    }
    const pos = next.findIndex((a) => a.id === movedId) + 1
    setStatus(`${nameOf(movedId)} moved to position ${pos} of ${next.length}.`)
    setAccounts(next.map((a, i) => ({ ...a, sortOrder: i })))
  }

  function move(a: CmrAccount, delta: -1 | 1) {
    if (!accounts) return
    const from = accounts.findIndex((x) => x.id === a.id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= accounts.length) return
    void commitOrder(arrayMove(accounts, from, to), a.id)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!accounts || !over || active.id === over.id) return
    const from = accounts.findIndex((a) => a.id === active.id)
    const to = accounts.findIndex((a) => a.id === over.id)
    if (from < 0 || to < 0) return
    void commitOrder(arrayMove(accounts, from, to), String(active.id))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements: Announcements = useMemo(() => {
    const posOf = (id: UniqueIdentifier | undefined) => (accounts ?? []).findIndex((a) => a.id === id) + 1
    const total = accounts?.length ?? 0
    return {
      onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, position ${posOf(active.id)} of ${total}.`,
      onDragOver: ({ active, over }) =>
        over ? `${nameOf(active.id)} is over position ${posOf(over.id)} of ${total}.` : `${nameOf(active.id)} is no longer over the list.`,
      onDragEnd: ({ active, over }) =>
        over ? `${nameOf(active.id)} dropped at position ${posOf(over.id)} of ${total}.` : `${nameOf(active.id)} dropped.`,
      onDragCancel: ({ active }) => `Reorder cancelled. ${nameOf(active.id)} returned to position ${posOf(active.id)}.`,
    }
  }, [accounts, nameOf])

  const locked = reordering || editingId !== null

  return (
    <>
      <header className="cmr-pagehead">
        <div>
          <h1 className="cmr-serif">Accounts</h1>
          <p>The bank accounts the ledger tracks. Their order here is the order they appear everywhere else.</p>
        </div>
      </header>

      <p className="cmr-sr-only" role="status" aria-live="polite">{status}</p>

      <datalist id={TYPE_LIST_ID}>
        {CMR_ACCOUNT_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
      </datalist>

      <section className="cmr-sec" aria-labelledby="cmr-acct-add-title">
        <div className="cmr-sh"><h2 id="cmr-acct-add-title">Add an account</h2></div>
        <div className="cmr-card">
          <form className="cmr-acct-form" onSubmit={addAccount}>
            <label className="cmr-field">
              <span className="cmr-label">Name</span>
              <input
                className="cmr-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={CMR_ACCOUNT_NAME_MAX}
                placeholder="e.g. TCS Operating"
                autoComplete="off"
                required
              />
            </label>
            <label className="cmr-field">
              <span className="cmr-label">Type <span className="opt">(optional)</span></span>
              <input
                className="cmr-input"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                maxLength={CMR_ACCOUNT_TYPE_MAX}
                list={TYPE_LIST_ID}
                placeholder="Checking, Payroll…"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="cmr-btn" disabled={adding || !newName.trim()}>
              <CmrIcon name="plus" /> {adding ? 'Adding…' : 'Add account'}
            </button>
          </form>
        </div>
      </section>

      <section className="cmr-sec" aria-labelledby="cmr-acct-list-title">
        <div className="cmr-sh">
          <h2 id="cmr-acct-list-title">All accounts</h2>
          {accounts && (
            <span className="c">
              {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
              {inactiveCount > 0 && ` · ${inactiveCount} inactive`}
            </span>
          )}
          {reordering && <span className="tot" aria-hidden="true">Saving order…</span>}
        </div>

        {loadError && (
          <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
            <span style={{ flex: 1 }}>{loadError}</span>
            <button type="button" className="cmr-btn sm ghost" onClick={() => void load()}>Retry</button>
          </div>
        )}

        <div className="cmr-card">
          {accounts === null && !loadError && (
            <div aria-busy="true" aria-label="Loading accounts">
              {[0, 1, 2, 3].map((i) => (
                <div className="cmr-row" key={i}>
                  <span className="cmr-skel" style={{ width: 18, height: 18 }} />
                  <span className="cmr-skel" style={{ width: '30%', height: 12 }} />
                  <span className="cmr-skel" style={{ width: 38, height: 22, marginLeft: 'auto', borderRadius: 999 }} />
                </div>
              ))}
            </div>
          )}

          {accounts && accounts.length === 0 && (
            <div className="cmr-empty">
              <div className="ring"><CmrIcon name="accounts" /></div>
              <h2 className="cmr-serif">No accounts yet</h2>
              <p>Add the first account above. Ledger lines, recurring vendors and requests are grouped by these.</p>
            </div>
          )}

          {accounts && accounts.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[verticalOnly]}
              onDragEnd={onDragEnd}
              accessibility={{
                announcements,
                screenReaderInstructions: {
                  draggable:
                    'To reorder, press Space or Enter to pick up the account, use the up and down arrow keys to move it, then press Space or Enter to drop it, or Escape to cancel.',
                },
              }}
            >
              <SortableContext items={accounts.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                <ul className="cmr-acct-list" aria-label="Accounts, in display order">
                  {accounts.map((a, i) => (
                    <AccountRow
                      key={a.id}
                      account={a}
                      index={i}
                      total={accounts.length}
                      busy={busyId === a.id}
                      locked={locked}
                      editing={editingId === a.id}
                      onEdit={() => setEditingId(a.id)}
                      onSave={async (name, type) => { if (await saveEdit(a, name, type)) finishEdit(a.id) }}
                      onCancel={() => finishEdit(a.id)}
                      onMove={(d) => move(a, d)}
                      onActive={(v) => void setActive(a, v)}
                      editBtnRef={(el) => { if (el) editBtnRefs.current.set(a.id, el); else editBtnRefs.current.delete(a.id) }}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>
        {accounts && accounts.length > 1 && (
          <p className="cmr-hint">
            Drag the <CmrIcon name="grip" size={12} /> handle or use the arrows to reorder. Inactive accounts keep their
            history and can be reactivated; accounts are never deleted.
          </p>
        )}
      </section>
    </>
  )
}

function AccountRow({
  account: a,
  index,
  total,
  busy,
  locked,
  editing,
  onEdit,
  onSave,
  onCancel,
  onMove,
  onActive,
  editBtnRef,
}: {
  account: CmrAccount
  index: number
  total: number
  busy: boolean
  locked: boolean
  editing: boolean
  onEdit: () => void
  onSave: (name: string, type: string) => Promise<void>
  onCancel: () => void
  onMove: (delta: -1 | 1) => void
  onActive: (active: boolean) => void
  editBtnRef: (el: HTMLButtonElement | null) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: a.id,
    disabled: locked || busy,
  })
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition }

  const [name, setName] = useState(a.name)
  const [type, setType] = useState(a.accountType ?? '')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    setName(a.name)
    setType(a.accountType ?? '')
    requestAnimationFrame(() => { nameRef.current?.focus(); nameRef.current?.select() })
  }, [editing, a.name, a.accountType])

  const cls = ['cmr-row', 'cmr-acct-row', a.active ? '' : 'inactive'].filter(Boolean).join(' ')
  const moveDisabled = locked || busy

  return (
    <li ref={setNodeRef} style={style} className={cls} data-dragging={isDragging || undefined} aria-busy={busy || undefined}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="cmr-handle"
        aria-label={`Reorder ${a.name}, position ${index + 1} of ${total}`}
        disabled={moveDisabled}
        {...attributes}
        {...listeners}
      >
        <CmrIcon name="grip" />
      </button>

      {editing ? (
        <form
          className="cmr-acct-edit"
          onSubmit={async (e) => {
            e.preventDefault()
            setSaving(true)
            await onSave(name, type)
            setSaving(false)
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
        >
          <input
            ref={nameRef}
            className="cmr-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={CMR_ACCOUNT_NAME_MAX}
            aria-label={`Name for ${a.name}`}
            autoComplete="off"
            required
          />
          <input
            className="cmr-input"
            value={type}
            onChange={(e) => setType(e.target.value)}
            maxLength={CMR_ACCOUNT_TYPE_MAX}
            list={TYPE_LIST_ID}
            placeholder="Type (optional)"
            aria-label={`Type for ${a.name}`}
            autoComplete="off"
          />
          <button type="submit" className="cmr-btn sm" disabled={saving || !name.trim()}>
            <CmrIcon name="check" size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        </form>
      ) : (
        <>
          <div className="who">
            <span className="desc">
              {a.name}
              {!a.active && <span className="cmr-pill viewer" style={{ marginLeft: 8 }}>Inactive</span>}
            </span>
            <span className="mt">{a.accountType || 'No type set'}</span>
          </div>

          <div className="moves">
            <button
              type="button"
              className="cmr-iconbtn sm"
              onClick={() => onMove(-1)}
              disabled={moveDisabled || index === 0}
              aria-label={`Move ${a.name} up`}
              title="Move up"
            >
              <CmrIcon name="up" />
            </button>
            <button
              type="button"
              className="cmr-iconbtn sm"
              onClick={() => onMove(1)}
              disabled={moveDisabled || index === total - 1}
              aria-label={`Move ${a.name} down`}
              title="Move down"
            >
              <CmrIcon name="down" />
            </button>
          </div>

          <button
            type="button"
            ref={editBtnRef}
            className="cmr-btn sm ghost"
            onClick={onEdit}
            disabled={locked || busy}
            aria-label={`Edit ${a.name}`}
          >
            <CmrIcon name="edit" size={14} /> Edit
          </button>

          <div className="state">
            <span className="lbl" aria-hidden="true">{a.active ? 'Active' : 'Inactive'}</span>
            <Toggle
              checked={a.active}
              onChange={onActive}
              disabled={busy || locked}
              ariaLabel={`${a.name} active`}
            />
          </div>
        </>
      )}
    </li>
  )
}
