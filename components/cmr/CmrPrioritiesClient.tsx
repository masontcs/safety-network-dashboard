'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import MoneyInput from '@/components/billing/MoneyInput'
import Toggle from '@/components/billing/Toggle'
import CmrIcon from '@/components/cmr/CmrIcon'
import { useAlert, useConfirm } from '@/components/ui/DialogProvider'
import { formatCents } from '@/lib/cmr/ledger'
import {
  CMR_PRIORITY_DESCRIPTION_MAX,
  CMR_PRIORITY_NOTES_MAX,
  CMR_PRIORITY_STATUS_LABEL,
  canCarryPriority,
  initialsOf,
  isDone,
  isPriorityHistory,
  type CmrPrioritiesView,
  type CmrPriority,
  type CmrPriorityWritableStatus,
} from '@/lib/cmr/priorities'
import { formatWeekRange, formatDueDate, formatWeekRangeShort, shiftWeek, weekStartSunday } from '@/lib/cmr/week'

/**
 * Weekly priorities — what has to be paid or handled in one Sunday → Saturday week.
 *
 * Every CMR role reads this screen. Only a Controller (`canEdit` from the API) gets the edit
 * controls: add (amount optional), edit, flag / unflag Top, resolve, mark paid, reopen / unpay,
 * CARRY to another week, delete (in-app confirm — never window.confirm) and reorder (@dnd-kit
 * drag — pointer or keyboard — plus up/down buttons, WCAG 2.5.7). Hiding controls is cosmetic:
 * /api/cmr/priorities re-checks the Controller role on every write.
 *
 * Carrying keeps the history: the priority stays in this week greyed and marked "carried to …",
 * and because it is no longer open it drops straight out of "still needed this week". The copy
 * in the target week is the live one and shows "carried from …".
 *
 * The week is in the URL (?week=YYYY-MM-DD, its Sunday) so a view can be reloaded or shared.
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

type Mode = null | { kind: 'add' } | { kind: 'edit'; id: string }

// Drag only moves up/down.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const blankToNull = (s: string): string | null => (s.trim() ? s.trim() : null)

const STAMP_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** An amount, or nothing for a task with no dollar figure. */
const amountText = (c: number): string => (c > 0 ? formatCents(c) : '')

export default function CmrPrioritiesClient({ initialWeek }: { initialWeek: string }) {
  const confirm = useConfirm()
  const alert = useAlert()

  const [week, setWeek] = useState(initialWeek)
  const [view, setView] = useState<CmrPrioritiesView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState<Mode>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const [carrying, setCarrying] = useState<CmrPriority | null>(null)

  const weekRef = useRef(week)
  weekRef.current = week
  const seq = useRef(0)
  const focusRefs = useRef(new Map<string, HTMLElement>())
  const refFor = (key: string) => (el: HTMLElement | null) => {
    if (el) focusRefs.current.set(key, el)
    else focusRefs.current.delete(key)
  }
  const focusLater = (key: string) => requestAnimationFrame(() => focusRefs.current.get(key)?.focus())

  const load = useCallback(async (w: string) => {
    const mine = ++seq.current
    const r = await api<CmrPrioritiesView>(`/api/cmr/priorities?week=${encodeURIComponent(w)}`)
    if (mine !== seq.current) return // a newer week was requested meanwhile
    if (!r.success) {
      if (r.code === 'UNAUTHORIZED') { window.location.href = '/login'; return }
      if (r.code === 'FORBIDDEN') { window.location.href = '/cmr/no-access'; return }
      setLoadError(r.error)
      return
    }
    setLoadError(null)
    setView(r.data)
  }, [])
  const reload = useCallback(() => load(weekRef.current), [load])

  useEffect(() => { void load(week) }, [load, week])

  // Keep the address shareable / reload-safe.
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('week', week)
      window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`)
    } catch { /* non-browser */ }
  }, [week])

  function goTo(nextWeek: string) {
    if (nextWeek === week) return
    setMode(null)
    setWeek(nextWeek)
  }

  // The data on screen must be for the week in the controls; otherwise show a skeleton.
  const current = view && view.weekStart === week ? view : null
  const canEdit = current?.canEdit === true
  const locked = mode !== null || reordering || carrying !== null
  const isThisWeek = current ? current.thisWeekStart === week : false
  const thisWeek = view?.thisWeekStart ?? null
  const range = formatWeekRange(week)

  // ── writes (Controller only; the API re-checks) ──────────────────────────
  async function create(body: Record<string, unknown>): Promise<boolean> {
    const r = await api<{ priority: CmrPriority }>('/api/cmr/priorities', {
      method: 'POST',
      body: JSON.stringify({ weekStart: weekRef.current, ...body }),
    })
    if (!r.success) { await alert({ title: 'Could not add the priority', message: r.error }); return false }
    const p = r.data.priority
    setStatus(`${p.description}${p.amountCents > 0 ? ` (${formatCents(p.amountCents)})` : ''} added.`)
    setMode(null)
    await reload()
    focusLater('add')
    return true
  }

  async function patch(p: CmrPriority, body: Record<string, unknown>, done: string, failTitle: string): Promise<boolean> {
    setBusyId(p.id)
    const r = await api<{ priority: CmrPriority; changed: boolean }>('/api/cmr/priorities', {
      method: 'PATCH',
      body: JSON.stringify({ id: p.id, ...body }),
    })
    setBusyId(null)
    if (!r.success) {
      await alert({ title: failTitle, message: r.error })
      if (r.code === 'NOT_FOUND' || r.code === 'NOT_EDITABLE') await reload()
      return false
    }
    setStatus(`${r.data.priority.description} ${done}.`)
    await reload()
    return true
  }

  async function saveEdit(p: CmrPriority, body: Record<string, unknown>): Promise<boolean> {
    if (Object.keys(body).length === 0) { setMode(null); focusLater(`edit:${p.id}`); return true }
    const ok = await patch(p, body, 'saved', 'Could not save the priority')
    if (ok) { setMode(null); focusLater(`edit:${p.id}`) }
    return ok
  }

  async function setTop(p: CmrPriority, top: boolean) {
    await patch(p, { isTopPriority: top }, top ? 'marked top priority' : 'no longer a top priority', 'Could not change the flag')
    focusLater(`star:${p.id}`)
  }

  const STATUS_DONE: Record<CmrPriorityWritableStatus, string> = { open: 'reopened', resolved: 'resolved', paid: 'marked paid' }

  async function setStatusOf(p: CmrPriority, next: CmrPriorityWritableStatus) {
    if (p.status === 'paid' && next !== 'paid') {
      const ok = await confirm({
        title: `Mark ${p.description} unpaid?`,
        message: `This clears the paid stamp${p.paidAt ? ` (${STAMP_FMT.format(new Date(p.paidAt))}${p.paidByName ? `, ${p.paidByName}` : ''})` : ''} and ${next === 'open' ? 'puts it back in what’s still needed this week' : 'marks it resolved instead'}. The change is recorded in the audit log.`,
        confirmLabel: next === 'open' ? 'Mark unpaid' : 'Mark resolved',
      })
      if (!ok) return
    }
    await patch(p, { status: next }, STATUS_DONE[next], 'Could not change the status')
    focusLater(`status:${p.id}`)
  }

  async function remove(p: CmrPriority) {
    const ok = await confirm({
      title: `Delete “${p.description}”?`,
      message: `This removes the priority${p.amountCents > 0 ? ` (${formatCents(p.amountCents)})` : ''} from the week of ${formatWeekRangeShort(p.weekStart)}. The deletion is recorded in the audit log.`,
      confirmLabel: 'Delete priority',
      danger: true,
    })
    if (!ok) return
    setBusyId(p.id)
    const r = await api<{ deleted: boolean }>(`/api/cmr/priorities?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not delete the priority', message: r.error }); return }
    setStatus(`${p.description} deleted.`)
    await reload()
    focusLater('add')
  }

  async function carry(p: CmrPriority, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(p.id)
    const r = await api<{ where: string; to: { weekStart: string } }>('/api/cmr/priorities/carry', {
      method: 'POST',
      body: JSON.stringify({ id: p.id, ...body }),
    })
    setBusyId(null)
    if (!r.success) {
      await alert({ title: 'Could not carry the priority', message: r.error })
      if (r.code === 'NOT_FOUND' || r.code === 'NOT_OPEN') { setCarrying(null); await reload() }
      return false
    }
    setStatus(`${p.description} carried to the week of ${r.data.where}. It stays in this week as history.`)
    setCarrying(null)
    await reload()
    focusLater('add')
    return true
  }

  // Optimistic reorder; one at a time; rolled back if the save fails.
  async function reorder(next: CmrPriority[], movedId: string) {
    const prev = current
    if (!prev || reordering) return
    setView({ ...prev, priorities: next.map((p, i) => ({ ...p, sortOrder: i })) })
    setReordering(true)
    const ids = next.map((p) => p.id)
    const r = await api<{ changed: boolean }>('/api/cmr/priorities/reorder', {
      method: 'POST',
      body: JSON.stringify({ weekStart: prev.weekStart, ids }),
    })
    setReordering(false)
    if (!r.success) {
      setView(prev)
      await alert({ title: 'Could not save the new order', message: r.error })
      if (r.code === 'STALE') await reload()
      return
    }
    const name = next.find((p) => p.id === movedId)?.description ?? 'Priority'
    setStatus(`${name} moved to position ${ids.indexOf(movedId) + 1} of ${ids.length}.`)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const list = current?.priorities ?? []

  return (
    <>
      <header className="cmr-pagehead cmr-lg-head">
        <div>
          <h1 className="cmr-serif">Weekly priorities</h1>
          <p>
            <time dateTime={week}>{range}</time> · Sunday to Saturday · Pacific
          </p>
        </div>
        <div className="actions">
          <div className="cmr-lg-datenav cmr-pr-weeknav" role="group" aria-label="Choose the week">
            <button type="button" className="cmr-iconbtn sm" onClick={() => goTo(shiftWeek(week, -1))} aria-label="Previous week" title="Previous week">
              <CmrIcon name="left" />
            </button>
            <span className="cmr-pr-weeklabel cmr-num" aria-live="polite">
              {formatWeekRangeShort(week)}
            </span>
            <button type="button" className="cmr-iconbtn sm" onClick={() => goTo(shiftWeek(week, 1))} aria-label="Next week" title="Next week">
              <CmrIcon name="right" />
            </button>
          </div>
          <button
            type="button"
            className="cmr-btn sm ghost"
            onClick={() => thisWeek && goTo(thisWeek)}
            disabled={!thisWeek || week === thisWeek}
          >
            This week
          </button>
        </div>
      </header>

      <p className="cmr-sr-only" role="status" aria-live="polite">{status}</p>

      {current && !canEdit && (
        <div className="cmr-notice" style={{ marginBottom: 18 }}>
          <CmrIcon name="lock" size={14} />
          <span>You can view weekly priorities. Only a Controller can change them.</span>
        </div>
      )}

      {loadError && (
        <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <button type="button" className="cmr-btn sm ghost" onClick={() => void reload()}>Retry</button>
        </div>
      )}

      {!current && !loadError && (
        <div aria-busy="true" aria-label={`Loading priorities for ${range}`}>
          <div className="cmr-hero cmr-lg-hero">
            <div className="l">
              <span className="cmr-skel" style={{ width: 140, height: 10, opacity: 0.35 }} />
              <span className="cmr-skel" style={{ width: 240, height: 38, margin: '14px 0 10px', opacity: 0.35 }} />
              <span className="cmr-skel" style={{ width: 180, height: 10, opacity: 0.35 }} />
            </div>
          </div>
          <div className="cmr-card">
            {[0, 1, 2].map((i) => (
              <div className="cmr-row" key={i}>
                <span className="cmr-skel" style={{ width: '34%', height: 12 }} />
                <span className="cmr-skel" style={{ width: 70, height: 12, marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {current && (
        <>
          <TotalsHero view={current} isThisWeek={isThisWeek} />

          <section className="cmr-sec" aria-labelledby="cmr-pr-list-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-pr-list-title">Priorities</h2>
                <span className="c">
                  {plural(current.totals.count, 'priority', 'priorities')}
                  {current.totals.count > 0 && ` · ${current.totals.openCount} open`}
                </span>
              </div>
              <span className="tot">
                {reordering ? (
                  <span aria-hidden="true">Saving order…</span>
                ) : (
                  <>Still needed <b className="cmr-num">{formatCents(current.totals.neededCents)}</b></>
                )}
              </span>
              {canEdit && (
                <button
                  type="button"
                  ref={refFor('add')}
                  className="cmr-btn sm ghost"
                  onClick={() => setMode({ kind: 'add' })}
                  disabled={locked}
                  aria-label="Add a priority for this week"
                >
                  <CmrIcon name="plus" size={14} /> Add priority
                </button>
              )}
            </div>

            <div className="cmr-card">
              {list.length === 0 && mode?.kind !== 'add' && (
                <div className="cmr-lg-empty">
                  Nothing on the list for this week{canEdit ? ' yet — add what has to be paid or handled, with or without an amount.' : '.'}
                </div>
              )}

              {list.length > 0 && (
                <PriorityList enabled={canEdit} items={list} sensors={sensors} onOrder={(next, moved) => void reorder(next, moved)}>
                  {list.map((p, i) => (
                    <PriorityRow
                      key={p.id}
                      p={p}
                      index={i}
                      total={list.length}
                      today={current.today}
                      canEdit={canEdit}
                      busy={busyId === p.id}
                      locked={locked}
                      editing={mode?.kind === 'edit' && mode.id === p.id}
                      refFor={refFor}
                      onEdit={() => setMode({ kind: 'edit', id: p.id })}
                      onSave={(b) => saveEdit(p, b)}
                      onCancel={() => { setMode(null); focusLater(`edit:${p.id}`) }}
                      onDelete={() => void remove(p)}
                      onTop={(t) => void setTop(p, t)}
                      onStatus={(s) => void setStatusOf(p, s)}
                      onCarry={() => setCarrying(p)}
                      onMove={(d) => {
                        const to = i + d
                        if (to < 0 || to >= list.length) return
                        void reorder(arrayMove(list, i, to), p.id)
                      }}
                    />
                  ))}
                </PriorityList>
              )}

              {canEdit && mode?.kind === 'add' && (
                <div className="cmr-lg-addwrap">
                  <PriorityForm
                    weekLabel={formatWeekRangeShort(week)}
                    onSubmit={create}
                    onCancel={() => { setMode(null); focusLater('add') }}
                  />
                </div>
              )}

              {list.length > 0 && (
                <div className="cmr-row cmr-lg-row cmr-lg-total">
                  <div className="who">
                    <span className="desc">Still needed this week</span>
                    <span className="mt">
                      Open priorities only · {formatCents(current.totals.paidResolvedCents)} paid or resolved · {formatCents(current.totals.totalCents)} in all
                    </span>
                  </div>
                  <span className="amt cmr-num">{formatCents(current.totals.neededCents)}</span>
                </div>
              )}
            </div>
          </section>

          {canEdit && list.length > 1 && (
            <p className="cmr-hint">
              Drag the <CmrIcon name="grip" size={12} /> handle or use the arrows to reorder. The star marks a top priority.
              Carry moves an unfinished priority to another week — it stays here as history and comes off what’s still needed.
            </p>
          )}
        </>
      )}

      {carrying && current && (
        <CarryDialog
          p={carrying}
          thisWeekStart={current.thisWeekStart}
          busy={busyId === carrying.id}
          onCarry={(b) => carry(carrying, b)}
          onCancel={() => { const id = carrying.id; setCarrying(null); focusLater(`carry:${id}`) }}
        />
      )}
    </>
  )
}

// ── the Carry dialog (in-app; never a native prompt) ────────────────────────

function CarryDialog({
  p,
  thisWeekStart,
  busy,
  onCarry,
  onCancel,
}: {
  p: CmrPriority
  thisWeekStart: string
  busy: boolean
  onCarry: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  // The default IS the answer most weeks: the week after the one it is in.
  const [week, setWeek] = useState(shiftWeek(p.weekStart, 1))
  const [saving, setSaving] = useState(false)

  const wrap = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => { requestAnimationFrame(() => firstRef.current?.focus()) }, [])

  // Escape closes; Tab is kept inside the dialog while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }
      if (e.key !== 'Tab' || !wrap.current) return
      const items = wrap.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await onCarry({ targetWeek: week })
    setSaving(false)
  }

  const busyNow = saving || busy
  const sameWeek = week === p.weekStart

  return (
    <div className="cmr-rq-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div
        ref={wrap}
        className="cmr-rq-dialog cmr-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmr-pr-carry-title"
        aria-describedby="cmr-pr-carry-desc"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="cmr-pr-carry-title" className="cmr-serif">Carry {p.description}</h2>
        <p id="cmr-pr-carry-desc">
          {p.amountCents > 0 ? `${formatCents(p.amountCents)} · ` : ''}now in the week of {formatWeekRangeShort(p.weekStart)}
          {p.isTopPriority ? ' · top priority' : ''}
        </p>

        <form onSubmit={submit} noValidate>
          <div className="cmr-rq-dialogfields">
            <label className="cmr-field">
              <span className="cmr-label">Week</span>
              <input
                ref={firstRef}
                className="cmr-input"
                type="date"
                value={week}
                min="2000-01-01"
                max="2100-12-31"
                onChange={(e) => setWeek(e.target.value ? weekStartSunday(e.target.value) : week)}
                disabled={busyNow}
                required
              />
            </label>
            <div className="cmr-field cmr-rq-weekjump">
              <span className="cmr-label">Jump</span>
              <div className="cmr-seg cmr-lg-dir" role="group" aria-label="Move a week">
                <button type="button" onClick={() => setWeek(shiftWeek(week, -1))} disabled={busyNow} aria-label="The week before">
                  <CmrIcon name="left" size={14} />
                </button>
                <button type="button" onClick={() => setWeek(shiftWeek(p.weekStart, 1))} disabled={busyNow}>Next week</button>
                <button type="button" onClick={() => setWeek(shiftWeek(week, 1))} disabled={busyNow} aria-label="The week after">
                  <CmrIcon name="right" size={14} />
                </button>
              </div>
            </div>
            <p className="cmr-rq-dialognote span-all">
              {sameWeek ? (
                <>That’s the week it’s already in — choose another one.</>
              ) : (
                <>
                  Moves to the week of <b>{formatWeekRangeShort(week)}</b>
                  {week === thisWeekStart ? ' (this week)' : ''}, open, keeping its amount, due date, notes and Top flag. It
                  stays in {formatWeekRangeShort(p.weekStart)} as history and comes off what’s still needed there.
                </>
              )}
            </p>
          </div>

          <div className="acts">
            <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={busyNow}>Cancel</button>
            <button type="submit" className="cmr-btn sm" disabled={busyNow || sameWeek}>
              <CmrIcon name="right" size={14} />
              {busyNow ? 'Carrying…' : 'Carry it forward'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── totals masthead ─────────────────────────────────────────────────────────

function TotalsHero({ view, isThisWeek }: { view: CmrPrioritiesView; isThisWeek: boolean }) {
  const { totals } = view
  const whole = formatCents(totals.neededCents)
  const dot = whole.lastIndexOf('.')
  return (
    <section className="cmr-hero cmr-lg-hero" aria-labelledby="cmr-pr-hero-cap">
      <div className="l">
        <h2 className="cmr-hero-cap" id="cmr-pr-hero-cap">
          Needed this week
          {isThisWeek && <span className="cmr-lg-chip">This week</span>}
        </h2>
        <p className="cmr-hero-big cmr-serif cmr-num">
          {whole.slice(0, dot)}
          <span className="c">{whole.slice(dot)}</span>
        </p>
        <div className="cmr-hero-rule" aria-hidden="true" />
        <p className="cmr-hero-meta">
          <b>{plural(totals.openCount, 'open priority', 'open priorities')}</b>
          {' · '}
          {totals.topPriorityCount === 0
            ? 'no top priorities'
            : `${plural(totals.topPriorityCount, 'top priority', 'top priorities')} (${totals.openTopPriorityCount} still open)`}
        </p>
      </div>
      <dl className="cmr-lg-stmt">
        <div>
          <dt>Still needed (open)</dt>
          <dd className="cmr-num">{formatCents(totals.neededCents)}</dd>
        </div>
        <div>
          <dt>Paid / resolved</dt>
          <dd className="cmr-num">{formatCents(totals.paidResolvedCents)}</dd>
        </div>
        <div>
          <dt>Top priorities</dt>
          <dd className="cmr-num">{totals.topPriorityCount}</dd>
        </div>
        <div className="total">
          <dt>Week total</dt>
          <dd className="cmr-num">{formatCents(totals.totalCents)}</dd>
        </div>
      </dl>
    </section>
  )
}

// ── sortable list ───────────────────────────────────────────────────────────

function PriorityList({
  enabled,
  items,
  sensors,
  onOrder,
  children,
}: {
  enabled: boolean
  items: CmrPriority[]
  sensors: ReturnType<typeof useSensors>
  onOrder: (next: CmrPriority[], movedId: string) => void
  children: React.ReactNode
}) {
  const announcements: Announcements = useMemo(() => {
    const name = (id: UniqueIdentifier | undefined) => items.find((x) => x.id === id)?.description ?? 'priority'
    const pos = (id: UniqueIdentifier | undefined) => items.findIndex((x) => x.id === id) + 1
    const n = items.length
    return {
      onDragStart: ({ active }) => `Picked up ${name(active.id)}, position ${pos(active.id)} of ${n}.`,
      onDragOver: ({ active, over }) =>
        over ? `${name(active.id)} is over position ${pos(over.id)} of ${n}.` : `${name(active.id)} is no longer over the list.`,
      onDragEnd: ({ active, over }) => (over ? `${name(active.id)} dropped at position ${pos(over.id)} of ${n}.` : `${name(active.id)} dropped.`),
      onDragCancel: ({ active }) => `Reorder cancelled. ${name(active.id)} returned to position ${pos(active.id)}.`,
    }
  }, [items])

  if (!enabled) return <ul className="cmr-lg-list" aria-label="This week’s priorities">{children}</ul>

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = items.findIndex((x) => x.id === active.id)
    const to = items.findIndex((x) => x.id === over.id)
    if (from < 0 || to < 0) return
    onOrder(arrayMove(items, from, to), String(active.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To reorder, press Space or Enter to pick up the priority, use the up and down arrow keys to move it, then press Space or Enter to drop it, or Escape to cancel.',
        },
      }}
    >
      <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        <ul className="cmr-lg-list" aria-label="This week’s priorities, in order">{children}</ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableLi({
  p,
  index,
  total,
  className,
  disabled,
  busy,
  children,
}: {
  p: CmrPriority
  index: number
  total: number
  className: string
  disabled: boolean
  busy: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: p.id, disabled })
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  return (
    <li ref={setNodeRef} style={style} className={className} data-dragging={isDragging || undefined} aria-busy={busy || undefined}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="cmr-handle"
        aria-label={`Reorder ${p.description}, position ${index + 1} of ${total}`}
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

// ── one priority ────────────────────────────────────────────────────────────

function PriorityRow({
  p,
  index,
  total,
  today,
  canEdit,
  busy,
  locked,
  editing,
  refFor,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onTop,
  onStatus,
  onCarry,
  onMove,
}: {
  p: CmrPriority
  index: number
  total: number
  today: string
  canEdit: boolean
  busy: boolean
  locked: boolean
  editing: boolean
  refFor: (key: string) => (el: HTMLElement | null) => void
  onEdit: () => void
  onSave: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
  onDelete: () => void
  onTop: (top: boolean) => void
  onStatus: (s: CmrPriorityWritableStatus) => void
  onCarry: () => void
  onMove: (delta: -1 | 1) => void
}) {
  const done = isDone(p.status)
  const carried = isPriorityHistory(p)
  const overdue = p.status === 'open' && p.dueDate !== null && p.dueDate < today
  const cls = [
    'cmr-row',
    'cmr-lg-row',
    'cmr-pr-row',
    p.isTopPriority ? 'top' : '',
    done || carried ? 'done' : '',
    p.status === 'paid' ? 'paid' : '',
    editing ? 'editing' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const disabled = locked || busy
  const year = today.slice(0, 4)

  const star = canEdit ? (
    <button
      type="button"
      ref={refFor(`star:${p.id}`)}
      className={`cmr-pr-star${p.isTopPriority ? ' on' : ''}`}
      aria-pressed={p.isTopPriority}
      aria-label={`Top priority: ${p.description}`}
      title={p.isTopPriority ? 'Top priority — click to unflag' : 'Mark as a top priority'}
      onClick={() => onTop(!p.isTopPriority)}
      disabled={disabled || carried}
    >
      <CmrIcon name="star" />
    </button>
  ) : (
    <span className={`cmr-pr-star static${p.isTopPriority ? ' on' : ''}`} aria-hidden="true">
      {p.isTopPriority && <CmrIcon name="star" />}
    </span>
  )

  const body = (
    <>
      <div className="who">
        <span className="desc">
          <span className="nm">{p.description}</span>
          {p.isTopPriority && (
            <span className="cmr-pill top"><span className="pd" /> Top</span>
          )}
          {p.status !== 'open' && (
            <span className={`cmr-pill ${p.status === 'carried' ? 'viewer' : 'ok'}`}>
              {p.status !== 'carried' && <CmrIcon name="check" size={11} />}
              {CMR_PRIORITY_STATUS_LABEL[p.status]}
            </span>
          )}
          {overdue && <span className="cmr-pill danger">Overdue</span>}
        </span>
        <PriorityMeta p={p} year={year} />
        {p.notes && <span className="note">{p.notes}</span>}
      </div>
      <span className="amt cmr-num">
        {p.amountCents > 0 ? amountText(p.amountCents) : <span className="cmr-sr-only">No amount</span>}
      </span>
    </>
  )

  if (!canEdit) {
    return (
      <li className={cls}>
        {star}
        {body}
      </li>
    )
  }

  return (
    <SortableLi p={p} index={index} total={total} className={cls} disabled={disabled} busy={busy}>
      {editing ? (
        <div className="cmr-lg-editwrap">
          <PriorityForm initial={p} onSubmit={onSave} onCancel={onCancel} />
        </div>
      ) : (
        <>
          {star}
          {body}
          <div className="ctl">
            {!carried && (
              <div className="cmr-pr-status" role="group" aria-label={`Status of ${p.description}: ${CMR_PRIORITY_STATUS_LABEL[p.status]}`}>
                {p.status === 'open' ? (
                  <>
                    <button type="button" ref={refFor(`status:${p.id}`)} className="cmr-btn sm ghost" onClick={() => onStatus('resolved')} disabled={disabled} aria-label={`Resolve ${p.description}`}>
                      Resolve
                    </button>
                    <button type="button" className="cmr-btn sm ghost cmr-pr-pay" onClick={() => onStatus('paid')} disabled={disabled} aria-label={`Mark ${p.description} paid`}>
                      <CmrIcon name="check" size={14} /> Mark paid
                    </button>
                  </>
                ) : p.status === 'resolved' ? (
                  <>
                    <button type="button" ref={refFor(`status:${p.id}`)} className="cmr-btn sm ghost" onClick={() => onStatus('open')} disabled={disabled} aria-label={`Reopen ${p.description}`}>
                      <CmrIcon name="undo" size={14} /> Reopen
                    </button>
                    <button type="button" className="cmr-btn sm ghost cmr-pr-pay" onClick={() => onStatus('paid')} disabled={disabled} aria-label={`Mark ${p.description} paid`}>
                      <CmrIcon name="check" size={14} /> Mark paid
                    </button>
                  </>
                ) : (
                  <button type="button" ref={refFor(`status:${p.id}`)} className="cmr-btn sm ghost" onClick={() => onStatus('open')} disabled={disabled} aria-label={`Mark ${p.description} unpaid`}>
                    <CmrIcon name="undo" size={14} /> Unpay
                  </button>
                )}
                {canCarryPriority(p) && (
                  <button
                    type="button"
                    ref={refFor(`carry:${p.id}`)}
                    className="cmr-btn sm ghost"
                    onClick={onCarry}
                    disabled={disabled}
                    aria-label={`Carry ${p.description} to another week`}
                    title="Carry to another week"
                  >
                    <CmrIcon name="right" size={14} /> Carry
                  </button>
                )}
              </div>
            )}
            <div className="moves">
              <button type="button" className="cmr-iconbtn sm" onClick={() => onMove(-1)} disabled={disabled || index === 0} aria-label={`Move ${p.description} up`} title="Move up">
                <CmrIcon name="up" />
              </button>
              <button type="button" className="cmr-iconbtn sm" onClick={() => onMove(1)} disabled={disabled || index === total - 1} aria-label={`Move ${p.description} down`} title="Move down">
                <CmrIcon name="down" />
              </button>
            </div>
            {!carried && (
              <button type="button" ref={refFor(`edit:${p.id}`)} className="cmr-btn sm ghost" onClick={onEdit} disabled={disabled} aria-label={`Edit ${p.description}`} title="Edit">
                <CmrIcon name="edit" size={14} /> <span className="cmr-pr-lbl">Edit</span>
              </button>
            )}
            {!carried && (
              <button type="button" className="cmr-iconbtn sm danger" onClick={onDelete} disabled={disabled} aria-label={`Delete ${p.description}`} title="Delete">
                <CmrIcon name="trash" />
              </button>
            )}
          </div>
        </>
      )}
    </SortableLi>
  )
}

/**
 * The second line of a priority: the due date, where it was carried to (on the original the
 * week keeps) or came from (on the copy), and the paid stamp. Read-only for every role.
 */
function PriorityMeta({ p, year }: { p: CmrPriority; year: string }) {
  const bits: React.ReactNode[] = []
  if (p.dueDate) {
    bits.push(
      <span key="due">
        Due <time dateTime={p.dueDate}>{formatDueDate(p.dueDate, year)}</time>
      </span>,
    )
  }
  if (p.carriedToWeek) {
    bits.push(<span key="to">Carried to the week of {formatWeekRangeShort(p.carriedToWeek)}</span>)
  } else if (p.status === 'carried') {
    bits.push(<span key="to">Carried to another week</span>)
  }
  if (p.carriedFromWeek) {
    bits.push(<span key="from">Carried from the week of {formatWeekRangeShort(p.carriedFromWeek)}</span>)
  }
  if (p.status === 'paid' && p.paidAt) {
    bits.push(
      <span key="paid" className="cmr-pr-stamp">
        Paid {STAMP_FMT.format(new Date(p.paidAt))}
        {p.paidByName && (
          <>
            {' · '}
            <abbr title={p.paidByName}>{initialsOf(p.paidByName)}</abbr>
          </>
        )}
      </span>,
    )
  }
  if (!bits.length) return null
  return (
    <span className="mt">
      {bits.map((b, i) => (
        <React.Fragment key={i}>
          {i > 0 && ' · '}
          {b}
        </React.Fragment>
      ))}
    </span>
  )
}

// ── add / edit form ─────────────────────────────────────────────────────────

function PriorityForm({
  initial,
  weekLabel,
  onSubmit,
  onCancel,
}: {
  initial?: CmrPriority
  weekLabel?: string
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  const [description, setDescription] = useState(initial?.description ?? '')
  // null = no dollar figure. An existing $0 priority edits as blank.
  const [amount, setAmount] = useState<number | null>(initial && initial.amountCents > 0 ? initial.amountCents : null)
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [top, setTop] = useState(initial?.isTopPriority ?? false)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => { nameRef.current?.focus(); if (initial) nameRef.current?.select() })
  }, [initial])

  function build(): Record<string, unknown> | string {
    if (!description.trim()) return 'Enter a description.'
    const fields = {
      description: description.trim(),
      amountCents: amount ?? 0,
      dueDate: dueDate || null,
      notes: blankToNull(notes),
      isTopPriority: top,
    }
    if (!initial) return fields
    const out: Record<string, unknown> = {}
    if (fields.description !== initial.description) out.description = fields.description
    if (fields.amountCents !== initial.amountCents) out.amountCents = fields.amountCents
    if (fields.dueDate !== initial.dueDate) out.dueDate = fields.dueDate
    if (fields.notes !== initial.notes) out.notes = fields.notes
    if (fields.isTopPriority !== initial.isTopPriority) out.isTopPriority = fields.isTopPriority
    return out
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = build()
    if (typeof body === 'string') { setError(body); return }
    setError(null)
    setSaving(true)
    await onSubmit(body)
    setSaving(false)
  }

  const uid = initial?.id ?? 'new'
  return (
    <form
      className="cmr-rv-form cmr-lg-form cmr-pr-form"
      onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      aria-label={initial ? `Edit ${initial.description}` : `New priority for ${weekLabel ?? 'this week'}`}
      noValidate
    >
      <label className="cmr-field span2">
        <span className="cmr-label">What needs to be paid or handled</span>
        <input
          ref={nameRef}
          className="cmr-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={CMR_PRIORITY_DESCRIPTION_MAX}
          placeholder="e.g. CDTFA sales tax"
          autoComplete="off"
          required
        />
      </label>

      <label className="cmr-field">
        <span className="cmr-label">Amount <span className="opt">(optional)</span></span>
        <span className="cmr-money">
          <span aria-hidden="true">$</span>
          <MoneyInput valueCents={amount} onChangeCents={setAmount} placeholder="No amount" ariaLabel="Amount (optional)" />
        </span>
      </label>

      <label className="cmr-field">
        <span className="cmr-label">Due <span className="opt">(optional)</span></span>
        <input
          className="cmr-input"
          type="date"
          value={dueDate}
          min="2000-01-01"
          max="2100-12-31"
          onChange={(e) => setDueDate(e.target.value)}
          id={`cmr-pr-due-${uid}`}
        />
      </label>

      <label className="cmr-field span-all">
        <span className="cmr-label">Notes <span className="opt">(optional)</span></span>
        <textarea className="cmr-input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={CMR_PRIORITY_NOTES_MAX} rows={1} />
      </label>

      <div className="cmr-field cmr-pr-topfield">
        <Toggle checked={top} onChange={setTop} label="Top priority" ariaLabel="Top priority" />
      </div>

      {error && <p className="cmr-rv-formerr span-all" role="alert">{error}</p>}

      <div className="acts span-all">
        <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="cmr-btn sm" disabled={saving}>
          <CmrIcon name={initial ? 'check' : 'plus'} size={14} />
          {saving ? 'Saving…' : initial ? 'Save' : 'Add priority'}
        </button>
      </div>
    </form>
  )
}
