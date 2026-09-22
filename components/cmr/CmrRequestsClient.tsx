'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import MoneyInput from '@/components/billing/MoneyInput'
import Select from '@/components/billing/Select'
import CmrIcon from '@/components/cmr/CmrIcon'
import { ApPicker, InvoiceList, initialSelection, tickedLines, usePicker } from '@/components/cmr/CmrRequestPicker'
import { useAlert, useConfirm } from '@/components/ui/DialogProvider'
import { CMR_LEDGER_PERIOD_LABEL, formatCents, formatLedgerDate, type CmrLedgerPeriod } from '@/lib/cmr/ledger'
import { initialsOf } from '@/lib/cmr/priorities'
import {
  CMR_REQUEST_NOTES_MAX,
  CMR_REQUEST_PLACED_KIND_LABEL,
  CMR_REQUEST_STATUS_LABEL,
  CMR_REQUEST_VENDOR_MAX,
  canModifyRequest,
  selectionTotal,
  type CmrRequest,
  type CmrRequestAccountRef,
  type CmrRequestsView,
} from '@/lib/cmr/requests'
import { formatDueDate, formatWeekRangeShort, shiftWeek, weekStartSunday } from '@/lib/cmr/week'

/**
 * Vendor requests — the inbox between the team and the Controller.
 *
 * Every CMR role READS the whole queue and the settled history. What each can do differs, and
 * the screen only hides controls — /api/cmr/requests* re-checks on every write:
 *
 *   • Controller — submits, places a queued request into the daily pending list or a weekly
 *     priority (choosing the day/period or week in the Place dialog), declines, and may edit or
 *     withdraw any request that is still queued.
 *   • Requester — submits, and may edit or withdraw their OWN request while it is still queued.
 *     No Place, no Decline.
 *   • Viewer — reads. No form, no row controls.
 *
 * AP Phase 2 — a request is built from the account's A/P: account → vendor (its current A/P) →
 * tick invoices (credits subtract) → the total is computed. A Requester has no free-text vendor
 * or amount any more; a Controller may still switch the form to "Enter by hand". Every request
 * built from invoices lists them on its row and in the Place dialog, with a hint on any that has
 * since left the current A/P (placing is never blocked by that).
 *
 * Every confirmation is the root DialogProvider (useConfirm/useAlert) and the Place dialog is
 * an in-app modal — never a native confirm/alert/prompt.
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const blankToNull = (s: string): string | null => (s.trim() ? s.trim() : null)
const amountText = (c: number): string => (c > 0 ? formatCents(c) : '')

const STAMP_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export default function CmrRequestsClient() {
  const confirm = useConfirm()
  const alert = useAlert()

  const [view, setView] = useState<CmrRequestsView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState<Mode>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [placing, setPlacing] = useState<CmrRequest | null>(null)

  const focusRefs = useRef(new Map<string, HTMLElement>())
  const refFor = (key: string) => (el: HTMLElement | null) => {
    if (el) focusRefs.current.set(key, el)
    else focusRefs.current.delete(key)
  }
  const focusLater = (key: string) => requestAnimationFrame(() => focusRefs.current.get(key)?.focus())

  const load = useCallback(async () => {
    const r = await api<CmrRequestsView>('/api/cmr/requests')
    if (!r.success) {
      if (r.code === 'UNAUTHORIZED') { window.location.href = '/login'; return }
      if (r.code === 'FORBIDDEN') { window.location.href = '/cmr/no-access'; return }
      setLoadError(r.error)
      return
    }
    setLoadError(null)
    setView(r.data)
  }, [])

  useEffect(() => { void load() }, [load])

  const canEdit = view?.canEdit === true
  const canRequest = view?.canRequest === true
  const locked = mode !== null || placing !== null
  const activeAccounts = view?.accounts.filter((a) => a.active) ?? []

  const mine = (r: CmrRequest): boolean => !!view && r.requestedBy === view.userId
  const mayModify = (r: CmrRequest): boolean =>
    !!view &&
    canModifyRequest(
      { requested_by: r.requestedBy, status: r.status },
      { userId: view.userId, role: canEdit ? 'controller' : canRequest ? 'requester' : 'viewer' },
    )

  // ── writes (the API re-checks every one) ─────────────────────────────────
  async function create(body: Record<string, unknown>): Promise<boolean> {
    const r = await api<{ request: CmrRequest }>('/api/cmr/requests', { method: 'POST', body: JSON.stringify(body) })
    if (!r.success) { await alert({ title: 'Could not submit the request', message: r.error }); return false }
    const q = r.data.request
    setStatus(`${q.vendor}${q.amountCents > 0 ? ` (${formatCents(q.amountCents)})` : ''} submitted.`)
    setMode(null)
    await load()
    focusLater('add')
    return true
  }

  async function saveEdit(q: CmrRequest, body: Record<string, unknown>): Promise<boolean> {
    if (Object.keys(body).length === 0) { setMode(null); focusLater(`edit:${q.id}`); return true }
    setBusyId(q.id)
    const r = await api<{ request: CmrRequest }>('/api/cmr/requests', {
      method: 'PATCH',
      body: JSON.stringify({ id: q.id, ...body }),
    })
    setBusyId(null)
    if (!r.success) {
      await alert({ title: 'Could not save the request', message: r.error })
      if (r.code === 'NOT_FOUND' || r.code === 'NOT_EDITABLE' || r.code === 'FORBIDDEN') await load()
      return false
    }
    setStatus(`${r.data.request.vendor} saved.`)
    setMode(null)
    await load()
    focusLater(`edit:${q.id}`)
    return true
  }

  async function withdraw(q: CmrRequest) {
    const ok = await confirm({
      title: `Withdraw the request for ${q.vendor}?`,
      message: `This removes the request${q.amountCents > 0 ? ` (${formatCents(q.amountCents)})` : ''} from the queue for good. The withdrawal is recorded in the audit log.`,
      confirmLabel: 'Withdraw request',
      danger: true,
    })
    if (!ok) return
    setBusyId(q.id)
    const r = await api<{ deleted: boolean }>(`/api/cmr/requests?id=${encodeURIComponent(q.id)}`, { method: 'DELETE' })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not withdraw the request', message: r.error }); await load(); return }
    setStatus(`${q.vendor} withdrawn.`)
    await load()
    focusLater('add')
  }

  async function decline(q: CmrRequest) {
    const ok = await confirm({
      title: `Decline the request for ${q.vendor}?`,
      message: `${q.requestedByName ?? 'The requester'} will see it marked declined. It stays in the history and nothing is added to the ledger. The decision is recorded in the audit log.`,
      confirmLabel: 'Decline request',
      danger: true,
    })
    if (!ok) return
    setBusyId(q.id)
    const r = await api<{ request: CmrRequest }>('/api/cmr/requests/decline', {
      method: 'POST',
      body: JSON.stringify({ id: q.id }),
    })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not decline the request', message: r.error }); await load(); return }
    setStatus(`${q.vendor} declined.`)
    await load()
  }

  async function unplace(q: CmrRequest) {
    const where = q.placedKind ? CMR_REQUEST_PLACED_KIND_LABEL[q.placedKind].toLowerCase() : 'the ledger'
    const ok = await confirm({
      title: `Undo the placement of ${q.vendor}?`,
      message: `This deletes the ${where} line this request became and puts the request back in the queue, where it can be placed somewhere else or declined. The change is recorded in the audit log.`,
      confirmLabel: 'Undo placement',
      danger: true,
    })
    if (!ok) return
    setBusyId(q.id)
    const r = await api<{ request: CmrRequest | null }>('/api/cmr/requests/unplace', {
      method: 'POST',
      body: JSON.stringify({ id: q.id }),
    })
    setBusyId(null)
    if (!r.success) { await alert({ title: 'Could not undo the placement', message: r.error }); await load(); return }
    setStatus(`${q.vendor} is back in the queue.`)
    await load()
    focusLater(`place:${q.id}`)
  }

  async function place(q: CmrRequest, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(q.id)
    const r = await api<{ where: string; placedKind: 'pending' | 'priority' }>('/api/cmr/requests/place', {
      method: 'POST',
      body: JSON.stringify({ id: q.id, ...body }),
    })
    setBusyId(null)
    if (!r.success) {
      await alert({ title: 'Could not place the request', message: r.error })
      if (r.code === 'NOT_QUEUED' || r.code === 'NOT_FOUND') { setPlacing(null); await load() }
      return false
    }
    setStatus(
      `${q.vendor} placed in ${r.data.placedKind === 'pending' ? `the pending list for ${r.data.where}` : `the week of ${r.data.where}`}.`,
    )
    setPlacing(null)
    await load()
    focusLater('add')
    return true
  }

  const queued = view?.queued ?? []
  const history = view?.history ?? []

  return (
    <>
      <header className="cmr-pagehead">
        <div>
          <h1 className="cmr-serif">Vendor requests</h1>
          <p>
            Payment requests from the team. The Controller places each one into a day’s pending items or a week’s
            priorities — or declines it.
          </p>
        </div>
      </header>

      <p className="cmr-sr-only" role="status" aria-live="polite">{status}</p>

      {view && !canRequest && (
        <div className="cmr-notice" style={{ marginBottom: 18 }}>
          <CmrIcon name="lock" size={14} />
          <span>You can view vendor requests. Only a Controller or a Requester can submit them.</span>
        </div>
      )}
      {view && canRequest && !canEdit && (
        <div className="cmr-notice" style={{ marginBottom: 18 }}>
          <CmrIcon name="lock" size={14} />
          <span>You can submit requests and change your own while they’re still queued. Only a Controller places or declines them.</span>
        </div>
      )}

      {loadError && (
        <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <button type="button" className="cmr-btn sm ghost" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {!view && !loadError && (
        <div aria-busy="true" aria-label="Loading vendor requests">
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

      {view && (
        <>
          <section className="cmr-sec" aria-labelledby="cmr-rq-queue-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-rq-queue-title">In the queue</h2>
                <span className="c">
                  {plural(view.totals.queuedCount, 'request')}
                  {view.totals.mineQueuedCount > 0 && canRequest && ` · ${view.totals.mineQueuedCount} yours`}
                </span>
              </div>
              <span className="tot">
                Asked for <b className="cmr-num">{formatCents(view.totals.queuedCents)}</b>
              </span>
              {canRequest && (
                <button
                  type="button"
                  ref={refFor('add')}
                  className="cmr-btn sm ghost"
                  onClick={() => setMode({ kind: 'add' })}
                  disabled={locked}
                  aria-label="Submit a vendor payment request"
                >
                  <CmrIcon name="plus" size={14} /> New request
                </button>
              )}
            </div>

            <div className="cmr-card">
              {queued.length === 0 && mode?.kind !== 'add' && (
                <div className="cmr-lg-empty">
                  Nothing waiting{canRequest ? ' — submit a vendor payment and the Controller will place it.' : '.'}
                </div>
              )}

              {queued.length > 0 && (
                <ul className="cmr-lg-list" aria-label="Vendor requests waiting to be placed">
                  {queued.map((q) => (
                    <RequestRow
                      key={q.id}
                      q={q}
                      today={view.today}
                      mine={mine(q)}
                      canEdit={canEdit}
                      canModify={mayModify(q)}
                      busy={busyId === q.id}
                      locked={locked}
                      editing={mode?.kind === 'edit' && mode.id === q.id}
                      accounts={view.accounts}
                      refFor={refFor}
                      onEdit={() => setMode({ kind: 'edit', id: q.id })}
                      onSave={(b) => saveEdit(q, b)}
                      onCancel={() => { setMode(null); focusLater(`edit:${q.id}`) }}
                      onWithdraw={() => void withdraw(q)}
                      onDecline={() => void decline(q)}
                      onPlace={() => setPlacing(q)}
                    />
                  ))}
                </ul>
              )}

              {canRequest && mode?.kind === 'add' && (
                <div className="cmr-lg-addwrap">
                  <RequestForm
                    accounts={activeAccounts}
                    canHandEnter={canEdit}
                    onSubmit={create}
                    onCancel={() => { setMode(null); focusLater('add') }}
                  />
                </div>
              )}

              {queued.length > 0 && (
                <div className="cmr-row cmr-lg-row cmr-lg-total">
                  <div className="who">
                    <span className="desc">Waiting on the Controller</span>
                    <span className="mt">Queued requests only · nothing here has reached the ledger yet</span>
                  </div>
                  <span className="amt cmr-num">{formatCents(view.totals.queuedCents)}</span>
                </div>
              )}
            </div>
          </section>

          <section className="cmr-sec" aria-labelledby="cmr-rq-history-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-rq-history-title">Settled</h2>
                <span className="c">
                  {view.totals.historyCount === 0
                    ? 'nothing yet'
                    : `${plural(view.totals.placedCount, 'placed', 'placed')} · ${view.totals.declinedCount} declined`}
                </span>
              </div>
            </div>
            <div className="cmr-card">
              {history.length === 0 ? (
                <div className="cmr-lg-empty">Placed and declined requests will be listed here.</div>
              ) : (
                <ul className="cmr-lg-list" aria-label="Requests already placed or declined">
                  {history.map((q) => (
                    <HistoryRow
                      key={q.id}
                      q={q}
                      today={view.today}
                      mine={mine(q)}
                      canEdit={canEdit}
                      busy={busyId === q.id}
                      locked={locked}
                      undoRef={refFor(`undo:${q.id}`)}
                      onUndo={() => void unplace(q)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {canEdit && (queued.length > 0 || view.totals.placedCount > 0) && (
            <p className="cmr-hint">
              Place puts the request on a day’s pending list or in a week’s priorities — you pick which when you place it.
              Declining keeps it in the history so the requester can see the answer. Undo placement takes a placed request
              back: the line it became is deleted and the request returns to the queue — until that line has been paid or
              moved on, which the row will say.
            </p>
          )}
        </>
      )}

      {placing && view && (
        <PlaceDialog
          q={placing}
          today={view.today}
          thisWeekStart={view.thisWeekStart}
          busy={busyId === placing.id}
          onPlace={(b) => place(placing, b)}
          onCancel={() => { const id = placing.id; setPlacing(null); focusLater(`place:${id}`) }}
        />
      )}
    </>
  )
}

// ── one queued request ──────────────────────────────────────────────────────

function RequestRow({
  q,
  today,
  mine,
  canEdit,
  canModify,
  busy,
  locked,
  editing,
  accounts,
  refFor,
  onEdit,
  onSave,
  onCancel,
  onWithdraw,
  onDecline,
  onPlace,
}: {
  q: CmrRequest
  today: string
  mine: boolean
  canEdit: boolean
  canModify: boolean
  busy: boolean
  locked: boolean
  editing: boolean
  accounts: CmrRequestAccountRef[]
  refFor: (key: string) => (el: HTMLElement | null) => void
  onEdit: () => void
  onSave: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
  onWithdraw: () => void
  onDecline: () => void
  onPlace: () => void
}) {
  const overdue = q.dueDate !== null && q.dueDate < today
  const disabled = locked || busy
  const year = today.slice(0, 4)
  const cls = ['cmr-row', 'cmr-lg-row', 'cmr-rq-row', mine ? 'mine' : '', editing ? 'editing' : ''].filter(Boolean).join(' ')

  if (editing) {
    return (
      <li className={cls} aria-busy={busy || undefined}>
        <div className="cmr-lg-editwrap">
          <RequestForm initial={q} accounts={accounts} canHandEnter={canEdit} onSubmit={onSave} onCancel={onCancel} />
        </div>
      </li>
    )
  }

  return (
    <li className={cls} aria-busy={busy || undefined}>
      <div className="who">
        <span className="desc">
          <span className="nm">{q.vendor}</span>
          {mine && <span className="cmr-pill requester">Yours</span>}
          {overdue && <span className="cmr-pill danger">Overdue</span>}
          {!q.accountActive && <span className="cmr-pill warn">Account inactive</span>}
        </span>
        <span className="mt">
          {q.accountName}
          {' · asked by '}
          {q.requestedByName ?? 'someone who has since been removed'}
          {q.dueDate && (
            <>
              {' · due '}
              <time dateTime={q.dueDate}>{formatDueDate(q.dueDate, year)}</time>
            </>
          )}
          {' · '}
          <span className="cmr-rq-when">{STAMP_FMT.format(new Date(q.createdAt))}</span>
        </span>
        {q.notes && <span className="note">{q.notes}</span>}
        {q.fromAp && <InvoiceList invoices={q.invoices} totalCents={q.amountCents} />}
      </div>
      <span className="amt cmr-num">
        {q.amountCents > 0 ? amountText(q.amountCents) : <span className="cmr-sr-only">No amount</span>}
      </span>
      {(canEdit || canModify) && (
        <div className="ctl">
          {canEdit && (
            <div className="cmr-rq-decide" role="group" aria-label={`Decide the request for ${q.vendor}`}>
              <button
                type="button"
                ref={refFor(`place:${q.id}`)}
                className="cmr-btn sm cmr-rq-place"
                onClick={onPlace}
                disabled={disabled}
                aria-label={`Place the request for ${q.vendor}`}
              >
                <CmrIcon name="check" size={14} /> Place
              </button>
              <button
                type="button"
                className="cmr-btn sm ghost"
                onClick={onDecline}
                disabled={disabled}
                aria-label={`Decline the request for ${q.vendor}`}
              >
                Decline
              </button>
            </div>
          )}
          {canModify && (
            <>
              <button
                type="button"
                ref={refFor(`edit:${q.id}`)}
                className="cmr-btn sm ghost"
                onClick={onEdit}
                disabled={disabled}
                aria-label={`Edit the request for ${q.vendor}`}
                title="Edit"
              >
                <CmrIcon name="edit" size={14} /> <span className="cmr-pr-lbl">Edit</span>
              </button>
              <button
                type="button"
                className="cmr-iconbtn sm danger"
                onClick={onWithdraw}
                disabled={disabled}
                aria-label={`Withdraw the request for ${q.vendor}`}
                title="Withdraw"
              >
                <CmrIcon name="trash" />
              </button>
            </>
          )}
        </div>
      )}
    </li>
  )
}

// ── one settled request (read-only, every role) ─────────────────────────────

function HistoryRow({
  q,
  today,
  mine,
  canEdit,
  busy,
  locked,
  undoRef,
  onUndo,
}: {
  q: CmrRequest
  today: string
  mine: boolean
  canEdit: boolean
  busy: boolean
  locked: boolean
  undoRef: (el: HTMLElement | null) => void
  onUndo: () => void
}) {
  const declined = q.status === 'declined'
  const year = today.slice(0, 4)
  // Undo is offered on a PLACED request only, and disabled — with the reason — once the row it
  // created has been paid or moved on. The API re-checks both.
  const showUndo = canEdit && q.status === 'placed'
  return (
    <li className={`cmr-row cmr-lg-row cmr-rq-row done${declined ? ' declined' : ''}`}>
      <div className="who">
        <span className="desc">
          <span className="nm">{q.vendor}</span>
          <span className={`cmr-pill ${declined ? 'danger' : 'ok'}`}>
            {!declined && <CmrIcon name="check" size={11} />}
            {CMR_REQUEST_STATUS_LABEL[q.status]}
          </span>
          {q.placedKind && <span className="cmr-pill viewer">{CMR_REQUEST_PLACED_KIND_LABEL[q.placedKind]}</span>}
          {mine && <span className="cmr-pill requester">Yours</span>}
        </span>
        <span className="mt">
          {q.accountName}
          {' · asked by '}
          {q.requestedByName ?? 'someone who has since been removed'}
          {q.dueDate && (
            <>
              {' · due '}
              <time dateTime={q.dueDate}>{formatDueDate(q.dueDate, year)}</time>
            </>
          )}
          {q.placedAt && (
            <>
              {' · '}
              <span className="cmr-pr-stamp">
                Placed {STAMP_FMT.format(new Date(q.placedAt))}
                {q.placedByName && (
                  <>
                    {' · '}
                    <abbr title={q.placedByName}>{initialsOf(q.placedByName)}</abbr>
                  </>
                )}
              </span>
            </>
          )}
        </span>
        {q.notes && <span className="note">{q.notes}</span>}
        {q.fromAp && <InvoiceList invoices={q.invoices} totalCents={q.amountCents} />}
        {showUndo && q.unplaceBlockedReason && (
          <span className="mt cmr-rq-blocked">
            <CmrIcon name="lock" size={11} /> Can’t be undone: {q.unplaceBlockedReason}
          </span>
        )}
      </div>
      <span className="amt cmr-num">
        {q.amountCents > 0 ? amountText(q.amountCents) : <span className="cmr-sr-only">No amount</span>}
      </span>
      {showUndo && (
        <div className="ctl">
          <button
            type="button"
            ref={undoRef}
            className="cmr-btn sm ghost"
            onClick={onUndo}
            disabled={locked || busy || !q.canUnplace}
            aria-label={`Undo the placement of ${q.vendor}`}
            title={q.unplaceBlockedReason ?? 'Delete the line it became and put it back in the queue'}
          >
            <CmrIcon name="undo" size={14} /> <span className="cmr-pr-lbl">Undo placement</span>
          </button>
        </div>
      )}
    </li>
  )
}

// ── submit / edit form ──────────────────────────────────────────────────────

/**
 * account → vendor → invoices. A Requester only ever composes from A/P. A Controller may switch
 * to "Enter by hand" (vendor + optional amount), and a request that was hand-entered opens that
 * way. Editing a request built from invoices re-picks them only if the selection changes — a
 * note or date change alone never re-composes it.
 */
function RequestForm({
  initial,
  accounts,
  canHandEnter,
  onSubmit,
  onCancel,
}: {
  initial?: CmrRequest
  accounts: CmrRequestAccountRef[]
  canHandEnter: boolean
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  // Editing keeps the request's own account even if it has since been deactivated; the picker
  // otherwise offers active accounts only.
  const choices = accounts.filter((a) => a.active || a.id === initial?.accountId)
  const startHand = !!initial && !initial.fromAp
  const [hand, setHand] = useState(startHand && canHandEnter)
  const [accountId, setAccountId] = useState(initial?.accountId ?? choices[0]?.id ?? '')
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A/P mode
  const initialVendor = initial?.fromAp ? initial.invoices[0]?.vendorName ?? '' : ''
  const [vendorName, setVendorName] = useState(initialVendor)
  const [selected, setSelected] = useState<Set<string>>(() => (initial?.fromAp ? initialSelection(initial.invoices) : new Set()))
  const [reload, setReload] = useState(0)
  const picker = usePicker(hand ? '' : accountId, reload)

  // Hand mode (Controller)
  const [vendor, setVendor] = useState(initial && !initial.fromAp ? initial.vendor : '')
  const [amount, setAmount] = useState<number | null>(initial && !initial.fromAp && initial.amountCents > 0 ? initial.amountCents : null)

  const firstRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    requestAnimationFrame(() => firstRef.current?.querySelector<HTMLElement>('input, select, button')?.focus())
  }, [])

  const ticked = tickedLines(picker, vendorName, selected)
  const total = selectionTotal(ticked)
  const account = choices.find((a) => a.id === accountId)
  const staleOnOpen = initial?.fromAp ? initial.staleInvoiceCount : 0

  function changeAccount(id: string) {
    setAccountId(id)
    if (!hand) { setVendorName(''); setSelected(new Set()) }
  }

  function build(): Record<string, unknown> | string {
    if (!accountId) return 'Choose an account.'
    const base = { dueDate: dueDate || null, notes: blankToNull(notes) }

    if (hand) {
      if (!vendor.trim()) return 'Enter a vendor name.'
      const fields = { accountId, vendor: vendor.trim(), amountCents: amount ?? 0, ...base }
      if (!initial) return fields
      const out: Record<string, unknown> = {}
      if (fields.accountId !== initial.accountId) out.accountId = fields.accountId
      if (fields.vendor !== initial.vendor) out.vendor = fields.vendor
      if (fields.amountCents !== initial.amountCents) out.amountCents = fields.amountCents
      if (fields.dueDate !== initial.dueDate) out.dueDate = fields.dueDate
      if (fields.notes !== initial.notes) out.notes = fields.notes
      return out
    }

    // A request entered by hand before requests came from A/P: its note and date may still be
    // changed on their own; picking invoices rebuilds it.
    if (initial && !initial.fromAp && !vendorName && selected.size === 0) {
      if (accountId !== initial.accountId) return 'To move this request to another account, pick that account’s vendor and invoices.'
      const out: Record<string, unknown> = {}
      if (base.dueDate !== initial.dueDate) out.dueDate = base.dueDate
      if (base.notes !== initial.notes) out.notes = base.notes
      return out
    }
    if (!vendorName) return 'Choose a vendor.'
    if (!ticked.length) return 'Tick at least one invoice.'
    if (total <= 0) return 'The credits you ticked cancel out the bills. Tick more bills or fewer credits.'
    const composed = { accountId, vendorName, apLineIds: [...selected].filter((id) => ticked.some((l) => l.id === id)), ...base }
    if (!initial) return composed

    // Editing: re-compose only when the picked invoices actually change.
    const before = initial.fromAp ? initialSelection(initial.invoices) : new Set<string>()
    const sameSel =
      initial.fromAp &&
      initial.staleInvoiceCount === 0 &&
      accountId === initial.accountId &&
      vendorName === initialVendor &&
      before.size === composed.apLineIds.length &&
      composed.apLineIds.every((id) => before.has(id))
    if (!sameSel) return composed
    const out: Record<string, unknown> = {}
    if (base.dueDate !== initial.dueDate) out.dueDate = base.dueDate
    if (base.notes !== initial.notes) out.notes = base.notes
    return out
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = build()
    if (typeof body === 'string') { setError(body); return }
    setError(null)
    setSaving(true)
    const ok = await onSubmit(body)
    setSaving(false)
    // A stale selection: fetch the account's A/P again so the list is current.
    if (!ok && !hand) setReload((n) => n + 1)
  }

  const uid = initial?.id ?? 'new'
  const legacyNoteEdit = !!initial && !initial.fromAp && !hand && !vendorName && selected.size === 0
  const canSubmit = hand ? choices.length > 0 : legacyNoteEdit || (ticked.length > 0 && total > 0)
  return (
    <form
      className="cmr-rv-form cmr-lg-form cmr-rq-form"
      onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      aria-label={initial ? `Edit the request for ${initial.vendor}` : 'New vendor payment request'}
      noValidate
    >
      <div ref={firstRef} className="cmr-rq-formtop span-all">
        <label className="cmr-field">
          <span className="cmr-label">Account</span>
          <Select value={accountId} onChange={changeAccount} ariaLabel="Account">
            {choices.length === 0 && <option value="">No active accounts</option>}
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.accountType ? ` — ${a.accountType}` : ''}
                {a.active ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </label>
        {canHandEnter && !initial?.fromAp && (
          <div className="cmr-field">
            <span className="cmr-label">Build it from</span>
            <div className="cmr-seg cmr-rq-modeseg" role="group" aria-label="How to build this request">
              <button type="button" aria-pressed={!hand} onClick={() => { setHand(false); setError(null) }} disabled={saving}>
                A/P invoices
              </button>
              <button type="button" aria-pressed={hand} onClick={() => { setHand(true); setError(null) }} disabled={saving}>
                Enter by hand
              </button>
            </div>
          </div>
        )}
      </div>

      {!hand && initial && !initial.fromAp && (
        <p className="cmr-rv-formnote span-all">
          This request was entered by hand ({initial.vendor}
          {initial.amountCents > 0 ? `, ${formatCents(initial.amountCents)}` : ''}). You can change its note and date here, or
          pick a vendor’s invoices to rebuild it from A/P.
        </p>
      )}

      {!hand && staleOnOpen > 0 && (
        <p className="cmr-rv-formnote span-all">
          {staleOnOpen === initial?.invoices.length
            ? 'None of this request’s invoices are in the current A/P any more.'
            : `${staleOnOpen} of this request’s invoices ${staleOnOpen === 1 ? 'is' : 'are'} no longer in the current A/P.`}{' '}
          Saving re-picks from what is there now.
        </p>
      )}

      {!hand && (
        <ApPicker
          uid={uid}
          state={picker}
          accountName={account?.name ?? 'This account'}
          vendorName={vendorName}
          onVendor={setVendorName}
          selected={selected}
          onSelected={setSelected}
          onRetry={() => setReload((n) => n + 1)}
          disabled={saving}
          handEntryHint={
            canHandEnter ? (
              <>
                {' '}Or{' '}
                <button type="button" className="cmr-linkbtn" onClick={() => setHand(true)}>enter this request by hand</button>.
              </>
            ) : undefined
          }
        />
      )}

      {hand && (
        <>
          <label className="cmr-field span2">
            <span className="cmr-label">Vendor</span>
            <input
              className="cmr-input"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              maxLength={CMR_REQUEST_VENDOR_MAX}
              placeholder="e.g. Sunbelt Rentals"
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
        </>
      )}

      <label className="cmr-field">
        <span className="cmr-label">Needed by <span className="opt">(optional)</span></span>
        <input
          className="cmr-input"
          type="date"
          value={dueDate}
          min="2000-01-01"
          max="2100-12-31"
          onChange={(e) => setDueDate(e.target.value)}
          id={`cmr-rq-due-${uid}`}
        />
      </label>

      <label className={`cmr-field ${hand ? 'span-all' : 'span2'}`}>
        <span className="cmr-label">Notes <span className="opt">(optional)</span></span>
        <textarea
          className="cmr-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={CMR_REQUEST_NOTES_MAX}
          rows={1}
          placeholder="Anything the Controller should know"
        />
      </label>

      {error && <p className="cmr-rv-formerr span-all" role="alert">{error}</p>}

      <div className="acts span-all">
        <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="cmr-btn sm" disabled={saving || !canSubmit}>
          <CmrIcon name={initial ? 'check' : 'plus'} size={14} />
          {saving ? 'Saving…' : initial ? 'Save' : !hand && total > 0 ? `Request ${formatCents(total)}` : 'Submit request'}
        </button>
      </div>
    </form>
  )
}

// ── the Place dialog (in-app; never a native prompt) ────────────────────────

function PlaceDialog({
  q,
  today,
  thisWeekStart,
  busy,
  onPlace,
  onCancel,
}: {
  q: CmrRequest
  today: string
  thisWeekStart: string
  busy: boolean
  onPlace: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  // Pre-filled from the request's due date: its own day (AM) for pending, its own week for a
  // priority. The Controller changes either freely.
  const [target, setTarget] = useState<'pending' | 'priority'>('pending')
  const [date, setDate] = useState(q.dueDate ?? today)
  const [period, setPeriod] = useState<CmrLedgerPeriod>('am')
  const [week, setWeek] = useState(q.dueDate ? weekStartSunday(q.dueDate) : thisWeekStart)
  const [saving, setSaving] = useState(false)

  const wrap = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)

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
    await onPlace(target === 'pending' ? { target, date, period } : { target, weekStart: week })
    setSaving(false)
  }

  const busyNow = saving || busy

  return (
    <div className="cmr-rq-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div
        ref={wrap}
        className="cmr-rq-dialog cmr-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmr-rq-place-title"
        aria-describedby="cmr-rq-place-desc"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="cmr-rq-place-title" className="cmr-serif">Place {q.vendor}</h2>
        <p id="cmr-rq-place-desc">
          {q.accountName}
          {q.amountCents > 0 ? ` · ${formatCents(q.amountCents)}` : ' · no amount'}
          {q.dueDate ? ` · needed by ${formatDueDate(q.dueDate, today.slice(0, 4))}` : ''}
        </p>
        {q.fromAp && (
          <div className="cmr-rq-placeinvs">
            <span className="cmr-label">Built from {q.invoices.length === 1 ? 'this invoice' : `these ${q.invoices.length} invoices`}</span>
            <InvoiceList invoices={q.invoices} totalCents={q.amountCents} open />
            {q.staleInvoiceCount > 0 && (
              <p className="cmr-rq-dialognote cmr-rq-stale">
                <CmrIcon name="alert" size={12} />{' '}
                {q.staleInvoiceCount === q.invoices.length
                  ? 'None of these are in the current A/P any more'
                  : `${q.staleInvoiceCount} of these ${q.staleInvoiceCount === 1 ? 'is' : 'are'} no longer in the current A/P`}{' '}
                — maybe paid or re-imported. You can still place it; it keeps the amount it was requested with.
              </p>
            )}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="cmr-seg cmr-rq-seg" role="group" aria-label="Where to place this request">
            <button
              type="button"
              ref={firstRef}
              aria-pressed={target === 'pending'}
              onClick={() => setTarget('pending')}
              disabled={busyNow}
            >
              Pending item
            </button>
            <button type="button" aria-pressed={target === 'priority'} onClick={() => setTarget('priority')} disabled={busyNow}>
              Weekly priority
            </button>
          </div>

          {target === 'pending' ? (
            <div className="cmr-rq-dialogfields">
              <label className="cmr-field">
                <span className="cmr-label">Day</span>
                <input
                  className="cmr-input"
                  type="date"
                  value={date}
                  min="2000-01-01"
                  max="2100-12-31"
                  onChange={(e) => setDate(e.target.value)}
                  disabled={busyNow}
                  required
                />
              </label>
              <div className="cmr-field">
                <span className="cmr-label">Snapshot</span>
                <div className="cmr-seg cmr-lg-dir" role="group" aria-label="AM or PM">
                  {(['am', 'pm'] as const).map((p) => (
                    <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} disabled={busyNow}>
                      {CMR_LEDGER_PERIOD_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
              <p className="cmr-rq-dialognote span-all">
                Goes into the pending breakdown for{' '}
                <b>{formatLedgerDate(date)} {CMR_LEDGER_PERIOD_LABEL[period]}</b> under {q.accountName}, and reduces that
                snapshot’s balance.{q.fromAp && ' Its notes list the invoices.'}
              </p>
            </div>
          ) : (
            <div className="cmr-rq-dialogfields">
              <label className="cmr-field">
                <span className="cmr-label">Week</span>
                <input
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
                  <button type="button" onClick={() => setWeek(thisWeekStart)} disabled={busyNow}>This week</button>
                  <button type="button" onClick={() => setWeek(shiftWeek(week, 1))} disabled={busyNow} aria-label="The week after">
                    <CmrIcon name="right" size={14} />
                  </button>
                </div>
              </div>
              <p className="cmr-rq-dialognote span-all">
                Goes into the priorities for the week of <b>{formatWeekRangeShort(week)}</b>, open, with the request’s
                amount, due date and notes{q.fromAp && ' (listing the invoices)'}.
              </p>
            </div>
          )}

          <div className="acts">
            <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={busyNow}>Cancel</button>
            <button type="submit" className="cmr-btn sm" disabled={busyNow}>
              <CmrIcon name="check" size={14} />
              {busyNow ? 'Placing…' : target === 'pending' ? 'Add to that day' : 'Add to that week'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
