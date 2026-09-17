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
import Select from '@/components/billing/Select'
import MoneyInput from '@/components/billing/MoneyInput'
import CmrIcon from '@/components/cmr/CmrIcon'
import { useAlert, useConfirm } from '@/components/ui/DialogProvider'
import { pacificToday } from '@/lib/utils/date'
import {
  CMR_ADJ_DESCRIPTION_MAX,
  CMR_ADJ_NOTE_MAX,
  CMR_ADJ_WARN_MAX,
  CMR_LEDGER_PERIODS,
  CMR_LEDGER_PERIOD_LABEL,
  CMR_PAYEE_MAX,
  CMR_PENDING_NOTES_MAX,
  CMR_WARN_SUGGESTIONS,
  canPayPending,
  canPushPending,
  formatBalanceCents,
  formatCents,
  formatLedgerDate,
  formatSignedCents,
  formatWhere,
  isPendingHistory,
  parseLedgerDate,
  shiftLedgerDate,
  type CmrLedger,
  type CmrLedgerAccountRef,
  type CmrLedgerAdjustment,
  type CmrLedgerPeriod,
  type CmrLedgerView,
  type CmrPendingGroup,
  type CmrPendingItem,
} from '@/lib/cmr/ledger'
import { initialsOf } from '@/lib/cmr/priorities'

/**
 * Daily ledger — the Cash Ledger home (/cmr).
 *
 * One (date, period) snapshot at a time: AM and PM are independent. A statement-style header
 * shows beginning cash, the adjustments total, pending-in-bank and the current balance
 * (= beginning + adjustments − pending, all computed by the API). Below it: beginning cash, the
 * signed adjustment lines (with the derived pending roll-up as a locked line), and the pending
 * breakdown grouped by account with per-account subtotals and a grand total.
 *
 * Every CMR role reads this screen. Only a Controller (`canEdit` from the API) gets edit
 * controls — set beginning cash; add / edit / delete / reorder adjustment lines and pending
 * items (deletes confirm in-app; reorder is @dnd-kit drag plus up/down buttons, WCAG 2.5.7);
 * check a pending item off as PAID; and PUSH one to another day. Hiding controls is cosmetic:
 * /api/cmr/ledger/* re-checks the Controller role on every write.
 *
 * Pushing keeps the history: the item stays on this day greyed and marked "pushed to …", and
 * because a pushed item is left out of the roll-up it stops counting against this day's balance
 * at once. The copy on the target day shows "pushed from …". Paid items stay in the day's
 * breakdown and keep counting — the money left the bank here.
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

type Mode =
  | null
  | { kind: 'begin' }
  | { kind: 'addAdj' }
  | { kind: 'editAdj'; id: string }
  | { kind: 'addPending' }
  | { kind: 'editPending'; id: string }

// Drag only moves up/down.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const blankToNull = (s: string): string | null => (s.trim() ? s.trim() : null)

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export default function CmrLedgerClient({
  initialDate,
  initialPeriod,
}: {
  initialDate: string
  initialPeriod: CmrLedgerPeriod
}) {
  const confirm = useConfirm()
  const alert = useAlert()
  const today = useMemo(() => pacificToday(), [])

  const [date, setDate] = useState(initialDate)
  const [period, setPeriod] = useState<CmrLedgerPeriod>(initialPeriod)
  const [view, setView] = useState<CmrLedgerView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState<Mode>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reordering, setReordering] = useState<string | null>(null)
  const [pushing, setPushing] = useState<CmrPendingItem | null>(null)

  const keyRef = useRef({ date, period })
  keyRef.current = { date, period }
  const seq = useRef(0)
  const focusRefs = useRef(new Map<string, HTMLElement>())
  const refFor = (key: string) => (el: HTMLElement | null) => {
    if (el) focusRefs.current.set(key, el)
    else focusRefs.current.delete(key)
  }
  const focusLater = (key: string) => requestAnimationFrame(() => focusRefs.current.get(key)?.focus())

  const load = useCallback(async (d: string, p: CmrLedgerPeriod) => {
    const mine = ++seq.current
    const r = await api<CmrLedgerView>(`/api/cmr/ledger?date=${encodeURIComponent(d)}&period=${p}`)
    if (mine !== seq.current) return // a newer date/period was requested meanwhile
    if (!r.success) {
      if (r.code === 'UNAUTHORIZED') { window.location.href = '/login'; return }
      if (r.code === 'FORBIDDEN') { window.location.href = '/cmr/no-access'; return }
      setLoadError(r.error)
      return
    }
    setLoadError(null)
    setView(r.data)
  }, [])
  const reload = useCallback(() => load(keyRef.current.date, keyRef.current.period), [load])

  useEffect(() => { void load(date, period) }, [load, date, period])

  // Keep the address shareable / reload-safe.
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('date', date)
      u.searchParams.set('period', period)
      window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`)
    } catch { /* non-browser */ }
  }, [date, period])

  function goTo(nextDate: string, nextPeriod: CmrLedgerPeriod = period) {
    if (!parseLedgerDate(nextDate).ok) return
    if (nextDate === date && nextPeriod === period) return
    setMode(null)
    setDate(nextDate)
    setPeriod(nextPeriod)
  }

  // The data on screen must be for the date/period in the controls; otherwise show a skeleton.
  const current = view && view.ledger.ledgerDate === date && view.ledger.period === period ? view : null
  const canEdit = current?.canEdit === true
  const locked = mode !== null || reordering !== null || pushing !== null
  const periodLabel = CMR_LEDGER_PERIOD_LABEL[period]
  const dayLabel = formatLedgerDate(date)
  const isToday = date === today

  // ── writes (Controller only; the API re-checks) ──────────────────────────
  const key = () => ({ date: keyRef.current.date, period: keyRef.current.period })

  async function saveBeginning(cents: number): Promise<boolean> {
    const r = await api<{ ledger: CmrLedger; changed: boolean }>('/api/cmr/ledger', {
      method: 'PUT',
      body: JSON.stringify({ ...key(), beginningCashCents: cents }),
    })
    if (!r.success) { await alert({ title: 'Could not save beginning cash', message: r.error }); return false }
    setStatus(`Beginning cash set to ${formatBalanceCents(cents)}.`)
    setMode(null)
    await reload()
    focusLater('begin')
    return true
  }

  async function createAdjustment(body: Record<string, unknown>): Promise<boolean> {
    const r = await api<{ adjustment: CmrLedgerAdjustment }>('/api/cmr/ledger/adjustments', {
      method: 'POST',
      body: JSON.stringify({ ...key(), ...body }),
    })
    if (!r.success) { await alert({ title: 'Could not add the line', message: r.error }); return false }
    setStatus(`${r.data.adjustment.description} added (${formatSignedCents(r.data.adjustment.amountCents)}).`)
    setMode(null)
    await reload()
    focusLater('addAdj')
    return true
  }

  async function saveAdjustment(a: CmrLedgerAdjustment, body: Record<string, unknown>): Promise<boolean> {
    if (Object.keys(body).length === 0) { setMode(null); focusLater(`adj:${a.id}`); return true }
    setBusyId(a.id)
    const r = await api<{ adjustment: CmrLedgerAdjustment }>('/api/cmr/ledger/adjustments', {
      method: 'PATCH',
      body: JSON.stringify({ id: a.id, ...body }),
    })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not save the line', message: r.error }); return false }
    setStatus(`${r.data.adjustment.description} saved.`)
    setMode(null)
    await reload()
    focusLater(`adj:${a.id}`)
    return true
  }

  async function deleteAdjustment(a: CmrLedgerAdjustment) {
    const ok = await confirm({
      title: `Delete “${a.description}”?`,
      message: `This removes the ${formatSignedCents(a.amountCents)} line from the ${periodLabel} ledger for ${dayLabel}. The deletion is recorded in the audit log.`,
      confirmLabel: 'Delete line',
      danger: true,
    })
    if (!ok) return
    setBusyId(a.id)
    const r = await api<{ deleted: boolean }>(`/api/cmr/ledger/adjustments?id=${encodeURIComponent(a.id)}`, { method: 'DELETE' })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not delete the line', message: r.error }); return }
    setStatus(`${a.description} deleted.`)
    await reload()
    focusLater('addAdj')
  }

  async function createPending(body: Record<string, unknown>): Promise<boolean> {
    const r = await api<{ item: CmrPendingItem }>('/api/cmr/ledger/pending', {
      method: 'POST',
      body: JSON.stringify({ ...key(), ...body }),
    })
    if (!r.success) { await alert({ title: 'Could not add the pending item', message: r.error }); return false }
    setStatus(`${r.data.item.payee} (${formatCents(r.data.item.amountCents)}) added under ${r.data.item.accountName}.`)
    setMode(null)
    await reload()
    focusLater('addPending')
    return true
  }

  async function savePending(i: CmrPendingItem, body: Record<string, unknown>): Promise<boolean> {
    if (Object.keys(body).length === 0) { setMode(null); focusLater(`pend:${i.id}`); return true }
    setBusyId(i.id)
    const r = await api<{ item: CmrPendingItem }>('/api/cmr/ledger/pending', {
      method: 'PATCH',
      body: JSON.stringify({ id: i.id, ...body }),
    })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not save the pending item', message: r.error }); return false }
    setStatus(`${r.data.item.payee} saved.`)
    setMode(null)
    await reload()
    focusLater(`pend:${i.id}`)
    return true
  }

  async function deletePending(i: CmrPendingItem) {
    const ok = await confirm({
      title: `Delete ${i.payee}?`,
      message: `This removes the ${formatCents(i.amountCents)} pending item (${i.accountName}) from the ${periodLabel} ledger for ${dayLabel}. The deletion is recorded in the audit log.`,
      confirmLabel: 'Delete item',
      danger: true,
    })
    if (!ok) return
    setBusyId(i.id)
    const r = await api<{ deleted: boolean }>(`/api/cmr/ledger/pending?id=${encodeURIComponent(i.id)}`, { method: 'DELETE' })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not delete the pending item', message: r.error }); return }
    setStatus(`${i.payee} deleted.`)
    await reload()
    focusLater('addPending')
  }

  async function setPaid(i: CmrPendingItem, paid: boolean) {
    if (!paid) {
      const ok = await confirm({
        title: `Mark ${i.payee} unpaid?`,
        message: `This clears the paid stamp${i.paidAt ? ` (${TIME_FMT.format(new Date(i.paidAt))}${i.paidByName ? `, ${i.paidByName}` : ''})` : ''} and puts it back to pending on this snapshot. The change is recorded in the audit log.`,
        confirmLabel: 'Mark unpaid',
      })
      if (!ok) return
    }
    setBusyId(i.id)
    const r = await api<{ item: CmrPendingItem; changed: boolean }>('/api/cmr/ledger/pending', {
      method: 'PATCH',
      body: JSON.stringify({ id: i.id, status: paid ? 'paid' : 'pending' }),
    })
    setBusyId(null)
    if (!r.success) {
      await alert({ title: paid ? 'Could not check it off' : 'Could not mark it unpaid', message: r.error })
      if (r.code === 'NOT_FOUND' || r.code === 'NOT_EDITABLE') await reload()
      return
    }
    setStatus(`${i.payee} ${paid ? 'checked off as paid' : 'marked unpaid'}.`)
    await reload()
    focusLater(`paid:${i.id}`)
  }

  async function unpushItem(i: CmrPendingItem) {
    const ok = await confirm({
      title: `Take back the push of ${i.payee}?`,
      message: `This deletes the ${formatCents(i.amountCents)} item on ${i.pushedTo ? formatWhere(i.pushedTo, { year: false }) : 'the day it was pushed to'} and puts this one back to pending on ${dayLabel} ${periodLabel}, where it will count against the balance again. The change is recorded in the audit log.`,
      confirmLabel: 'Take the push back',
    })
    if (!ok) return
    setBusyId(i.id)
    const r = await api<{ removedCopyId: string | null }>('/api/cmr/ledger/pending/unpush', {
      method: 'POST',
      body: JSON.stringify({ id: i.id }),
    })
    setBusyId(null)
    if (!r.success) {
      await alert({ title: 'Could not take the push back', message: r.error })
      await reload()
      return
    }
    setStatus(`${i.payee} is back on this snapshot as pending.`)
    await reload()
    focusLater(`pend:${i.id}`)
  }

  async function pushItem(i: CmrPendingItem, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(i.id)
    const r = await api<{ where: string; to: { date: string; period: CmrLedgerPeriod } }>('/api/cmr/ledger/pending/push', {
      method: 'POST',
      body: JSON.stringify({ id: i.id, ...body }),
    })
    setBusyId(null)
    if (!r.success) {
      await alert({ title: 'Could not push the item', message: r.error })
      if (r.code === 'NOT_FOUND' || r.code === 'NOT_PENDING') { setPushing(null); await reload() }
      return false
    }
    setStatus(`${i.payee} pushed to ${formatWhere(r.data.to)}. It stays on this day as history.`)
    setPushing(null)
    await reload()
    focusLater('addPending')
    return true
  }

  // Optimistic reorders; one at a time; rolled back if the save fails.
  async function reorderAdjustments(next: CmrLedgerAdjustment[], movedId: string) {
    const prev = current
    if (!prev || reordering) return
    setView({ ...prev, adjustments: next.map((a, i) => ({ ...a, sortOrder: i })) })
    setReordering('adj')
    const ids = next.map((a) => a.id)
    const r = await api<{ changed: boolean }>('/api/cmr/ledger/adjustments/reorder', {
      method: 'POST',
      body: JSON.stringify({ date: prev.ledger.ledgerDate, period: prev.ledger.period, ids }),
    })
    setReordering(null)
    if (!r.success) {
      setView(prev)
      await alert({ title: 'Could not save the new order', message: r.error })
      if (r.code === 'STALE') await reload()
      return
    }
    const name = next.find((a) => a.id === movedId)?.description ?? 'Line'
    setStatus(`${name} moved to position ${ids.indexOf(movedId) + 1} of ${ids.length}.`)
  }

  async function reorderPending(group: CmrPendingGroup, next: CmrPendingItem[], movedId: string) {
    const prev = current
    if (!prev || reordering) return
    const renumbered = next.map((it, i) => ({ ...it, sortOrder: i }))
    setView({
      ...prev,
      pending: prev.pending.map((g) => (g.accountId === group.accountId ? { ...g, items: renumbered } : g)),
    })
    setReordering(group.accountId)
    const ids = next.map((it) => it.id)
    const r = await api<{ changed: boolean }>('/api/cmr/ledger/pending/reorder', {
      method: 'POST',
      body: JSON.stringify({ date: prev.ledger.ledgerDate, period: prev.ledger.period, accountId: group.accountId, ids }),
    })
    setReordering(null)
    if (!r.success) {
      setView(prev)
      await alert({ title: 'Could not save the new order', message: r.error })
      if (r.code === 'STALE') await reload()
      return
    }
    const name = next.find((it) => it.id === movedId)?.payee ?? 'Item'
    setStatus(`${name} moved to position ${ids.indexOf(movedId) + 1} of ${ids.length} in ${group.accountName}.`)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const activeAccounts = current?.accounts.filter((a) => a.active) ?? []
  const pendingCount = current?.pending.reduce((n, g) => n + g.items.length, 0) ?? 0

  return (
    <>
      <header className="cmr-pagehead cmr-lg-head">
        <div>
          <h1 className="cmr-serif">Daily ledger</h1>
          <p>
            <time dateTime={date}>{dayLabel}</time> · {periodLabel} snapshot · Pacific
          </p>
        </div>
        <div className="actions cmr-lg-controls">
          <div className="cmr-lg-datenav" role="group" aria-label="Choose the ledger day">
            <button type="button" className="cmr-iconbtn sm" onClick={() => goTo(shiftLedgerDate(date, -1))} aria-label="Previous day" title="Previous day">
              <CmrIcon name="left" />
            </button>
            <input
              type="date"
              className="cmr-input cmr-lg-date"
              value={date}
              min="2000-01-01"
              max="2100-12-31"
              onChange={(e) => goTo(e.target.value)}
              aria-label="Ledger date"
            />
            <button type="button" className="cmr-iconbtn sm" onClick={() => goTo(shiftLedgerDate(date, 1))} aria-label="Next day" title="Next day">
              <CmrIcon name="right" />
            </button>
          </div>
          <button type="button" className="cmr-btn sm ghost" onClick={() => goTo(today)} disabled={isToday}>
            Today
          </button>
          <div className="cmr-seg" role="group" aria-label="Snapshot">
            {CMR_LEDGER_PERIODS.map((p) => (
              <button key={p} type="button" aria-pressed={p === period} onClick={() => goTo(date, p)}>
                {CMR_LEDGER_PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <p className="cmr-sr-only" role="status" aria-live="polite">{status}</p>

      {current && !canEdit && (
        <div className="cmr-notice" style={{ marginBottom: 18 }}>
          <CmrIcon name="lock" size={14} />
          <span>You can view the daily ledger. Only a Controller can change it.</span>
        </div>
      )}

      {loadError && (
        <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <button type="button" className="cmr-btn sm ghost" onClick={() => void reload()}>Retry</button>
        </div>
      )}

      {!current && !loadError && (
        <div aria-busy="true" aria-label={`Loading the ${periodLabel} ledger for ${dayLabel}`}>
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
          <BalanceHero view={current} isToday={isToday} />

          {/* ── beginning cash ─────────────────────────────────────────── */}
          <section className="cmr-sec" aria-labelledby="cmr-lg-begin-title">
            <div className="cmr-sh">
              <h2 id="cmr-lg-begin-title">Beginning cash</h2>
              <span className="c">
                {current.ledger.exists ? `opening balance for the ${periodLabel} snapshot` : 'nothing saved for this snapshot yet'}
              </span>
            </div>
            <div className="cmr-card">
              {mode?.kind === 'begin' ? (
                <div className="cmr-row cmr-lg-row editing">
                  <BeginningForm
                    initialCents={current.ledger.beginningCashCents}
                    periodLabel={periodLabel}
                    onSubmit={saveBeginning}
                    onCancel={() => { setMode(null); focusLater('begin') }}
                  />
                </div>
              ) : (
                <div className="cmr-row cmr-lg-row">
                  <div className="who">
                    <span className="desc">Beginning cash · {periodLabel}</span>
                    <span className="mt">
                      {current.ledger.exists
                        ? 'What the bank showed when this snapshot was taken.'
                        : canEdit
                          ? 'Starts at $0.00. Setting it, or adding any line, saves this snapshot.'
                          : 'Nothing has been entered for this snapshot yet.'}
                    </span>
                  </div>
                  <span className={`amt cmr-num${current.ledger.beginningCashCents < 0 ? ' neg' : ''}`}>
                    {formatBalanceCents(current.ledger.beginningCashCents)}
                  </span>
                  {canEdit && (
                    <div className="ctl">
                      <button
                        type="button"
                        ref={refFor('begin')}
                        className="cmr-btn sm ghost"
                        onClick={() => setMode({ kind: 'begin' })}
                        disabled={locked}
                        aria-label={`Edit ${periodLabel} beginning cash`}
                      >
                        <CmrIcon name="edit" size={14} /> Edit
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* ── adjustments ─────────────────────────────────────────────── */}
          <section className="cmr-sec" aria-labelledby="cmr-lg-adj-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-lg-adj-title">Adjustments</h2>
                <span className="c">{plural(current.adjustments.length, 'line')}</span>
              </div>
              <span className="tot">
                {reordering === 'adj' ? (
                  <span aria-hidden="true">Saving order…</span>
                ) : (
                  <>Net <b className="cmr-num">{formatSignedCents(current.totals.adjustmentsTotalCents)}</b></>
                )}
              </span>
              {canEdit && (
                <button
                  type="button"
                  ref={refFor('addAdj')}
                  className="cmr-btn sm ghost"
                  onClick={() => setMode({ kind: 'addAdj' })}
                  disabled={locked}
                  aria-label="Add an adjustment line"
                >
                  <CmrIcon name="plus" size={14} /> Add line
                </button>
              )}
            </div>
            <div className="cmr-card">
              {current.adjustments.length === 0 && mode?.kind !== 'addAdj' && (
                <div className="cmr-lg-empty">No adjustment lines{canEdit ? ' yet — add wires, deposits, holds and anything else that moves cash.' : '.'}</div>
              )}
              {current.adjustments.length > 0 && (
                <Reorderable
                  enabled={canEdit}
                  items={current.adjustments}
                  nameOf={(a) => a.description}
                  listLabel="Adjustment lines"
                  sensors={sensors}
                  onOrder={(next, moved) => void reorderAdjustments(next, moved)}
                >
                  {current.adjustments.map((a, i) => (
                    <AdjustmentRow
                      key={a.id}
                      a={a}
                      index={i}
                      total={current.adjustments.length}
                      canEdit={canEdit}
                      busy={busyId === a.id}
                      locked={locked}
                      editing={mode?.kind === 'editAdj' && mode.id === a.id}
                      editRef={refFor(`adj:${a.id}`)}
                      onEdit={() => setMode({ kind: 'editAdj', id: a.id })}
                      onDelete={() => void deleteAdjustment(a)}
                      onMove={(d) => {
                        const to = i + d
                        if (to < 0 || to >= current.adjustments.length) return
                        void reorderAdjustments(arrayMove(current.adjustments, i, to), a.id)
                      }}
                      onSave={(b) => saveAdjustment(a, b)}
                      onCancel={() => { setMode(null); focusLater(`adj:${a.id}`) }}
                    />
                  ))}
                </Reorderable>
              )}
              {canEdit && mode?.kind === 'addAdj' && (
                <div className="cmr-lg-addwrap">
                  <AdjustmentForm onSubmit={createAdjustment} onCancel={() => { setMode(null); focusLater('addAdj') }} />
                </div>
              )}
              <div className="cmr-row lock cmr-lg-row cmr-lg-rollup">
                <span className="lockic"><CmrIcon name="lock" size={14} /></span>
                <div className="who">
                  <span className="desc">Pending in bank{isToday ? ' today' : ''}</span>
                  <span className="mt">Calculated from the pending breakdown below — not editable.</span>
                </div>
                <span className="amt cmr-num">{formatSignedCents(-current.totals.pendingRollupCents)}</span>
              </div>
            </div>
          </section>

          {/* ── pending breakdown ───────────────────────────────────────── */}
          <section className="cmr-sec" aria-labelledby="cmr-lg-pend-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-lg-pend-title">Pending in bank</h2>
                <span className="c">
                  {plural(pendingCount, 'item')}
                  {current.pending.length > 0 && ` · ${plural(current.pending.length, 'account')}`}
                </span>
              </div>
              <span className="tot">
                {reordering && reordering !== 'adj' ? (
                  <span aria-hidden="true">Saving order…</span>
                ) : (
                  <>Total <b className="cmr-num">{formatCents(current.totals.pendingRollupCents)}</b></>
                )}
              </span>
              {canEdit && (
                <button
                  type="button"
                  ref={refFor('addPending')}
                  className="cmr-btn sm ghost"
                  onClick={() => setMode({ kind: 'addPending' })}
                  disabled={locked || activeAccounts.length === 0}
                  aria-label="Add a pending item"
                  title={activeAccounts.length === 0 ? 'Add an active account first (Settings → Accounts)' : undefined}
                >
                  <CmrIcon name="plus" size={14} /> Add item
                </button>
              )}
            </div>
            <p className="cmr-lg-blurb">Written but not yet cleared. Grouped by account; the total comes off the balance.</p>
            <div className="cmr-card">
              {pendingCount === 0 && mode?.kind !== 'addPending' && (
                <div className="cmr-lg-empty">Nothing pending in the bank for this snapshot.</div>
              )}
              {current.pending.map((g) => (
                <PendingGroupBlock
                  key={g.accountId}
                  group={g}
                  canEdit={canEdit}
                  sensors={sensors}
                  busyId={busyId}
                  locked={locked}
                  editingId={mode?.kind === 'editPending' ? mode.id : null}
                  accounts={current.accounts}
                  refFor={refFor}
                  onEdit={(it) => setMode({ kind: 'editPending', id: it.id })}
                  onDelete={(it) => void deletePending(it)}
                  onSave={savePending}
                  onCancel={(it) => { setMode(null); focusLater(`pend:${it.id}`) }}
                  onOrder={(next, moved) => void reorderPending(g, next, moved)}
                  onPaid={(it, paid) => void setPaid(it, paid)}
                  onPush={(it) => setPushing(it)}
                  onUnpush={(it) => void unpushItem(it)}
                />
              ))}
              {canEdit && mode?.kind === 'addPending' && (
                <div className="cmr-lg-addwrap">
                  <PendingForm accounts={current.accounts} onSubmit={createPending} onCancel={() => { setMode(null); focusLater('addPending') }} />
                </div>
              )}
              {pendingCount > 0 && (
                <div className="cmr-row cmr-lg-row cmr-lg-total">
                  <div className="who">
                    <span className="desc">Total pending</span>
                    <span className="mt">Across {plural(current.pending.length, 'account')}</span>
                  </div>
                  <span className="amt cmr-num">{formatCents(current.totals.pendingRollupCents)}</span>
                </div>
              )}
            </div>
          </section>

          {canEdit && (current.adjustments.length > 1 || pendingCount > 1) && (
            <p className="cmr-hint">
              Drag the <CmrIcon name="grip" size={12} /> handle or use the arrows to reorder. Pending items reorder within their
              account; edit an item to move it to another account. AM and PM are separate snapshots — nothing moves between
              them on its own; push an item to send it forward, and un-push to bring it back.
            </p>
          )}
        </>
      )}

      {pushing && current && (
        <PushDialog
          item={pushing}
          from={{ date: current.ledger.ledgerDate, period: current.ledger.period }}
          busy={busyId === pushing.id}
          onPush={(b) => pushItem(pushing, b)}
          onCancel={() => { const id = pushing.id; setPushing(null); focusLater(`push:${id}`) }}
        />
      )}
    </>
  )
}

// ── the Push dialog (in-app; never a native prompt) ─────────────────────────

function PushDialog({
  item,
  from,
  busy,
  onPush,
  onCancel,
}: {
  item: CmrPendingItem
  from: { date: string; period: CmrLedgerPeriod }
  busy: boolean
  onPush: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  // The default IS the answer most days: tomorrow, same snapshot. Both are free to change.
  const [date, setDate] = useState(shiftLedgerDate(from.date, 1))
  const [period, setPeriod] = useState<CmrLedgerPeriod>(from.period)
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
    await onPush({ targetDate: date, targetPeriod: period })
    setSaving(false)
  }

  const busyNow = saving || busy
  const sameSnapshot = date === from.date && period === from.period

  return (
    <div className="cmr-rq-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div
        ref={wrap}
        className="cmr-rq-dialog cmr-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmr-lg-push-title"
        aria-describedby="cmr-lg-push-desc"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="cmr-lg-push-title" className="cmr-serif">Push {item.payee}</h2>
        <p id="cmr-lg-push-desc">
          {item.accountName} · {formatCents(item.amountCents)} · now on {formatWhere(from)}
        </p>

        <form onSubmit={submit} noValidate>
          <div className="cmr-rq-dialogfields">
            <label className="cmr-field">
              <span className="cmr-label">Move to</span>
              <input
                ref={firstRef}
                className="cmr-input"
                type="date"
                value={date}
                min="2000-01-01"
                max="2100-12-31"
                onChange={(e) => setDate(e.target.value || date)}
                disabled={busyNow}
                required
              />
            </label>
            <div className="cmr-field">
              <span className="cmr-label">Snapshot</span>
              <div className="cmr-seg cmr-lg-dir" role="group" aria-label="AM or PM">
                {CMR_LEDGER_PERIODS.map((p) => (
                  <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} disabled={busyNow}>
                    {CMR_LEDGER_PERIOD_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="cmr-field cmr-rq-weekjump">
              <span className="cmr-label">Jump</span>
              <div className="cmr-seg cmr-lg-dir" role="group" aria-label="Move a day">
                <button type="button" onClick={() => setDate(shiftLedgerDate(date, -1))} disabled={busyNow} aria-label="The day before">
                  <CmrIcon name="left" size={14} />
                </button>
                <button type="button" onClick={() => { setDate(shiftLedgerDate(from.date, 1)); setPeriod(from.period) }} disabled={busyNow}>
                  Next day
                </button>
                <button type="button" onClick={() => setDate(shiftLedgerDate(date, 1))} disabled={busyNow} aria-label="The day after">
                  <CmrIcon name="right" size={14} />
                </button>
              </div>
            </div>
            <p className="cmr-rq-dialognote span-all">
              {sameSnapshot ? (
                <>That’s the snapshot it’s already on — choose another day or AM/PM.</>
              ) : (
                <>
                  Moves to <b>{formatWhere({ date, period })}</b> under {item.accountName}. It stays on{' '}
                  {formatWhere(from, { year: false })} as history, marked pushed, and stops counting against that balance.
                </>
              )}
            </p>
          </div>

          <div className="acts">
            <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={busyNow}>Cancel</button>
            <button type="submit" className="cmr-btn sm" disabled={busyNow || sameSnapshot}>
              <CmrIcon name="right" size={14} />
              {busyNow ? 'Pushing…' : 'Push it forward'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── statement header ────────────────────────────────────────────────────────

function BalanceHero({ view, isToday }: { view: CmrLedgerView; isToday: boolean }) {
  const { totals, ledger } = view
  const bal = totals.currentBalanceCents
  const whole = formatCents(Math.abs(bal))
  const dot = whole.lastIndexOf('.')
  const periodLabel = CMR_LEDGER_PERIOD_LABEL[ledger.period]
  return (
    <section className="cmr-hero cmr-lg-hero" aria-labelledby="cmr-lg-hero-cap">
      <div className="l">
        <h2 className="cmr-hero-cap" id="cmr-lg-hero-cap">
          Current balance · {periodLabel}
          {isToday && <span className="cmr-lg-chip">Today</span>}
          {bal < 0 && <span className="cmr-lg-chip short">Short</span>}
        </h2>
        <p className={`cmr-hero-big cmr-serif cmr-num${bal < 0 ? ' neg' : ''}`}>
          {bal < 0 && '−'}
          {whole.slice(0, dot)}
          <span className="c">{whole.slice(dot)}</span>
        </p>
        <div className="cmr-hero-rule" aria-hidden="true" />
        <p className="cmr-hero-meta">
          {formatLedgerDate(ledger.ledgerDate)} ·{' '}
          {ledger.exists && ledger.updatedAt ? (
            <>updated <b>{TIME_FMT.format(new Date(ledger.updatedAt))}</b></>
          ) : (
            'not started'
          )}
        </p>
      </div>
      <dl className="cmr-lg-stmt">
        <div>
          <dt>Beginning cash</dt>
          <dd className="cmr-num">{formatBalanceCents(totals.beginningCashCents)}</dd>
        </div>
        <div>
          <dt>Adjustments</dt>
          <dd className="cmr-num">{formatSignedCents(totals.adjustmentsTotalCents)}</dd>
        </div>
        <div>
          <dt>Pending in bank</dt>
          <dd className="cmr-num">{formatSignedCents(-totals.pendingRollupCents)}</dd>
        </div>
        <div className="total">
          <dt>Current balance</dt>
          <dd className="cmr-num">{formatBalanceCents(bal)}</dd>
        </div>
      </dl>
    </section>
  )
}

// ── sortable plumbing ───────────────────────────────────────────────────────

function Reorderable<T extends { id: string }>({
  enabled,
  items,
  nameOf,
  listLabel,
  sensors,
  onOrder,
  children,
}: {
  enabled: boolean
  items: T[]
  nameOf: (item: T) => string
  listLabel: string
  sensors: ReturnType<typeof useSensors>
  onOrder: (next: T[], movedId: string) => void
  children: React.ReactNode
}) {
  const announcements: Announcements = useMemo(() => {
    const name = (id: UniqueIdentifier | undefined) => {
      const it = items.find((x) => x.id === id)
      return it ? nameOf(it) : 'item'
    }
    const pos = (id: UniqueIdentifier | undefined) => items.findIndex((x) => x.id === id) + 1
    const n = items.length
    return {
      onDragStart: ({ active }) => `Picked up ${name(active.id)}, position ${pos(active.id)} of ${n}.`,
      onDragOver: ({ active, over }) =>
        over ? `${name(active.id)} is over position ${pos(over.id)} of ${n}.` : `${name(active.id)} is no longer over the list.`,
      onDragEnd: ({ active, over }) => (over ? `${name(active.id)} dropped at position ${pos(over.id)} of ${n}.` : `${name(active.id)} dropped.`),
      onDragCancel: ({ active }) => `Reorder cancelled. ${name(active.id)} returned to position ${pos(active.id)}.`,
    }
  }, [items, nameOf])

  if (!enabled) return <ul className="cmr-lg-list" aria-label={listLabel}>{children}</ul>

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
            'To reorder, press Space or Enter to pick up the item, use the up and down arrow keys to move it, then press Space or Enter to drop it, or Escape to cancel.',
        },
      }}
    >
      <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        <ul className="cmr-lg-list" aria-label={`${listLabel}, in display order`}>{children}</ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableLi({
  id,
  name,
  index,
  total,
  className,
  disabled,
  busy,
  children,
}: {
  id: string
  name: string
  index: number
  total: number
  className: string
  disabled: boolean
  busy: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  return (
    <li ref={setNodeRef} style={style} className={className} data-dragging={isDragging || undefined} aria-busy={busy || undefined}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="cmr-handle"
        aria-label={`Reorder ${name}, position ${index + 1} of ${total}`}
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

/**
 * Move / edit / delete for one row. `bare` leaves off the .ctl wrapper, for a row that already
 * has one of its own (a pending item, whose check-off and Push sit in the same group).
 */
function RowControls({
  name,
  index,
  total,
  disabled,
  editRef,
  bare = false,
  onMove,
  onEdit,
  onDelete,
}: {
  name: string
  index: number
  total: number
  disabled: boolean
  editRef: (el: HTMLElement | null) => void
  bare?: boolean
  onMove: (delta: -1 | 1) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const Wrap = bare ? React.Fragment : 'div'
  return (
    <Wrap {...(bare ? {} : { className: 'ctl' })}>
      <div className="moves">
        <button type="button" className="cmr-iconbtn sm" onClick={() => onMove(-1)} disabled={disabled || index === 0} aria-label={`Move ${name} up`} title="Move up">
          <CmrIcon name="up" />
        </button>
        <button type="button" className="cmr-iconbtn sm" onClick={() => onMove(1)} disabled={disabled || index === total - 1} aria-label={`Move ${name} down`} title="Move down">
          <CmrIcon name="down" />
        </button>
      </div>
      <button type="button" ref={editRef} className="cmr-btn sm ghost" onClick={onEdit} disabled={disabled} aria-label={`Edit ${name}`}>
        <CmrIcon name="edit" size={14} /> Edit
      </button>
      <button type="button" className="cmr-iconbtn sm danger" onClick={onDelete} disabled={disabled} aria-label={`Delete ${name}`} title="Delete">
        <CmrIcon name="trash" />
      </button>
    </Wrap>
  )
}

// ── adjustment line ─────────────────────────────────────────────────────────

function AdjustmentRow({
  a,
  index,
  total,
  canEdit,
  busy,
  locked,
  editing,
  editRef,
  onEdit,
  onDelete,
  onMove,
  onSave,
  onCancel,
}: {
  a: CmrLedgerAdjustment
  index: number
  total: number
  canEdit: boolean
  busy: boolean
  locked: boolean
  editing: boolean
  editRef: (el: HTMLElement | null) => void
  onEdit: () => void
  onDelete: () => void
  onMove: (delta: -1 | 1) => void
  onSave: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  const cls = ['cmr-row', 'cmr-lg-row', a.warnNote ? 'warned' : '', editing ? 'editing' : ''].filter(Boolean).join(' ')
  const body = (
    <>
      <div className="who">
        <span className="desc">
          <span className="nm">{a.description}</span>
          {a.warnNote && (
            <span className="cmr-pill warn">
              <CmrIcon name="alert" size={11} />
              <span className="cmr-sr-only">Warning: </span>
              {a.warnNote}
            </span>
          )}
        </span>
        {a.note && <span className="note">{a.note}</span>}
      </div>
      <span className={`amt cmr-num ${a.amountCents < 0 ? 'out' : 'in'}`}>{formatSignedCents(a.amountCents)}</span>
    </>
  )
  if (!canEdit) return <li className={cls}>{body}</li>
  return (
    <SortableLi id={a.id} name={a.description} index={index} total={total} className={cls} disabled={locked || busy} busy={busy}>
      {editing ? (
        <div className="cmr-lg-editwrap">
          <AdjustmentForm initial={a} onSubmit={onSave} onCancel={onCancel} />
        </div>
      ) : (
        <>
          {body}
          <RowControls
            name={a.description}
            index={index}
            total={total}
            disabled={locked || busy}
            editRef={editRef}
            onMove={onMove}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </>
      )}
    </SortableLi>
  )
}

// ── pending group + item ────────────────────────────────────────────────────

function PendingGroupBlock({
  group: g,
  canEdit,
  sensors,
  busyId,
  locked,
  editingId,
  accounts,
  refFor,
  onEdit,
  onDelete,
  onSave,
  onCancel,
  onOrder,
  onPaid,
  onPush,
  onUnpush,
}: {
  group: CmrPendingGroup
  canEdit: boolean
  sensors: ReturnType<typeof useSensors>
  busyId: string | null
  locked: boolean
  editingId: string | null
  accounts: CmrLedgerAccountRef[]
  refFor: (key: string) => (el: HTMLElement | null) => void
  onEdit: (it: CmrPendingItem) => void
  onDelete: (it: CmrPendingItem) => void
  onSave: (it: CmrPendingItem, body: Record<string, unknown>) => Promise<boolean>
  onCancel: (it: CmrPendingItem) => void
  onOrder: (next: CmrPendingItem[], movedId: string) => void
  onPaid: (it: CmrPendingItem, paid: boolean) => void
  onPush: (it: CmrPendingItem) => void
  onUnpush: (it: CmrPendingItem) => void
}) {
  const headId = `cmr-lg-acct-${g.accountId}`
  const title = `${g.accountName}${g.accountType ? ` · ${g.accountType}` : ''}`
  return (
    <div className="cmr-lg-group" role="group" aria-labelledby={headId}>
      <h3 className="cmr-gh" id={headId}>
        <span className="dot" aria-hidden="true" />
        <span className="gn">
          {title}
          {!g.accountActive && <span className="off"> (inactive account)</span>}
        </span>{' '}
        <span className="gt cmr-num">
          <span className="cmr-sr-only">subtotal</span>{' '}
          {formatCents(g.subtotalCents)}
        </span>
      </h3>
      <Reorderable
        enabled={canEdit}
        items={g.items}
        nameOf={(it) => it.payee}
        listLabel={`Pending items for ${g.accountName}`}
        sensors={sensors}
        onOrder={onOrder}
      >
        {g.items.map((it, i) => {
          const busy = busyId === it.id
          const editing = editingId === it.id
          const editable = it.status === 'pending' && it.source === 'manual'
          const history = isPendingHistory(it)
          const cls = [
            'cmr-row',
            'cmr-lg-row',
            it.status === 'paid' ? 'paid' : '',
            history ? 'pushed' : '',
            editing ? 'editing' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const body = (
            <>
              <div className="who">
                <span className="desc">
                  <span className="nm">{it.payee}</span>
                  {it.status !== 'pending' && <span className="cmr-pill viewer">{it.status === 'paid' ? 'Paid' : 'Pushed'}</span>}
                  {it.source !== 'manual' && <span className="cmr-pill">{it.source === 'recurring' ? 'Recurring' : 'Request'}</span>}
                </span>
                <PendingMeta it={it} />
                {it.status === 'pushed' && it.unpushBlockedReason && (
                  <span className="mt cmr-rq-blocked">
                    <CmrIcon name="lock" size={11} /> Can’t be taken back: {it.unpushBlockedReason}
                  </span>
                )}
                {it.notes && <span className="note">{it.notes}</span>}
              </div>
              <span className="amt cmr-num out">{formatSignedCents(-it.amountCents)}</span>
            </>
          )
          if (!canEdit) return <li key={it.id} className={cls}>{body}</li>
          return (
            <SortableLi key={it.id} id={it.id} name={it.payee} index={i} total={g.items.length} className={cls} disabled={locked || busy} busy={busy}>
              {editing ? (
                <div className="cmr-lg-editwrap">
                  <PendingForm item={it} accounts={accounts} onSubmit={(b) => onSave(it, b)} onCancel={() => onCancel(it)} />
                </div>
              ) : (
                <>
                  {body}
                  <div className="ctl">
                    {canPayPending(it) && (
                      <label className={`cmr-lg-check${it.status === 'paid' ? ' on' : ''}`}>
                        <input
                          type="checkbox"
                          ref={refFor(`paid:${it.id}`) as (el: HTMLInputElement | null) => void}
                          checked={it.status === 'paid'}
                          disabled={locked || busy}
                          onChange={(e) => onPaid(it, e.target.checked)}
                          aria-label={`Paid: ${it.payee}, ${formatCents(it.amountCents)}`}
                        />
                        <span aria-hidden="true">Paid</span>
                      </label>
                    )}
                    {canPushPending(it) && (
                      <button
                        type="button"
                        ref={refFor(`push:${it.id}`)}
                        className="cmr-btn sm ghost"
                        onClick={() => onPush(it)}
                        disabled={locked || busy}
                        aria-label={`Push ${it.payee} to another day`}
                        title="Push to another day"
                      >
                        <CmrIcon name="right" size={14} /> <span className="cmr-pr-lbl">Push</span>
                      </button>
                    )}
                    {history && (
                      <button
                        type="button"
                        ref={refFor(`unpush:${it.id}`)}
                        className="cmr-btn sm ghost"
                        onClick={() => onUnpush(it)}
                        disabled={locked || busy || !it.canUnpush}
                        aria-label={`Take back the push of ${it.payee}`}
                        title={it.unpushBlockedReason ?? 'Delete the item it became and put this one back to pending'}
                      >
                        <CmrIcon name="undo" size={14} /> <span className="cmr-pr-lbl">Un-push</span>
                      </button>
                    )}
                    {editable && (
                      <RowControls
                        bare
                        name={it.payee}
                        index={i}
                        total={g.items.length}
                        disabled={locked || busy}
                        editRef={refFor(`pend:${it.id}`)}
                        onMove={(d) => {
                          const to = i + d
                          if (to < 0 || to >= g.items.length) return
                          onOrder(arrayMove(g.items, i, to), it.id)
                        }}
                        onEdit={() => onEdit(it)}
                        onDelete={() => onDelete(it)}
                      />
                    )}
                  </div>
                </>
              )}
            </SortableLi>
          )
        })}
      </Reorderable>
    </div>
  )
}

/**
 * The second line of a pending item: where it was pushed to (on the original this day keeps),
 * where it came from (on a forward copy), and the paid stamp. Read-only for every role — this
 * is the history the phase is for.
 */
function PendingMeta({ it }: { it: CmrPendingItem }) {
  const bits: React.ReactNode[] = []
  if (it.pushedTo) {
    bits.push(
      <span key="to">
        Pushed to <time dateTime={it.pushedTo.date}>{formatWhere(it.pushedTo, { year: false })}</time>
      </span>,
    )
  } else if (it.status === 'pushed') {
    bits.push(<span key="to">Pushed to another day</span>)
  }
  if (it.pushedFrom) {
    bits.push(
      <span key="from">
        Pushed from <time dateTime={it.pushedFrom.date}>{formatWhere(it.pushedFrom, { year: false })}</time>
      </span>,
    )
  }
  if (it.status === 'paid' && it.paidAt) {
    bits.push(
      <span key="paid" className="cmr-pr-stamp">
        Paid {TIME_FMT.format(new Date(it.paidAt))}
        {it.paidByName && (
          <>
            {' · '}
            <abbr title={it.paidByName}>{initialsOf(it.paidByName)}</abbr>
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

// ── forms ───────────────────────────────────────────────────────────────────

function useAutofocus(select: boolean) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    requestAnimationFrame(() => { ref.current?.focus(); if (select) ref.current?.select() })
  }, [select])
  return ref
}

function FormActions({ saving, label, onCancel }: { saving: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="acts span-all">
      <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={saving}>Cancel</button>
      <button type="submit" className="cmr-btn sm" disabled={saving}>
        <CmrIcon name="check" size={14} />
        {saving ? 'Saving…' : label}
      </button>
    </div>
  )
}

function BeginningForm({
  initialCents,
  periodLabel,
  onSubmit,
  onCancel,
}: {
  initialCents: number
  periodLabel: string
  onSubmit: (cents: number) => Promise<boolean>
  onCancel: () => void
}) {
  const [cents, setCents] = useState<number | null>(initialCents)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrap = useRef<HTMLFormElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      const input = wrap.current?.querySelector('input')
      input?.focus()
      input?.select()
    })
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (cents === null) { setError('Enter the beginning cash (a minus sign for an overdrawn balance).'); return }
    setError(null)
    setSaving(true)
    await onSubmit(cents)
    setSaving(false)
  }

  return (
    <form
      ref={wrap}
      className="cmr-rv-form cmr-lg-form cmr-lg-beginform"
      onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      aria-label={`Set ${periodLabel} beginning cash`}
      noValidate
    >
      <label className="cmr-field span2">
        <span className="cmr-label">Beginning cash · {periodLabel}</span>
        <span className="cmr-money">
          <span aria-hidden="true">$</span>
          <MoneyInput valueCents={cents} onChangeCents={setCents} placeholder="0.00" ariaLabel="Beginning cash" allowNegative />
        </span>
      </label>
      {error && <p className="cmr-rv-formerr span-all" role="alert">{error}</p>}
      <FormActions saving={saving} label="Save" onCancel={onCancel} />
    </form>
  )
}

function AdjustmentForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: CmrLedgerAdjustment
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  const uid = initial?.id ?? 'new'
  const [description, setDescription] = useState(initial?.description ?? '')
  const [sign, setSign] = useState<1 | -1>(initial && initial.amountCents < 0 ? -1 : 1)
  const [amount, setAmount] = useState<number | null>(initial ? Math.abs(initial.amountCents) : null)
  const [warnNote, setWarnNote] = useState(initial?.warnNote ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useAutofocus(!!initial)

  function build(): Record<string, unknown> | string {
    if (!description.trim()) return 'Enter a description.'
    if (amount === null) return 'Enter an amount.'
    const fields = {
      description: description.trim(),
      amountCents: amount === 0 ? 0 : sign * amount,
      warnNote: blankToNull(warnNote),
      note: blankToNull(note),
    }
    if (!initial) return fields
    const out: Record<string, unknown> = {}
    if (fields.description !== initial.description) out.description = fields.description
    if (fields.amountCents !== initial.amountCents) out.amountCents = fields.amountCents
    if (fields.warnNote !== initial.warnNote) out.warnNote = fields.warnNote
    if (fields.note !== initial.note) out.note = fields.note
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

  const listId = `cmr-lg-warn-${uid}`
  return (
    <form
      className="cmr-rv-form cmr-lg-form"
      onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      aria-label={initial ? `Edit ${initial.description}` : 'New adjustment line'}
      noValidate
    >
      <datalist id={listId}>
        {CMR_WARN_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
      </datalist>

      <label className="cmr-field span2">
        <span className="cmr-label">Description</span>
        <input
          ref={nameRef}
          className="cmr-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={CMR_ADJ_DESCRIPTION_MAX}
          placeholder="e.g. Wires from prior week"
          autoComplete="off"
          required
        />
      </label>

      <div className="cmr-field">
        <span className="cmr-label" id={`cmr-lg-dir-${uid}`}>Direction</span>
        <div className="cmr-seg cmr-lg-dir" role="group" aria-labelledby={`cmr-lg-dir-${uid}`}>
          <button type="button" aria-pressed={sign === 1} onClick={() => setSign(1)}>+ Adds cash</button>
          <button type="button" aria-pressed={sign === -1} onClick={() => setSign(-1)}>{'−'} Takes away</button>
        </div>
      </div>

      <label className="cmr-field">
        <span className="cmr-label">Amount</span>
        <span className="cmr-money">
          <span aria-hidden="true">{sign === -1 ? '−$' : '+$'}</span>
          <MoneyInput
            valueCents={amount}
            onChangeCents={setAmount}
            placeholder="0.00"
            ariaLabel={sign === -1 ? 'Amount taken away' : 'Amount added'}
          />
        </span>
      </label>

      <label className="cmr-field span2">
        <span className="cmr-label">Warn note <span className="opt">(optional — shows as an amber flag)</span></span>
        <input
          className="cmr-input"
          value={warnNote}
          onChange={(e) => setWarnNote(e.target.value)}
          maxLength={CMR_ADJ_WARN_MAX}
          list={listId}
          placeholder="e.g. Needs to be covered by 2:00 PM"
          autoComplete="off"
        />
      </label>

      <label className="cmr-field span2">
        <span className="cmr-label">Note <span className="opt">(optional)</span></span>
        <textarea className="cmr-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={CMR_ADJ_NOTE_MAX} rows={1} />
      </label>

      {error && <p className="cmr-rv-formerr span-all" role="alert">{error}</p>}
      <FormActions saving={saving} label={initial ? 'Save' : 'Add line'} onCancel={onCancel} />
    </form>
  )
}

function PendingForm({
  item,
  accounts,
  onSubmit,
  onCancel,
}: {
  item?: CmrPendingItem
  accounts: CmrLedgerAccountRef[]
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  const active = accounts.filter((a) => a.active)
  const [accountId, setAccountId] = useState(item?.accountId ?? (active.length === 1 ? active[0].id : ''))
  const [payee, setPayee] = useState(item?.payee ?? '')
  const [amount, setAmount] = useState<number | null>(item ? item.amountCents : null)
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const payeeRef = useAutofocus(!!item)
  const currentInactive = item && !active.some((a) => a.id === item.accountId) ? item : null

  function build(): Record<string, unknown> | string {
    if (!accountId) return 'Choose an account.'
    if (!payee.trim()) return 'Enter who the payment is to.'
    if (amount === null) return 'Enter an amount.'
    const fields = { accountId, payee: payee.trim(), amountCents: amount, notes: blankToNull(notes) }
    if (!item) return fields
    const out: Record<string, unknown> = {}
    if (fields.accountId !== item.accountId) out.accountId = fields.accountId
    if (fields.payee !== item.payee) out.payee = fields.payee
    if (fields.amountCents !== item.amountCents) out.amountCents = fields.amountCents
    if (fields.notes !== item.notes) out.notes = fields.notes
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

  return (
    <form
      className="cmr-rv-form cmr-lg-form"
      onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      aria-label={item ? `Edit ${item.payee}` : 'New pending item'}
      noValidate
    >
      <label className="cmr-field span2">
        <span className="cmr-label">Payee</span>
        <input
          ref={payeeRef}
          className="cmr-input"
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
          maxLength={CMR_PAYEE_MAX}
          placeholder="e.g. Ferguson Enterprises"
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
          {active.map((a) => (
            <option key={a.id} value={a.id}>{a.accountType ? `${a.name} · ${a.accountType}` : a.name}</option>
          ))}
        </Select>
      </label>

      <label className="cmr-field">
        <span className="cmr-label">Amount</span>
        <span className="cmr-money">
          <span aria-hidden="true">$</span>
          <MoneyInput valueCents={amount} onChangeCents={setAmount} placeholder="0.00" ariaLabel="Amount" />
        </span>
      </label>

      <label className="cmr-field span-all">
        <span className="cmr-label">Notes <span className="opt">(optional)</span></span>
        <textarea className="cmr-input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={CMR_PENDING_NOTES_MAX} rows={1} />
      </label>

      {error && <p className="cmr-rv-formerr span-all" role="alert">{error}</p>}
      <FormActions saving={saving} label={item ? 'Save' : 'Add item'} onCancel={onCancel} />
    </form>
  )
}
