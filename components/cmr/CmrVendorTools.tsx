'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Combobox from '@/components/billing/Combobox'
import CmrIcon from '@/components/cmr/CmrIcon'
import { formatBalanceCents } from '@/lib/cmr/ledger'
import {
  SUGGESTION_KIND_LABEL,
  displayVendorName,
  type CmrVendorCatalogEntry,
  type CmrVendorSuggestion,
  type CmrVendorSuggestionsView,
  type CmrVendorSummary,
} from '@/lib/cmr/vendors'

/**
 * AP Phase 3b — the Controller's vendor cleanup tools on the Vendors page: the "Possible
 * duplicates" review list and the Merge / Rename / Split dialogs. Nothing here merges on its
 * own: a suggestion only becomes a merge when the Controller confirms it in the Merge dialog.
 * Shown only to a Controller (the routes behind them are guardCmrController as well).
 */

export const summaryOfEntry = (e: CmrVendorCatalogEntry): CmrVendorSummary => ({
  id: e.id,
  canonicalName: e.canonicalName,
  accounts: e.accounts,
  owedCents: e.owedCents,
  spellings: e.aliases.map((a) => a.rawName),
})

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const accountsText = (v: CmrVendorSummary) => (v.accounts.length ? v.accounts.map((a) => a.name).join(', ') : 'Nothing open now')

// ── the review list ─────────────────────────────────────────────────────────

const FIRST = 4

export function DuplicatesPanel({
  data,
  error,
  aiBusy,
  onAskAi,
  onRetry,
  onMerge,
  onDismiss,
}: {
  data: CmrVendorSuggestionsView | null
  error: string | null
  aiBusy: boolean
  onAskAi: () => void
  onRetry: () => void
  onMerge: (p: CmrVendorSuggestion) => void
  onDismiss: (p: CmrVendorSuggestion) => void
}) {
  const [all, setAll] = useState(false)
  const pairs = data?.pairs ?? []
  const shown = all ? pairs : pairs.slice(0, FIRST)
  return (
    <section className="cmr-sec" aria-labelledby="cmr-vn-dup-title">
      <div className="cmr-sh cmr-lg-sh">
        <div className="hd">
          <h2 id="cmr-vn-dup-title">Possible duplicates</h2>
          <span className="c">
            {data ? plural(pairs.length, 'pair') : 'Looking…'}
            {data?.engine.ai === 'used' ? ' · reviewed by AI' : ''}
          </span>
        </div>
        <button type="button" className="cmr-btn sm ghost cmr-vn-ai" onClick={onAskAi} disabled={aiBusy || !data}>
          <CmrIcon name="star" size={13} />
          {aiBusy ? 'AI is reviewing…' : data?.engine.ai === 'used' ? 'Ask AI again' : 'Ask AI to review'}
        </button>
      </div>
      <p className="cmr-lg-blurb">
        Vendors whose names look like the same company — suggestions only. Nothing merges until you confirm it; a
        merge keeps every QuickBooks spelling, so it survives re-imports and can be split apart again.
      </p>
      {error && (
        <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="cmr-btn sm ghost" onClick={onRetry}>Retry</button>
        </div>
      )}
      {data?.engine.ai === 'unavailable' && data.engine.aiMessage && (
        <div className="cmr-notice" role="status" style={{ marginBottom: 12 }}>
          <CmrIcon name="alert" size={14} />
          <span>{data.engine.aiMessage}</span>
        </div>
      )}
      <div className="cmr-card">
        {!data && !error ? (
          <div className="cmr-row" aria-busy="true"><span className="cmr-skel" style={{ width: '46%', height: 12 }} /></div>
        ) : pairs.length === 0 ? (
          <div className="cmr-lg-empty">No likely duplicates right now.</div>
        ) : (
          <ul className="cmr-vn-dups" aria-label="Possible duplicate vendors">
            {shown.map((p) => (
              <DuplicateRow key={`${p.a.id}|${p.b.id}`} pair={p} onMerge={() => onMerge(p)} onDismiss={() => onDismiss(p)} />
            ))}
          </ul>
        )}
        {pairs.length > FIRST && (
          <div className="cmr-vn-more">
            <button type="button" className="cmr-btn sm ghost" onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? 'Show fewer' : `Show all ${pairs.length}`}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function Side({ v }: { v: CmrVendorSummary }) {
  return (
    <span className="side">
      <span className="nm">{displayVendorName(v.canonicalName)}</span>
      <span className="mt">
        {accountsText(v)} · <span className={`cmr-num${v.owedCents < 0 ? ' neg' : ''}`}>{formatBalanceCents(v.owedCents)}</span>
      </span>
    </span>
  )
}

function DuplicateRow({ pair: p, onMerge, onDismiss }: { pair: CmrVendorSuggestion; onMerge: () => void; onDismiss: () => void }) {
  const label = `${displayVendorName(p.a.canonicalName)} and ${displayVendorName(p.b.canonicalName)}`
  return (
    <li className="cmr-vn-dup">
      <div className="pair">
        <Side v={p.a} />
        <span className="vs" aria-hidden="true">↔</span>
        <Side v={p.b} />
      </div>
      <p className="why">
        <span className={`cmr-pill${p.kind === 'ai' ? ' top' : ' ok'}`}>{SUGGESTION_KIND_LABEL[p.kind]}</span>
        <span>{p.reason}</span>
        {p.ai && p.kind !== 'ai' && (
          <span className={`ai ${p.ai.verdict}`}>
            AI: {p.ai.verdict === 'same' ? 'likely the same' : p.ai.verdict === 'different' ? 'likely different' : 'unsure'}
            {p.ai.note ? ` — ${p.ai.note}` : ''}
          </span>
        )}
      </p>
      <div className="acts">
        <button type="button" className="cmr-btn sm" onClick={onMerge} aria-label={`Merge ${label}`}>Merge…</button>
        <button type="button" className="cmr-btn sm ghost" onClick={onDismiss} aria-label={`Dismiss ${label}`}>Not the same</button>
      </div>
    </li>
  )
}

// ── the dialog shell (in-app; never a native prompt) ─────────────────────────

function Dialog({
  title,
  desc,
  onCancel,
  children,
}: {
  title: string
  desc?: React.ReactNode
  onCancel: () => void
  children: React.ReactNode
}) {
  const uid = useId().replace(/:/g, '')
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus())
  }, [])

  // Escape closes; Tab stays inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }
      if (e.key !== 'Tab' || !wrap.current) return
      const items = wrap.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="cmr-rq-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div
        ref={wrap}
        className="cmr-rq-dialog cmr-card cmr-vn-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`cmr-vn-dlg-${uid}`}
        aria-describedby={desc ? `cmr-vn-dlgd-${uid}` : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={`cmr-vn-dlg-${uid}`} className="cmr-serif">{title}</h2>
        {desc && <p id={`cmr-vn-dlgd-${uid}`}>{desc}</p>}
        {children}
      </div>
    </div>
  )
}

// ── Merge ───────────────────────────────────────────────────────────────────

/**
 * Merge two vendors. With `b` given (a suggestion) both sides are fixed; otherwise the Controller
 * picks the other vendor from the catalog. Either way they choose which NAME to keep — that
 * vendor is the merge target.
 */
export function MergeDialog({
  a,
  b,
  catalog,
  busy,
  onMerge,
  onCancel,
}: {
  a: CmrVendorSummary
  b: CmrVendorSummary | null
  catalog: CmrVendorCatalogEntry[]
  busy: boolean
  onMerge: (targetId: string, sourceId: string) => void
  onCancel: () => void
}) {
  const [otherId, setOtherId] = useState(b?.id ?? '')
  const other = useMemo(() => {
    if (b) return b
    const e = catalog.find((v) => v.id === otherId)
    return e ? summaryOfEntry(e) : null
  }, [b, catalog, otherId])
  const [keep, setKeep] = useState(a.id)

  const options = useMemo(
    () =>
      catalog
        .filter((v) => v.id !== a.id)
        .map((v) => ({
          value: v.id,
          label: displayVendorName(v.canonicalName),
          // searched too: its accounts, and any QuickBooks spelling that differs from the name
          hint: [
            v.accounts.map((x) => x.name).join(', '),
            ...v.aliases.map((x) => displayVendorName(x.rawName)).filter((n) => n !== displayVendorName(v.canonicalName)),
          ].filter(Boolean).join(' · '),
        })),
    [catalog, a.id],
  )

  const kept = other && keep === other.id ? other : a
  const gone = other ? (kept.id === a.id ? other : a) : null
  const accounts = other ? [...new Map([...a.accounts, ...other.accounts].map((x) => [x.id, x.name])).values()] : []
  const spellings = other ? [...new Set([...a.spellings, ...other.spellings])] : []

  return (
    <Dialog
      title={`Merge ${displayVendorName(a.canonicalName)}`}
      desc="One vendor from now on. Every QuickBooks spelling of both is kept, so re-imports stay merged — and Split can separate them again."
      onCancel={onCancel}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (other && gone) onMerge(kept.id, gone.id)
        }}
        noValidate
      >
        {!b && (
          <div className="cmr-field cmr-vn-pick">
            <span className="cmr-label" id="cmr-vn-merge-with">Merge with</span>
            <Combobox value={otherId} onChange={(v) => { setOtherId(v); setKeep(a.id) }} options={options} placeholder="Find a vendor…" ariaLabel="Vendor to merge with" disabled={busy} />
          </div>
        )}
        {other && (
          <>
            <fieldset className="cmr-vn-keep" disabled={busy}>
              <legend className="cmr-label">Keep the name</legend>
              {[a, other].map((v) => (
                <label key={v.id} className={keep === v.id ? 'on' : ''}>
                  <input type="radio" name="cmr-vn-keep" checked={keep === v.id} onChange={() => setKeep(v.id)} />
                  <span className="side">
                    <span className="nm">{displayVendorName(v.canonicalName)}</span>
                    <span className="mt">{accountsText(v)} · {formatBalanceCents(v.owedCents)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="cmr-rq-dialognote">
              Together: <b className="cmr-num">{formatBalanceCents(a.owedCents + other.owedCents)}</b> owed
              {accounts.length ? <> across <b>{accounts.join(', ')}</b></> : ''}. QuickBooks spellings kept:{' '}
              {spellings.map((s) => `“${displayVendorName(s)}”`).join(', ')}. Requests already placed are not changed.
            </p>
          </>
        )}
        <div className="acts">
          <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="cmr-btn sm" disabled={busy || !other}>
            <CmrIcon name="check" size={14} />
            {busy ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ── Rename ──────────────────────────────────────────────────────────────────

export function RenameDialog({
  vendor,
  busy,
  onRename,
  onCancel,
}: {
  vendor: { id: string; canonicalName: string }
  busy: boolean
  onRename: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(vendor.canonicalName)
  const t = name.trim()
  const tooLong = [...t].length > 200
  return (
    <Dialog
      title="Rename vendor"
      desc="The name shown here and in the request picker. Which QuickBooks spellings belong to this vendor does not change."
      onCancel={onCancel}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (t && !tooLong) onRename(t) }} noValidate>
        <label className="cmr-field">
          <span className="cmr-label">Name</span>
          <input className="cmr-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={400} disabled={busy} aria-invalid={!t || tooLong} />
        </label>
        {tooLong && <p className="cmr-rq-dialognote cmr-vn-bad">At most 200 characters.</p>}
        <div className="acts">
          <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="cmr-btn sm" disabled={busy || !t || tooLong || t === vendor.canonicalName}>
            <CmrIcon name="check" size={14} />
            {busy ? 'Saving…' : 'Rename'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ── Split ───────────────────────────────────────────────────────────────────

export function SplitDialog({
  vendor,
  busy,
  onSplit,
  onCancel,
}: {
  vendor: CmrVendorCatalogEntry
  busy: boolean
  onSplit: (aliasIds: string[], name: string) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [name, setName] = useState('')
  const [edited, setEdited] = useState(false)
  const firstPicked = vendor.aliases.find((a) => picked.has(a.id))

  // Until the Controller types a name, the new vendor is named after the first spelling picked.
  useEffect(() => {
    if (!edited) setName(firstPicked ? displayVendorName(firstPicked.rawName) : '')
  }, [firstPicked, edited])

  const all = picked.size === vendor.aliases.length
  const t = name.trim()
  const tooLong = [...t].length > 200
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  return (
    <Dialog
      title={`Split ${displayVendorName(vendor.canonicalName)}`}
      desc="Tick the QuickBooks spellings that are really a different vendor. They — and their invoices — move to a new vendor."
      onCancel={onCancel}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (picked.size && !all && t && !tooLong) onSplit([...picked], t) }} noValidate>
        <ul className="cmr-rq-invlist cmr-vn-aliases" aria-label="QuickBooks spellings">
          {vendor.aliases.map((a) => {
            const on = picked.has(a.id)
            return (
              <li key={a.id} className={on ? 'on' : ''}>
                <label>
                  <input type="checkbox" checked={on} onChange={(e) => toggle(a.id, e.target.checked)} disabled={busy} />
                  <span className="inv">
                    <span className="num">{displayVendorName(a.rawName)}</span>
                    <span className="mt">
                      {a.lineCount ? `${plural(a.lineCount, 'line')} in ${a.accountNames.join(', ')}` : 'Nothing open now'}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <label className="cmr-field cmr-vn-newname">
          <span className="cmr-label">New vendor&rsquo;s name</span>
          <input
            className="cmr-input"
            value={name}
            onChange={(e) => { setName(e.target.value); setEdited(true) }}
            maxLength={400}
            disabled={busy}
            placeholder="Tick a spelling first"
          />
        </label>
        {all && <p className="cmr-rq-dialognote cmr-vn-bad">Leave at least one spelling with {displayVendorName(vendor.canonicalName)}.</p>}
        {tooLong && <p className="cmr-rq-dialognote cmr-vn-bad">At most 200 characters.</p>}
        <div className="acts">
          <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="cmr-btn sm" disabled={busy || !picked.size || all || !t || tooLong}>
            <CmrIcon name="check" size={14} />
            {busy ? 'Splitting…' : picked.size > 1 ? `Split off ${picked.size} spellings` : 'Split off'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ── the per-vendor tool bar (inside an open vendor row) ─────────────────────

export function VendorToolbar({
  name,
  spellingCount,
  disabled,
  onMerge,
  onRename,
  onSplit,
}: {
  name: string
  spellingCount: number
  disabled: boolean
  onMerge: () => void
  onRename: () => void
  onSplit: () => void
}) {
  return (
    <div className="cmr-vn-tools" role="group" aria-label={`Manage ${name}`}>
      <button type="button" className="cmr-btn sm ghost" onClick={onMerge} disabled={disabled}>Merge with…</button>
      <button type="button" className="cmr-btn sm ghost" onClick={onRename} disabled={disabled}>
        <CmrIcon name="edit" size={13} />Rename
      </button>
      <button
        type="button"
        className="cmr-btn sm ghost"
        onClick={onSplit}
        disabled={disabled || spellingCount < 2}
        title={spellingCount < 2 ? 'Only one QuickBooks spelling — nothing to split' : undefined}
      >
        Split…
      </button>
      <span className="note">{plural(spellingCount, 'QuickBooks spelling')}</span>
    </div>
  )
}
