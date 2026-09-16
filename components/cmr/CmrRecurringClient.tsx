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
  type SensorDescriptor,
  type SensorOptions,
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
import Select from '@/components/billing/Select'
import MoneyInput from '@/components/billing/MoneyInput'
import CmrIcon from '@/components/cmr/CmrIcon'
import { useAlert, useConfirm } from '@/components/ui/DialogProvider'
import { pacificToday } from '@/lib/utils/date'
import {
  CMR_PLAN_TERMS_MAX,
  CMR_RECURRENCE_MAX,
  CMR_RECURRENCE_SUGGESTIONS,
  CMR_RECURRING_SECTIONS,
  CMR_RECURRING_SECTION_LABEL,
  CMR_VENDOR_NAME_MAX,
  CMR_VENDOR_NOTES_MAX,
  formatCents,
  formatPlanDate,
  sectionTotalCents,
  type CmrAccountRef,
  type CmrRecurringSection,
  type CmrRecurringVendor,
} from '@/lib/cmr/recurring'

/**
 * Recurring vendors — Weekly / Monthly / Urgent Payment Plans.
 *
 * Every CMR role reads this screen. Only a Controller (`canEdit` from the API) gets the edit
 * controls: add, edit (incl. moving section and recording the last amount sent), on-hold,
 * deactivate / reactivate (in-app confirm on deactivate), and reorder within a section
 * (@dnd-kit drag — pointer or keyboard — plus up/down buttons, WCAG 2.5.7). Hiding controls
 * is cosmetic: /api/cmr/recurring re-checks the Controller role on every write. Nothing is
 * ever deleted.
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

interface Loaded {
  vendors: CmrRecurringVendor[]
  accounts: CmrAccountRef[]
  canEdit: boolean
}

const SECTION_BLURB: Record<CmrRecurringSection, string> = {
  weekly: 'Paid every week.',
  monthly: 'Paid once a month.',
  urgent: 'Catch-up plans with agreed terms and a due date.',
}

// Drag only moves up/down.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export default function CmrRecurringClient() {
  const confirm = useConfirm()
  const alert = useAlert()

  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reordering, setReordering] = useState<CmrRecurringSection | null>(null)
  const [status, setStatus] = useState('')
  const [addingIn, setAddingIn] = useState<CmrRecurringSection | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editBtnRefs = useRef(new Map<string, HTMLButtonElement>())
  const addBtnRefs = useRef(new Map<CmrRecurringSection, HTMLButtonElement>())

  const load = useCallback(async () => {
    const r = await api<Loaded>('/api/cmr/recurring')
    if (!r.success) {
      if (r.code === 'UNAUTHORIZED') { window.location.href = '/login'; return }
      if (r.code === 'FORBIDDEN') { window.location.href = '/cmr/no-access'; return }
      setLoadError(r.error)
      return
    }
    setLoadError(null)
    setData(r.data)
  }, [])

  useEffect(() => { void load() }, [load])

  const today = useMemo(() => pacificToday(), [])
  const canEdit = data?.canEdit === true
  const bySection = useMemo(() => {
    const out: Record<CmrRecurringSection, CmrRecurringVendor[]> = { weekly: [], monthly: [], urgent: [] }
    for (const v of data?.vendors ?? []) out[v.section].push(v)
    return out
  }, [data])

  const focusLater = (el: HTMLElement | undefined) => requestAnimationFrame(() => el?.focus())

  // ── writes (Controller only; the API re-checks) ──────────────────────────
  async function create(body: Record<string, unknown>): Promise<boolean> {
    const r = await api<{ vendor: CmrRecurringVendor }>('/api/cmr/recurring', { method: 'POST', body: JSON.stringify(body) })
    if (!r.success) { await alert({ title: 'Could not add the vendor', message: r.error }); return false }
    const section = r.data.vendor.section
    setStatus(`${r.data.vendor.vendorName} added to ${CMR_RECURRING_SECTION_LABEL[section]}.`)
    setAddingIn(null)
    await load()
    focusLater(addBtnRefs.current.get(section))
    return true
  }

  async function patch(v: CmrRecurringVendor, body: Record<string, unknown>, verb: string, failTitle: string): Promise<boolean> {
    setBusyId(v.id)
    const r = await api<{ vendor: CmrRecurringVendor }>('/api/cmr/recurring', {
      method: 'PATCH',
      body: JSON.stringify({ id: v.id, ...body }),
    })
    setBusyId(null)
    if (!r.success) { await alert({ title: failTitle, message: r.error }); return false }
    setStatus(`${r.data.vendor.vendorName} ${verb}.`)
    await load()
    return true
  }

  async function saveEdit(v: CmrRecurringVendor, body: Record<string, unknown>) {
    if (Object.keys(body).length === 0) { finishEdit(v.id); return }
    if (await patch(v, body, 'saved', 'Could not save the vendor')) finishEdit(v.id)
  }

  function finishEdit(id: string) {
    setEditingId(null)
    focusLater(editBtnRefs.current.get(id))
  }

  async function setActive(v: CmrRecurringVendor, active: boolean) {
    if (!active) {
      const ok = await confirm({
        title: `Deactivate ${v.vendorName}?`,
        message:
          `${v.vendorName} stays in this list, marked Inactive, and keeps its history — but it won't be suggested for the ledger. You can reactivate it any time.`,
        confirmLabel: 'Deactivate',
        danger: true,
      })
      if (!ok) return
    }
    await patch(v, { active }, active ? 'reactivated' : 'deactivated', active ? 'Could not reactivate' : 'Could not deactivate')
  }

  async function setHold(v: CmrRecurringVendor, onHold: boolean) {
    await patch(v, { onHold }, onHold ? 'put on hold' : 'taken off hold', 'Could not change the hold')
  }

  // Optimistic reorder within one section; one request at a time.
  async function commitOrder(section: CmrRecurringSection, next: CmrRecurringVendor[], movedId: string) {
    const prev = data
    if (!prev || reordering) return
    const nextIds = next.map((v) => v.id)
    const others = prev.vendors.filter((v) => v.section !== section)
    const renumbered = next.map((v, i) => ({ ...v, sortOrder: i }))
    const merged = [...others, ...renumbered]
    setData({ ...prev, vendors: CMR_RECURRING_SECTIONS.flatMap((s) => merged.filter((v) => v.section === s)) })
    setReordering(section)
    const r = await api<{ changed: boolean }>('/api/cmr/recurring/reorder', {
      method: 'POST',
      body: JSON.stringify({ section, ids: nextIds }),
    })
    setReordering(null)
    if (!r.success) {
      setData(prev)
      await alert({ title: 'Could not save the new order', message: r.error })
      if (r.code === 'STALE') await load()
      return
    }
    const name = next.find((v) => v.id === movedId)?.vendorName ?? 'Vendor'
    setStatus(`${name} moved to position ${nextIds.indexOf(movedId) + 1} of ${next.length} in ${CMR_RECURRING_SECTION_LABEL[section]}.`)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const locked = reordering !== null || editingId !== null || addingIn !== null

  return (
    <>
      <header className="cmr-pagehead">
        <div>
          <h1 className="cmr-serif">Recurring vendors</h1>
          <p>The payments that come around every week or month, and the urgent plans being paid down — remembered so none are missed.</p>
        </div>
      </header>

      <p className="cmr-sr-only" role="status" aria-live="polite">{status}</p>

      {data && !canEdit && (
        <div className="cmr-notice" style={{ marginBottom: 18 }}>
          <CmrIcon name="lock" size={14} />
          <span>You can view recurring vendors. Only a Controller can add or change them.</span>
        </div>
      )}

      {loadError && (
        <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <button type="button" className="cmr-btn sm ghost" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {data === null && !loadError && (
        <section className="cmr-sec" aria-busy="true" aria-label="Loading recurring vendors">
          <div className="cmr-card">
            {[0, 1, 2].map((i) => (
              <div className="cmr-row" key={i}>
                <span className="cmr-skel" style={{ width: '34%', height: 12 }} />
                <span className="cmr-skel" style={{ width: 70, height: 12, marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        </section>
      )}

      {data &&
        CMR_RECURRING_SECTIONS.map((section) => (
          <SectionBlock
            key={section}
            section={section}
            vendors={bySection[section]}
            accounts={data.accounts}
            canEdit={canEdit}
            today={today}
            sensors={sensors}
            locked={locked}
            reordering={reordering === section}
            busyId={busyId}
            editingId={editingId}
            adding={addingIn === section}
            onAdd={() => setAddingIn(section)}
            onCancelAdd={() => { setAddingIn(null); focusLater(addBtnRefs.current.get(section)) }}
            onCreate={create}
            onEdit={(id) => setEditingId(id)}
            onSaveEdit={saveEdit}
            onCancelEdit={finishEdit}
            onActive={(v, a) => void setActive(v, a)}
            onHold={(v, h) => void setHold(v, h)}
            onOrder={(next, moved) => void commitOrder(section, next, moved)}
            addBtnRef={(el) => { if (el) addBtnRefs.current.set(section, el); else addBtnRefs.current.delete(section) }}
            editBtnRef={(id, el) => { if (el) editBtnRefs.current.set(id, el); else editBtnRefs.current.delete(id) }}
          />
        ))}

      {data && canEdit && (data.vendors.length > 0) && (
        <p className="cmr-hint">
          Drag the <CmrIcon name="grip" size={12} /> handle or use the arrows to reorder within a section. To move a vendor
          to another section, edit it. Inactive vendors keep their history and can be reactivated; vendors are never deleted.
        </p>
      )}
    </>
  )
}

// ── one section ───────────────────────────────────────────────────────────

function SectionBlock({
  section,
  vendors,
  accounts,
  canEdit,
  today,
  sensors,
  locked,
  reordering,
  busyId,
  editingId,
  adding,
  onAdd,
  onCancelAdd,
  onCreate,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onActive,
  onHold,
  onOrder,
  addBtnRef,
  editBtnRef,
}: {
  section: CmrRecurringSection
  vendors: CmrRecurringVendor[]
  accounts: CmrAccountRef[]
  canEdit: boolean
  today: string
  sensors: SensorDescriptor<SensorOptions>[]
  locked: boolean
  reordering: boolean
  busyId: string | null
  editingId: string | null
  adding: boolean
  onAdd: () => void
  onCancelAdd: () => void
  onCreate: (body: Record<string, unknown>) => Promise<boolean>
  onEdit: (id: string) => void
  onSaveEdit: (v: CmrRecurringVendor, body: Record<string, unknown>) => Promise<void>
  onCancelEdit: (id: string) => void
  onActive: (v: CmrRecurringVendor, active: boolean) => void
  onHold: (v: CmrRecurringVendor, onHold: boolean) => void
  onOrder: (next: CmrRecurringVendor[], movedId: string) => void
  addBtnRef: (el: HTMLButtonElement | null) => void
  editBtnRef: (id: string, el: HTMLButtonElement | null) => void
}) {
  const label = CMR_RECURRING_SECTION_LABEL[section]
  const titleId = `cmr-rv-${section}-title`
  const total = sectionTotalCents(vendors)
  const onHoldCount = vendors.filter((v) => v.active && v.onHold).length
  const inactiveCount = vendors.filter((v) => !v.active).length

  const nameOf = useCallback(
    (id: UniqueIdentifier | undefined) => vendors.find((v) => v.id === id)?.vendorName ?? 'vendor',
    [vendors],
  )
  const announcements: Announcements = useMemo(() => {
    const posOf = (id: UniqueIdentifier | undefined) => vendors.findIndex((v) => v.id === id) + 1
    const n = vendors.length
    return {
      onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, position ${posOf(active.id)} of ${n} in ${label}.`,
      onDragOver: ({ active, over }) =>
        over ? `${nameOf(active.id)} is over position ${posOf(over.id)} of ${n}.` : `${nameOf(active.id)} is no longer over the list.`,
      onDragEnd: ({ active, over }) =>
        over ? `${nameOf(active.id)} dropped at position ${posOf(over.id)} of ${n}.` : `${nameOf(active.id)} dropped.`,
      onDragCancel: ({ active }) => `Reorder cancelled. ${nameOf(active.id)} returned to position ${posOf(active.id)}.`,
    }
  }, [vendors, nameOf, label])

  function move(v: CmrRecurringVendor, delta: -1 | 1) {
    const from = vendors.findIndex((x) => x.id === v.id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= vendors.length) return
    onOrder(arrayMove(vendors, from, to), v.id)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = vendors.findIndex((v) => v.id === active.id)
    const to = vendors.findIndex((v) => v.id === over.id)
    if (from < 0 || to < 0) return
    onOrder(arrayMove(vendors, from, to), String(active.id))
  }

  const rows = vendors.map((v, i) => (
    <VendorRow
      key={v.id}
      vendor={v}
      index={i}
      total={vendors.length}
      accounts={accounts}
      canEdit={canEdit}
      today={today}
      busy={busyId === v.id}
      locked={locked}
      editing={editingId === v.id}
      onEdit={() => onEdit(v.id)}
      onSave={(body) => onSaveEdit(v, body)}
      onCancel={() => onCancelEdit(v.id)}
      onMove={(d) => move(v, d)}
      onActive={(a) => onActive(v, a)}
      onHold={(h) => onHold(v, h)}
      editBtnRef={(el) => editBtnRef(v.id, el)}
    />
  ))

  return (
    <section className="cmr-sec" aria-labelledby={titleId}>
      <div className="cmr-sh cmr-rv-sh">
        <div className="hd">
          <h2 id={titleId}>{label}</h2>
          <span className="c">
            {plural(vendors.length, 'vendor')}
            {onHoldCount > 0 && ` · ${onHoldCount} on hold`}
            {inactiveCount > 0 && ` · ${inactiveCount} inactive`}
          </span>
        </div>
        <span className="tot">
          {reordering ? (
            <span aria-hidden="true">Saving order…</span>
          ) : (
            <>Active total <b className="cmr-num">{formatCents(total)}</b></>
          )}
        </span>
        {canEdit && (
          <button
            type="button"
            ref={addBtnRef}
            className="cmr-btn sm ghost"
            onClick={onAdd}
            disabled={locked}
            aria-label={`Add a ${label} vendor`}
          >
            <CmrIcon name="plus" size={14} /> Add
          </button>
        )}
      </div>
      <p className="cmr-rv-blurb">{SECTION_BLURB[section]}</p>

      <div className="cmr-card">
        {vendors.length === 0 && !adding && (
          <div className="cmr-rv-empty">
            No {section === 'urgent' ? 'urgent payment plans' : `${label.toLowerCase()} vendors`} yet.
          </div>
        )}

        {vendors.length > 0 &&
          (canEdit ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[verticalOnly]}
              onDragEnd={onDragEnd}
              accessibility={{
                announcements,
                screenReaderInstructions: {
                  draggable:
                    'To reorder, press Space or Enter to pick up the vendor, use the up and down arrow keys to move it, then press Space or Enter to drop it, or Escape to cancel.',
                },
              }}
            >
              <SortableContext items={vendors.map((v) => v.id)} strategy={verticalListSortingStrategy}>
                <ul className="cmr-rv-list" aria-label={`${label} vendors, in display order`}>{rows}</ul>
              </SortableContext>
            </DndContext>
          ) : (
            <ul className="cmr-rv-list" aria-label={`${label} vendors`}>{rows}</ul>
          ))}

        {canEdit && adding && (
          <div className="cmr-rv-addwrap">
            <VendorForm
              mode="add"
              initialSection={section}
              accounts={accounts}
              onSubmit={onCreate}
              onCancel={onCancelAdd}
            />
          </div>
        )}
      </div>
    </section>
  )
}

// ── one vendor ────────────────────────────────────────────────────────────

function VendorRow({
  vendor: v,
  index,
  total,
  accounts,
  canEdit,
  today,
  busy,
  locked,
  editing,
  onEdit,
  onSave,
  onCancel,
  onMove,
  onActive,
  onHold,
  editBtnRef,
}: {
  vendor: CmrRecurringVendor
  index: number
  total: number
  accounts: CmrAccountRef[]
  canEdit: boolean
  today: string
  busy: boolean
  locked: boolean
  editing: boolean
  onEdit: () => void
  onSave: (body: Record<string, unknown>) => Promise<void>
  onCancel: () => void
  onMove: (delta: -1 | 1) => void
  onActive: (active: boolean) => void
  onHold: (onHold: boolean) => void
  editBtnRef: (el: HTMLButtonElement | null) => void
}) {
  const cls = ['cmr-row', 'cmr-rv-row', v.active ? '' : 'inactive', v.active && v.onHold ? 'held' : '', editing ? 'editing' : '']
    .filter(Boolean)
    .join(' ')
  const pastDue = v.section === 'urgent' && v.planDueDate !== null && v.planDueDate < today && v.active

  const body = (
    <>
      <div className="who">
        <span className="desc">
          <span className="nm">{v.vendorName}</span>
          {v.active && v.onHold && <span className="cmr-pill warn"><span className="pd" /> On hold</span>}
          {!v.active && <span className="cmr-pill viewer">Inactive</span>}
        </span>
        <span className="mt">
          {v.accountName}
          {!v.accountActive && <span className="acct-off"> (inactive account)</span>}
          {' · '}
          {v.recurrenceDetail ?? 'No schedule noted'}
          {' · '}
          Last sent{' '}
          <span className="cmr-num">{v.lastAmountSentCents === null ? '—' : formatCents(v.lastAmountSentCents)}</span>
        </span>
        {v.section === 'urgent' && (
          <span className="mt plan">
            <span>Plan: {v.planTerms ?? 'No terms noted'}</span>
            {v.planDueDate && (
              <>
                <span aria-hidden="true">·</span>
                <span>Due {formatPlanDate(v.planDueDate)}</span>
                {pastDue && <span className="cmr-pill danger">Past due</span>}
              </>
            )}
          </span>
        )}
        {v.notes && <span className="note">{v.notes}</span>}
      </div>
      <span className="amt cmr-num" aria-label={`Amount ${formatCents(v.amountCents)}`}>{formatCents(v.amountCents)}</span>
    </>
  )

  if (!canEdit) {
    return <li className={cls}>{body}</li>
  }
  return (
    <SortableVendorRow
      vendor={v}
      className={cls}
      index={index}
      total={total}
      disabled={locked || busy}
      busy={busy}
    >
      {editing ? (
        <div className="cmr-rv-editwrap">
          <VendorForm mode="edit" vendor={v} accounts={accounts} onSubmit={async (b) => { await onSave(b); return true }} onCancel={onCancel} />
        </div>
      ) : (
        <>
          {body}
          <div className="ctl">
            <div className="moves">
              <button
                type="button"
                className="cmr-iconbtn sm"
                onClick={() => onMove(-1)}
                disabled={locked || busy || index === 0}
                aria-label={`Move ${v.vendorName} up`}
                title="Move up"
              >
                <CmrIcon name="up" />
              </button>
              <button
                type="button"
                className="cmr-iconbtn sm"
                onClick={() => onMove(1)}
                disabled={locked || busy || index === total - 1}
                aria-label={`Move ${v.vendorName} down`}
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
              aria-label={`Edit ${v.vendorName}`}
            >
              <CmrIcon name="edit" size={14} /> Edit
            </button>
            <div className="flags">
              <div className="flag">
                <span className="lbl" aria-hidden="true">Hold</span>
                <Toggle checked={v.onHold} onChange={onHold} disabled={busy || locked || !v.active} ariaLabel={`${v.vendorName} on hold`} />
              </div>
              <div className="flag">
                <span className="lbl" aria-hidden="true">Active</span>
                <Toggle checked={v.active} onChange={onActive} disabled={busy || locked} ariaLabel={`${v.vendorName} active`} />
              </div>
            </div>
          </div>
        </>
      )}
    </SortableVendorRow>
  )
}

function SortableVendorRow({
  vendor: v,
  className,
  index,
  total,
  disabled,
  busy,
  children,
}: {
  vendor: CmrRecurringVendor
  className: string
  index: number
  total: number
  disabled: boolean
  busy: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: v.id,
    disabled,
  })
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  return (
    <li ref={setNodeRef} style={style} className={className} data-dragging={isDragging || undefined} aria-busy={busy || undefined}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="cmr-handle"
        aria-label={`Reorder ${v.vendorName}, position ${index + 1} of ${total}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <CmrIcon name="grip" />
      </button>
      {children}
    </li>
  )
}

// ── add / edit form ───────────────────────────────────────────────────────

type FormProps =
  | {
      mode: 'add'
      initialSection: CmrRecurringSection
      vendor?: undefined
      accounts: CmrAccountRef[]
      onSubmit: (body: Record<string, unknown>) => Promise<boolean>
      onCancel: () => void
    }
  | {
      mode: 'edit'
      vendor: CmrRecurringVendor
      initialSection?: undefined
      accounts: CmrAccountRef[]
      onSubmit: (body: Record<string, unknown>) => Promise<boolean>
      onCancel: () => void
    }

const blankToNull = (s: string): string | null => (s.trim() ? s.trim() : null)

function VendorForm(props: FormProps) {
  const { mode, accounts, onSubmit, onCancel } = props
  const v = props.vendor
  const uid = mode === 'edit' ? v!.id : `new-${props.initialSection}`

  const activeAccounts = accounts.filter((a) => a.active)
  const [vendorName, setVendorName] = useState(v?.vendorName ?? '')
  const [accountId, setAccountId] = useState(v?.accountId ?? (activeAccounts.length === 1 ? activeAccounts[0].id : ''))
  const [section, setSection] = useState<CmrRecurringSection>(v?.section ?? props.initialSection!)
  const [amountCents, setAmountCents] = useState<number | null>(v ? v.amountCents : null)
  const [lastSentCents, setLastSentCents] = useState<number | null>(v?.lastAmountSentCents ?? null)
  const [recurrence, setRecurrence] = useState(v?.recurrenceDetail ?? '')
  const [planTerms, setPlanTerms] = useState(v?.planTerms ?? '')
  const [planDueDate, setPlanDueDate] = useState(v?.planDueDate ?? '')
  const [notes, setNotes] = useState(v?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => { nameRef.current?.focus(); if (mode === 'edit') nameRef.current?.select() })
  }, [mode])

  const urgent = section === 'urgent'
  const currentInactive = v && !activeAccounts.some((a) => a.id === v.accountId) ? v : null
  const listId = `cmr-rv-rec-${uid}`

  function buildBody(): Record<string, unknown> | string {
    if (!vendorName.trim()) return 'Enter a vendor name.'
    if (!accountId) return 'Choose an account.'
    if (amountCents === null) return 'Enter an amount (0 is fine if it varies).'
    const fields = {
      vendorName: vendorName.trim(),
      accountId,
      section,
      amountCents,
      recurrenceDetail: blankToNull(recurrence),
      notes: blankToNull(notes),
      planTerms: urgent ? blankToNull(planTerms) : null,
      planDueDate: urgent ? planDueDate || null : null,
    }
    if (mode === 'add') return fields

    // Edit: send only what changed. Leaving Urgent clears plan fields on the server.
    const out: Record<string, unknown> = {}
    const base = v!
    if (fields.vendorName !== base.vendorName) out.vendorName = fields.vendorName
    if (fields.accountId !== base.accountId) out.accountId = fields.accountId
    if (fields.section !== base.section) out.section = fields.section
    if (fields.amountCents !== base.amountCents) out.amountCents = fields.amountCents
    if (lastSentCents !== base.lastAmountSentCents) out.lastAmountSentCents = lastSentCents
    if (fields.recurrenceDetail !== base.recurrenceDetail) out.recurrenceDetail = fields.recurrenceDetail
    if (fields.notes !== base.notes) out.notes = fields.notes
    if (urgent) {
      if (fields.planTerms !== base.planTerms) out.planTerms = fields.planTerms
      if (fields.planDueDate !== base.planDueDate) out.planDueDate = fields.planDueDate
    }
    return out
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = buildBody()
    if (typeof body === 'string') { setError(body); return }
    setError(null)
    setSaving(true)
    await onSubmit(body)
    setSaving(false)
  }

  const heading = mode === 'add' ? `New ${CMR_RECURRING_SECTION_LABEL[section]} vendor` : `Edit ${v!.vendorName}`

  return (
    <form
      className="cmr-rv-form"
      onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      aria-label={heading}
      noValidate
    >
      <datalist id={listId}>
        {CMR_RECURRENCE_SUGGESTIONS[section].map((s) => <option key={s} value={s} />)}
      </datalist>

      <label className="cmr-field span2">
        <span className="cmr-label">Vendor</span>
        <input
          ref={nameRef}
          className="cmr-input"
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          maxLength={CMR_VENDOR_NAME_MAX}
          placeholder="e.g. Fleet fuel card"
          autoComplete="off"
          required
        />
      </label>

      <label className="cmr-field">
        <span className="cmr-label">Account</span>
        <Select value={accountId} onChange={setAccountId} ariaLabel="Account">
          <option value="" disabled>Choose an account…</option>
          {currentInactive && (
            <option value={currentInactive.accountId} disabled>
              {currentInactive.accountName} (inactive — choose another)
            </option>
          )}
          {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </label>

      <label className="cmr-field">
        <span className="cmr-label">Section</span>
        <Select value={section} onChange={(s) => setSection(s as CmrRecurringSection)} ariaLabel="Section">
          {CMR_RECURRING_SECTIONS.map((s) => <option key={s} value={s}>{CMR_RECURRING_SECTION_LABEL[s]}</option>)}
        </Select>
      </label>

      <label className="cmr-field">
        <span className="cmr-label">Amount</span>
        <span className="cmr-money">
          <span aria-hidden="true">$</span>
          <MoneyInput valueCents={amountCents} onChangeCents={setAmountCents} placeholder="0.00" ariaLabel="Amount" />
        </span>
      </label>

      <label className="cmr-field">
        <span className="cmr-label">Recurrence <span className="opt">(optional)</span></span>
        <input
          className="cmr-input"
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
          maxLength={CMR_RECURRENCE_MAX}
          list={listId}
          placeholder={section === 'monthly' ? '1st of the month' : 'Every Thursday'}
          autoComplete="off"
        />
      </label>

      {mode === 'edit' && (
        <label className="cmr-field">
          <span className="cmr-label">Last amount sent <span className="opt">(optional)</span></span>
          <span className="cmr-money">
            <span aria-hidden="true">$</span>
            <MoneyInput valueCents={lastSentCents} onChangeCents={setLastSentCents} placeholder="Not recorded" ariaLabel="Last amount sent" />
          </span>
        </label>
      )}

      {urgent && (
        <>
          <label className="cmr-field span2">
            <span className="cmr-label">Plan terms <span className="opt">(optional)</span></span>
            <input
              className="cmr-input"
              value={planTerms}
              onChange={(e) => setPlanTerms(e.target.value)}
              maxLength={CMR_PLAN_TERMS_MAX}
              placeholder="e.g. $1,500/week until paid"
              autoComplete="off"
            />
          </label>
          <label className="cmr-field">
            <span className="cmr-label">Plan due date <span className="opt">(optional)</span></span>
            <input className="cmr-input" type="date" value={planDueDate} onChange={(e) => setPlanDueDate(e.target.value)} />
          </label>
        </>
      )}
      {!urgent && mode === 'edit' && (v!.planTerms || v!.planDueDate) && (
        <p className="cmr-rv-formnote span-all">Moving out of Urgent Payment Plans clears this vendor&rsquo;s plan terms and due date.</p>
      )}

      <label className="cmr-field span-all">
        <span className="cmr-label">Notes <span className="opt">(optional)</span></span>
        <textarea
          className="cmr-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={CMR_VENDOR_NOTES_MAX}
          rows={2}
        />
      </label>

      {error && <p className="cmr-rv-formerr span-all" role="alert">{error}</p>}

      <div className="acts span-all">
        <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="cmr-btn sm" disabled={saving}>
          <CmrIcon name={mode === 'add' ? 'plus' : 'check'} size={14} />
          {saving ? 'Saving…' : mode === 'add' ? 'Add vendor' : 'Save'}
        </button>
      </div>
    </form>
  )
}
