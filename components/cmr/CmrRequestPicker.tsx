'use client'

import { useEffect, useState } from 'react'
import Combobox from '@/components/billing/Combobox'
import CmrIcon from '@/components/cmr/CmrIcon'
import { formatApDate, type CmrApLine, type CmrApPickerView, type CmrApVendorGroup } from '@/lib/cmr/ap'
import { formatCents } from '@/lib/cmr/ledger'
import {
  formatSignedCents,
  invoiceLabel,
  requestVendorLabel,
  selectionBreakdown,
  type CmrRequestInvoice,
} from '@/lib/cmr/requests'

/**
 * AP Phase 2 — the vendor-request picker: vendor (from the chosen account's CURRENT A/P) →
 * tick invoices → live total. Credits are their own tickable lines with a negative balance, so
 * the total is Σ ticked bills − Σ ticked credits. The figure shown here is only a preview: the
 * server recomputes it from the stored lines when the request is submitted.
 *
 * Also exports InvoiceList, the read-only list of a request's snapshotted invoices shown on
 * each request row and in the Controller's Place dialog.
 */

type ApiResult<T> = { success: true; data: T } | { success: false; error: string; code?: string }

async function getJson<T>(url: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    const json = (await res.json().catch(() => null)) as ApiResult<T> | null
    return json ?? { success: false, error: `Request failed (${res.status}).` }
  } catch {
    return { success: false, error: 'Network error — check your connection and try again.' }
  }
}

export type PickerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; view: CmrApPickerView }

/** Loads one account's current A/P for the picker whenever the account changes. */
export function usePicker(accountId: string, reloadKey = 0): PickerState {
  const [state, setState] = useState<PickerState>({ status: 'idle' })
  useEffect(() => {
    if (!accountId) { setState({ status: 'idle' }); return }
    let live = true
    setState({ status: 'loading' })
    void getJson<CmrApPickerView>(`/api/cmr/ap/vendors?accountId=${encodeURIComponent(accountId)}`).then((r) => {
      if (!live) return
      setState(r.success ? { status: 'ready', view: r.data } : { status: 'error', error: r.error })
    })
    return () => { live = false }
  }, [accountId, reloadKey])
  return state
}

const PICK_STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * The vendor select + invoice checklist + running total. Controlled: the parent owns the vendor
 * and the ticked ids, and reads the total from `selectionBreakdown` of the ticked lines.
 */
export function ApPicker({
  uid,
  state,
  accountName,
  vendorName,
  onVendor,
  selected,
  onSelected,
  onRetry,
  disabled,
  handEntryHint,
}: {
  uid: string
  state: PickerState
  accountName: string
  vendorName: string
  onVendor: (v: string) => void
  selected: Set<string>
  onSelected: (next: Set<string>) => void
  onRetry: () => void
  disabled: boolean
  /** Controller only — offered when the account has no A/P. */
  handEntryHint?: React.ReactNode
}) {
  if (state.status === 'idle') return null
  if (state.status === 'loading') {
    return (
      <div className="cmr-field span-all" aria-busy="true" aria-label="Loading this account’s A/P">
        <span className="cmr-skel" style={{ width: '40%', height: 12 }} />
        <span className="cmr-skel" style={{ width: '100%', height: 34, marginTop: 8 }} />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="cmr-notice err span-all" role="alert">
        <span style={{ flex: 1 }}>{state.error}</span>
        <button type="button" className="cmr-btn sm ghost" onClick={onRetry}>Retry</button>
      </div>
    )
  }

  const { view } = state
  if (!view.import) {
    return (
      <div className="cmr-rq-apempty span-all" role="status">
        <CmrIcon name="ap" size={16} />
        <div>
          <b>Import {accountName}’s A/P first.</b>{' '}
          Requests are built from the account’s QuickBooks A/P aging, and {accountName} has none yet. A Controller
          imports it on <a href="/cmr/ap">Accounts Payable</a>; then its vendors and invoices show up here.
          {handEntryHint}
        </div>
      </div>
    )
  }
  if (!view.vendors.length) {
    return (
      <div className="cmr-rq-apempty span-all" role="status">
        <CmrIcon name="ap" size={16} />
        <div>
          <b>Nothing payable in {accountName}’s A/P.</b> Its current import has no open bills or credits.
          {handEntryHint}
        </div>
      </div>
    )
  }

  const vendor = view.vendors.find((v) => v.vendorName === vendorName) ?? null
  const options = view.vendors.map((v) => ({
    value: v.vendorName,
    label: requestVendorLabel(v.vendorName),
    hint: formatSignedCents(v.owedCents),
  }))

  return (
    <>
      <div className="cmr-field span-all cmr-rq-vendorpick">
        <span className="cmr-label" id={`cmr-rq-ven-${uid}`}>Vendor</span>
        <Combobox
          value={vendorName}
          onChange={(v) => { onVendor(v); onSelected(new Set()) }}
          options={options}
          placeholder={`Search ${view.vendors.length} vendors in ${accountName}’s A/P`}
          ariaLabel="Vendor"
          disabled={disabled}
        />
        <span className="cmr-rq-apsrc">
          From {view.import.sourceFilename ?? 'the current A/P import'} · imported{' '}
          {PICK_STAMP.format(new Date(view.import.importedAt))}
        </span>
      </div>
      {vendor && <InvoiceChecklist uid={uid} vendor={vendor} selected={selected} onSelected={onSelected} disabled={disabled} />}
    </>
  )
}

function InvoiceChecklist({
  uid,
  vendor,
  selected,
  onSelected,
  disabled,
}: {
  uid: string
  vendor: CmrApVendorGroup
  selected: Set<string>
  onSelected: (next: Set<string>) => void
  disabled: boolean
}) {
  const ticked = vendor.lines.filter((l) => selected.has(l.id))
  const t = selectionBreakdown(ticked)
  const bills = vendor.lines.filter((l) => l.docType !== 'Credit')
  const allBills = bills.length > 0 && bills.every((l) => selected.has(l.id))

  const toggle = (l: CmrApLine, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(l.id)
    else next.delete(l.id)
    onSelected(next)
  }

  const label = requestVendorLabel(vendor.vendorName)
  return (
    <fieldset className="cmr-rq-invpick span-all" disabled={disabled}>
      <legend className="cmr-label">
        Invoices to pay <span className="opt">· {label} owes {formatSignedCents(vendor.owedCents)} in all</span>
      </legend>
      <div className="cmr-rq-invtools">
        <button
          type="button"
          className="cmr-btn sm ghost"
          onClick={() => {
            const next = new Set(selected)
            for (const l of bills) { if (allBills) next.delete(l.id); else next.add(l.id) }
            onSelected(next)
          }}
          disabled={!bills.length}
        >
          {allBills ? 'Untick all bills' : `Tick all ${bills.length} bill${bills.length === 1 ? '' : 's'}`}
        </button>
        {selected.size > 0 && (
          <button type="button" className="cmr-btn sm ghost" onClick={() => onSelected(new Set())}>Clear</button>
        )}
      </div>
      <ul className="cmr-rq-invlist" aria-label={`${label} invoices`}>
        {vendor.lines.map((l) => {
          const credit = l.docType === 'Credit'
          const on = selected.has(l.id)
          return (
            <li key={l.id} className={`${credit ? 'credit' : ''}${on ? ' on' : ''}`}>
              <label>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => toggle(l, e.target.checked)}
                  aria-label={`${invoiceLabel(l)}, ${formatSignedCents(l.openBalanceCents)}${credit ? ' (subtracts)' : ''}`}
                />
                <span className="inv">
                  <span className="num">
                    {l.invoiceNum ?? '(no number)'}
                    {credit && <span className="cmr-pill ok">Credit</span>}
                  </span>
                  <span className="mt">
                    {formatApDate(l.billDate)}
                    {l.dueDate && <> · due {formatApDate(l.dueDate)}</>}
                    {l.agingBucket && <> · {l.agingBucket === 'Current' ? 'current' : `${l.agingBucket} days`}</>}
                  </span>
                </span>
                <span className="bal cmr-num">{formatSignedCents(l.openBalanceCents)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className={`cmr-rq-invtotal${t.totalCents <= 0 && ticked.length ? ' bad' : ''}`} aria-live="polite" id={`cmr-rq-total-${uid}`}>
        <span className="parts">
          {t.billCount} bill{t.billCount === 1 ? '' : 's'} {formatCents(t.billsCents)}
          {t.creditCount > 0 && <> · {t.creditCount} credit{t.creditCount === 1 ? '' : 's'} {formatSignedCents(t.creditsCents)}</>}
        </span>
        <span className="tot">
          Request total <b className="cmr-num">{formatSignedCents(t.totalCents)}</b>
        </span>
        {t.totalCents <= 0 && ticked.length > 0 && (
          <span className="why">The credits cancel out the bills — tick more bills or fewer credits.</span>
        )}
      </div>
    </fieldset>
  )
}

/**
 * A request's snapshotted invoices, read-only: number, type, date, signed balance, and a hint on
 * any that is no longer in the account's current A/P (or whose balance has changed there).
 */
export function InvoiceList({ invoices, totalCents, open = false }: { invoices: CmrRequestInvoice[]; totalCents: number; open?: boolean }) {
  const stale = invoices.filter((i) => !i.inCurrentAp).length
  const credits = invoices.filter((i) => i.docType === 'Credit').length
  const list = (
    <ul className="cmr-rq-invs">
      {invoices.map((i) => (
        <li key={i.id} className={i.docType === 'Credit' ? 'credit' : undefined}>
          <span className="inv">
            <span className="num">
              {i.docType === 'Credit' ? 'Credit ' : ''}
              {i.invoiceNum ?? '(no number)'}
            </span>
            <span className="mt">
              {formatApDate(i.billDate)}
              {!i.inCurrentAp && (
                <>
                  {' · '}
                  <span className="cmr-rq-stale nw">
                    <CmrIcon name="alert" size={11} /> no longer in current AP
                  </span>
                </>
              )}
              {i.inCurrentAp && i.currentBalanceCents !== null && (
                <span className="cmr-rq-stale">
                  {' · '}now {formatSignedCents(i.currentBalanceCents)} in current AP
                </span>
              )}
            </span>
          </span>
          <span className="bal cmr-num">{formatSignedCents(i.openBalanceCents)}</span>
        </li>
      ))}
      <li className="sum">
        <span className="inv"><span className="num">Total</span></span>
        <span className="bal cmr-num">{formatSignedCents(totalCents)}</span>
      </li>
    </ul>
  )
  if (open) return list
  return (
    <details className="cmr-rq-invdet">
      <summary>
        <CmrIcon name="right" size={12} className="chev" />
        {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
        {credits > 0 && ` · ${credits} credit${credits === 1 ? '' : 's'}`}
        {stale > 0 && <span className="cmr-pill warn">{stale} no longer in current AP</span>}
      </summary>
      {list}
    </details>
  )
}

/** The ids an edit should start with ticked: this request's invoices still in the current A/P. */
export function initialSelection(invoices: CmrRequestInvoice[]): Set<string> {
  return new Set(invoices.map((i) => i.currentApLineId).filter((x): x is string => !!x))
}

/** The ticked lines of the chosen vendor (for the running total / submit guard). */
export function tickedLines(state: PickerState, vendorName: string, selected: Set<string>): CmrApLine[] {
  if (state.status !== 'ready') return []
  const v = state.view.vendors.find((x) => x.vendorName === vendorName)
  return v ? v.lines.filter((l) => selected.has(l.id)) : []
}
