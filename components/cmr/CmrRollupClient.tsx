'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Select from '@/components/billing/Select'
import CmrIcon from '@/components/cmr/CmrIcon'
import { useAlert } from '@/components/ui/DialogProvider'
import {
  CMR_LEDGER_PERIOD_LABEL,
  formatBalanceCents,
  formatCents,
  formatLedgerDate,
  type CmrLedgerPeriod,
} from '@/lib/cmr/ledger'
import { formatWeekRange, formatWeekRangeShort, shiftWeek, weekStartSunday } from '@/lib/cmr/week'
import { formatOccurrence } from '@/lib/cmr/recurring-due'
import {
  accountsInUse,
  dueThisWeek,
  dueTotalCents,
  rollupRecurringTotals,
  type CmrRollupSnapshot,
  type CmrRollupVendorState,
  type CmrRollupView,
} from '@/lib/cmr/rollup'

/**
 * Weekly rollup — the whole week on one page: the cash position through it, what is pending and
 * what the priorities still need, what the recurring schedule costs by frequency, and the
 * vendors that are DUE and have not been entered yet.
 *
 * Every CMR role reads this screen. Only a Controller (`canEdit` from the API) sees Add on a due
 * vendor, and Add never writes on its own: it opens the same pick-a-target dialog as placing a
 * vendor request, and /api/cmr/recurring/place re-checks the Controller role and the occurrence
 * before anything is written. Hiding the button is cosmetic.
 *
 * The account filter and the by-frequency figures are computed here from the one response
 * (lib/cmr/rollup), so switching accounts is instant and the server and the browser agree.
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const dayLabel = (d: string): string => {
  const [y, m, day] = d.split('-').map(Number)
  return WEEKDAY.format(new Date(Date.UTC(y, m - 1, day)))
}
const dayNumber = (d: string): string => String(Number(d.slice(8, 10)))

export default function CmrRollupClient({ initialWeek }: { initialWeek: string }) {
  const alert = useAlert()

  const [week, setWeek] = useState(initialWeek)
  const [view, setView] = useState<CmrRollupView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [accountId, setAccountId] = useState<string>('')
  const [adding, setAdding] = useState<CmrRollupVendorState | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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
    const r = await api<CmrRollupView>(`/api/cmr/rollup?week=${encodeURIComponent(w)}`)
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
    setAdding(null)
    setWeek(nextWeek)
  }

  // The data on screen must be for the week in the controls; otherwise show a skeleton.
  const current = view && view.weekStart === week ? view : null
  const canEdit = current?.canEdit === true
  const isThisWeek = current ? current.thisWeekStart === week : false
  const thisWeek = view?.thisWeekStart ?? null
  const range = formatWeekRange(week)

  const filter = accountId === '' ? null : accountId
  const filterName = current?.accounts.find((a) => a.id === filter)?.name ?? null

  const vendors = useMemo(() => current?.recurring ?? [], [current])
  const filterAccounts = useMemo(
    () => (current ? accountsInUse(vendors, current.accounts) : []),
    [current, vendors],
  )
  const totals = useMemo(() => rollupRecurringTotals(vendors, filter), [vendors, filter])
  const due = useMemo(() => dueThisWeek(vendors, filter), [vendors, filter])
  const dueCents = useMemo(() => dueTotalCents(vendors, filter), [vendors, filter])
  const handledCount = useMemo(
    () => vendors.filter((v) => v.state === 'handled' && (filter === null || v.accountId === filter)).length,
    [vendors, filter],
  )

  // An account that stops appearing (a different week, a vendor retired) falls back to All.
  useEffect(() => {
    if (filter && current && !filterAccounts.some((a) => a.id === filter)) setAccountId('')
  }, [filter, current, filterAccounts])

  async function place(v: CmrRollupVendorState, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(v.vendorId)
    const r = await api<{ placedKind: 'pending' | 'priority'; where: string }>('/api/cmr/recurring/place', {
      method: 'POST',
      body: JSON.stringify({ id: v.vendorId, week, ...body }),
    })
    setBusyId(null)
    if (!r.success) {
      await alert({ title: `Could not add ${v.vendorName}`, message: r.error })
      // Whatever the refusal was, the screen's idea of this vendor is out of date.
      setAdding(null)
      await reload()
      return false
    }
    setStatus(
      r.data.placedKind === 'pending'
        ? `${v.vendorName} added to the pending list for ${r.data.where}.`
        : `${v.vendorName} added to the priorities for the week of ${r.data.where}.`,
    )
    setAdding(null)
    await reload()
    return true
  }

  return (
    <>
      <header className="cmr-pagehead cmr-lg-head">
        <div>
          <h1 className="cmr-serif">Weekly rollup</h1>
          <p>
            <time dateTime={week}>{range}</time> · Sunday to Saturday · Pacific
          </p>
        </div>
        <div className="actions">
          <div className="cmr-lg-datenav" role="group" aria-label="Choose the week">
            <button type="button" className="cmr-iconbtn sm" onClick={() => goTo(shiftWeek(week, -1))} aria-label="Previous week" title="Previous week">
              <CmrIcon name="left" />
            </button>
            <span className="cmr-pr-weeklabel cmr-num" aria-live="polite">{formatWeekRangeShort(week)}</span>
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
          <span>You can view the weekly rollup. Only a Controller can add a due vendor to the ledger.</span>
        </div>
      )}

      {loadError && (
        <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <button type="button" className="cmr-btn sm ghost" onClick={() => void reload()}>Retry</button>
        </div>
      )}

      {!current && !loadError && (
        <div aria-busy="true" aria-label={`Loading the rollup for ${range}`}>
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
          <CashHero view={current} isThisWeek={isThisWeek} dueCents={dueCents} dueCount={due.length} />

          {/* ── the week, day by day ── */}
          <section className="cmr-sec" aria-labelledby="cmr-ro-cash-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-ro-cash-title">Cash through the week</h2>
                <span className="c">{plural(current.cash.snapshotCount, 'saved snapshot')}</span>
              </div>
            </div>
            <p className="cmr-lg-blurb">
              Each day&rsquo;s AM and PM snapshots, with the balance after that snapshot&rsquo;s adjustments and pending
              items. A day with nothing saved has no snapshot — it is not a zero.
            </p>
            <div className="cmr-card">
              <ul className="cmr-ro-days" aria-label="Each day of the week">
                {current.days.map((d) => (
                  <li key={d.date} className={`cmr-row cmr-ro-day${d.date === current.today ? ' today' : ''}`}>
                    <span className="d">
                      <span className="wd">{dayLabel(d.date)}</span>
                      <span className="dn cmr-num">{dayNumber(d.date)}</span>
                      {d.date === current.today && <span className="cmr-pill accent">Today</span>}
                    </span>
                    <div className="snaps">
                      {(['am', 'pm'] as const).map((p) => (
                        <Snapshot key={p} period={p} snapshot={d[p]} date={d.date} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ── recurring, by frequency, for one account or all ── */}
          <section className="cmr-sec" aria-labelledby="cmr-ro-rec-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-ro-rec-title">Recurring schedule</h2>
                <span className="c">
                  {filterName ? filterName : 'All accounts'}
                  {' · '}
                  {plural(due.length, 'still due')}
                  {handledCount > 0 && ` · ${handledCount} handled`}
                </span>
              </div>
              <label className="cmr-ro-filter">
                <span className="cmr-label">Account</span>
                <Select value={accountId} onChange={setAccountId} ariaLabel="Filter by account">
                  <option value="">All accounts</option>
                  {filterAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.active ? '' : ' (inactive)'}</option>
                  ))}
                </Select>
              </label>
            </div>
            <p className="cmr-lg-blurb">
              What one full cycle of each frequency costs, and how much of this week&rsquo;s share is still to be
              entered. Vendors that are inactive, on hold or without a schedule are left out.
            </p>
            <div className="cmr-card">
              <ul className="cmr-ro-freqs" aria-label="Recurring totals by frequency">
                {totals.map((t) => (
                  <li key={t.frequency} className={`cmr-row cmr-ro-freq${t.vendorCount === 0 ? ' empty' : ''}`}>
                    <div className="who">
                      <span className="desc"><span className="nm">{t.label}</span></span>
                      <span className="mt">
                        {t.vendorCount === 0
                          ? 'No vendors'
                          : `${plural(t.vendorCount, 'vendor')} · ${t.dueCount} due, ${t.handledCount} handled this period`}
                      </span>
                    </div>
                    <span className="due cmr-num" aria-label={`${t.label} still due ${formatCents(t.dueCents)}`}>
                      {t.dueCount > 0 ? formatCents(t.dueCents) : '—'}
                    </span>
                    <span className="amt cmr-num" aria-label={`${t.label} full cycle ${formatCents(t.totalCents)}`}>
                      {formatCents(t.totalCents)}
                    </span>
                  </li>
                ))}
                <li className="cmr-row cmr-ro-freq total">
                  <div className="who"><span className="desc"><span className="nm">Due this week</span></span></div>
                  <span className="due cmr-num">{formatCents(dueCents)}</span>
                  <span className="amt cmr-num" aria-hidden="true" />
                </li>
              </ul>
            </div>
          </section>

          {/* ── what is due, and the one-click add ── */}
          <section className="cmr-sec" aria-labelledby="cmr-ro-due-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-ro-due-title">Due this week</h2>
                <span className="c">{plural(due.length, 'vendor')}{filterName ? ` · ${filterName}` : ''}</span>
              </div>
              <span className="tot">Total <b className="cmr-num">{formatCents(dueCents)}</b></span>
            </div>
            <p className="cmr-lg-blurb">
              Scheduled on or before {formatOccurrence(current.weekEnd, current.today.slice(0, 4))} and not entered yet.
              Nothing is added on its own — {canEdit ? 'Add opens a dialog so you choose where it lands.' : 'a Controller confirms each one.'}
            </p>
            <div className="cmr-card">
              {due.length === 0 ? (
                <div className="cmr-lg-empty">
                  {handledCount > 0
                    ? 'Everything scheduled for this week has been entered.'
                    : 'Nothing recurring is due this week.'}
                </div>
              ) : (
                <ul className="cmr-ro-due" aria-label="Recurring vendors due this week">
                  {due.map((v) => (
                    <DueRow
                      key={v.vendorId}
                      vendor={v}
                      today={current.today}
                      canEdit={canEdit}
                      busy={busyId === v.vendorId}
                      locked={adding !== null}
                      onAdd={() => setAdding(v)}
                      addBtnRef={refFor(`add:${v.vendorId}`)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {canEdit && (
            <p className="cmr-hint">
              Adding a due vendor records where it came from, so it drops off this list and cannot be added twice for
              the same period. Change what is scheduled on the Recurring screen.
            </p>
          )}

          {adding && (
            <AddDialog
              vendor={adding}
              today={current.today}
              thisWeekStart={current.thisWeekStart}
              weekStart={current.weekStart}
              busy={busyId === adding.vendorId}
              onPlace={(body) => place(adding, body)}
              onCancel={() => { const id = adding.vendorId; setAdding(null); focusLater(`add:${id}`) }}
            />
          )}
        </>
      )}
    </>
  )
}

// ── the masthead ────────────────────────────────────────────────────────────

function CashHero({
  view,
  isThisWeek,
  dueCents,
  dueCount,
}: {
  view: CmrRollupView
  isThisWeek: boolean
  dueCents: number
  dueCount: number
}) {
  const { cash } = view
  const nothing = cash.snapshotCount === 0
  const whole = formatBalanceCents(cash.closingCents)
  const dot = whole.lastIndexOf('.')
  const stamp = (date: string | null, period: CmrLedgerPeriod | null) =>
    date && period ? `${formatLedgerDate(date, { year: false })} ${CMR_LEDGER_PERIOD_LABEL[period]}` : '—'

  return (
    <section className="cmr-hero cmr-lg-hero" aria-labelledby="cmr-ro-hero-cap">
      <div className="l">
        <h2 className="cmr-hero-cap" id="cmr-ro-hero-cap">
          {nothing ? 'No cash saved this week' : `Balance at ${stamp(cash.closingDate, cash.closingPeriod)}`}
          {isThisWeek && <span className="cmr-lg-chip">This week</span>}
          {!nothing && cash.closingCents < 0 && <span className="cmr-lg-chip short">Short</span>}
        </h2>
        <p className={`cmr-hero-big cmr-serif cmr-num${cash.closingCents < 0 ? ' neg' : ''}`}>
          {nothing ? (
            '—'
          ) : (
            <>
              {whole.slice(0, dot)}
              <span className="c">{whole.slice(dot)}</span>
            </>
          )}
        </p>
        <div className="cmr-hero-rule" aria-hidden="true" />
        <p className="cmr-hero-meta">
          {nothing ? (
            <>No AM or PM snapshot was saved in this week.</>
          ) : (
            <>
              Opened at <b>{formatBalanceCents(cash.openingCents)}</b> — beginning cash on{' '}
              {stamp(cash.openingDate, cash.openingPeriod)}
            </>
          )}
        </p>
      </div>
      <dl className="cmr-lg-stmt">
        <div>
          <dt>Pending in bank</dt>
          <dd className="cmr-num">{formatCents(view.pending.totalCents)}</dd>
        </div>
        <div>
          <dt>Priorities still needed</dt>
          <dd className="cmr-num">{formatCents(view.priorities.neededCents)}</dd>
        </div>
        <div>
          <dt>Recurring due ({dueCount})</dt>
          <dd className="cmr-num">{formatCents(dueCents)}</dd>
        </div>
        <div className="total">
          <dt>Still to cover</dt>
          <dd className="cmr-num">{formatCents(view.pending.openCents + view.priorities.neededCents + dueCents)}</dd>
        </div>
      </dl>
    </section>
  )
}

function Snapshot({ period, snapshot, date }: { period: CmrLedgerPeriod; snapshot: CmrRollupSnapshot | null; date: string }) {
  const label = CMR_LEDGER_PERIOD_LABEL[period]
  if (!snapshot) {
    return (
      <span className="snap none">
        <span className="p">{label}</span>
        <span className="v" aria-label={`${label}: nothing saved`}>—</span>
      </span>
    )
  }
  return (
    <span className={`snap${snapshot.currentBalanceCents < 0 ? ' neg' : ''}`}>
      <span className="p">{label}</span>
      <span
        className="v cmr-num"
        title={`Beginning ${formatBalanceCents(snapshot.beginningCashCents)} · pending ${formatCents(snapshot.pendingRollupCents)}`}
      >
        <abbr title={`Balance on ${formatLedgerDate(date)} ${label}`}>{formatBalanceCents(snapshot.currentBalanceCents)}</abbr>
      </span>
    </span>
  )
}

// ── one due vendor ──────────────────────────────────────────────────────────

function DueRow({
  vendor: v,
  today,
  canEdit,
  busy,
  locked,
  onAdd,
  addBtnRef,
}: {
  vendor: CmrRollupVendorState
  today: string
  canEdit: boolean
  busy: boolean
  locked: boolean
  onAdd: () => void
  addBtnRef: (el: HTMLButtonElement | null) => void
}) {
  const overdue = v.occurrenceDate !== null && v.occurrenceDate < today
  return (
    <li className={`cmr-row cmr-ro-row${overdue ? ' overdue' : ''}`} aria-busy={busy || undefined}>
      <div className="who">
        <span className="desc">
          <span className="nm">{v.vendorName}</span>
          {overdue && <span className="cmr-pill warn">Was due {formatOccurrence(v.occurrenceDate as string, today.slice(0, 4))}</span>}
        </span>
        <span className="mt">
          {v.accountName}
          {!v.accountActive && <span className="acct-off"> (inactive account)</span>}
          {' · '}
          {v.scheduleText}
          {' · '}
          {overdue ? 'scheduled' : 'due'} {formatOccurrence(v.occurrenceDate as string, today.slice(0, 4))}
        </span>
        {v.notes && <span className="note">{v.notes}</span>}
      </div>
      <span className="amt cmr-num" aria-label={`Amount ${formatCents(v.suggestedCents)}`}>
        {formatCents(v.suggestedCents)}
        {v.lastAmountSentCents !== null && v.lastAmountSentCents !== v.amountCents && (
          <span className="sub">last sent</span>
        )}
      </span>
      {canEdit && (
        <div className="ctl">
          <button
            type="button"
            ref={addBtnRef}
            className="cmr-btn sm"
            onClick={onAdd}
            disabled={busy || locked}
            aria-label={`Add ${v.vendorName} to the ledger`}
          >
            <CmrIcon name="plus" size={14} /> Add
          </button>
        </div>
      )}
    </li>
  )
}

// ── pick a target (the same choice as placing a vendor request) ─────────────

function AddDialog({
  vendor: v,
  today,
  thisWeekStart,
  weekStart,
  busy,
  onPlace,
  onCancel,
}: {
  vendor: CmrRollupVendorState
  today: string
  thisWeekStart: string
  weekStart: string
  busy: boolean
  onPlace: (body: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  const scheduled = v.occurrenceDate ?? today
  const [target, setTarget] = useState<'pending' | 'priority'>('pending')
  const [date, setDate] = useState(scheduled)
  const [period, setPeriod] = useState<CmrLedgerPeriod>('am')
  const [week, setWeek] = useState(weekStartSunday(scheduled))
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
        aria-labelledby="cmr-ro-add-title"
        aria-describedby="cmr-ro-add-desc"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="cmr-ro-add-title" className="cmr-serif">Add {v.vendorName}</h2>
        <p id="cmr-ro-add-desc">
          {v.accountName} · {formatCents(v.suggestedCents)}
          {v.lastAmountSentCents !== null && v.lastAmountSentCents !== v.amountCents ? ' (last amount sent)' : ''}
          {' · '}
          {v.scheduleText.toLowerCase()}, due {formatOccurrence(scheduled, today.slice(0, 4))}
        </p>

        <form onSubmit={submit} noValidate>
          <div className="cmr-seg cmr-rq-seg" role="group" aria-label="Where to add this vendor">
            <button type="button" ref={firstRef} aria-pressed={target === 'pending'} onClick={() => setTarget('pending')} disabled={busyNow}>
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
                <b>{formatLedgerDate(date)} {CMR_LEDGER_PERIOD_LABEL[period]}</b> under {v.accountName}, and reduces
                that snapshot&rsquo;s balance.
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
                Goes into the priorities for the week of <b>{formatWeekRangeShort(week)}</b>, open, with the scheduled
                date as its due date.
              </p>
            </div>
          )}

          <div className="acts">
            <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={busyNow}>Cancel</button>
            <button type="submit" className="cmr-btn sm" disabled={busyNow}>
              <CmrIcon name="check" size={14} />
              {busyNow ? 'Adding…' : target === 'pending' ? 'Add to that day' : 'Add to that week'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
