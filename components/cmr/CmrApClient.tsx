'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Select from '@/components/billing/Select'
import CmrIcon from '@/components/cmr/CmrIcon'
import { formatBalanceCents } from '@/lib/cmr/ledger'
import {
  accountFromFileName,
  apReconciliationLines,
  apTotals,
  apVendorGroups,
  describeReconciliation,
  formatAging,
  formatApDate,
  type CmrApAccountRef,
  type CmrApImport,
  type CmrApLine,
  type CmrApPreviewSummary,
  type CmrApVendorGroup,
  type CmrApVendorSort,
  type CmrApView,
} from '@/lib/cmr/ap'

/**
 * Accounts payable — each account's current QuickBooks A/P Aging Detail snapshot: who is owed
 * and on which invoices, and whether the import reconciles to the report's own TOTAL.
 *
 * Every CMR role reads this screen. Only a Controller (`canImport` from the API) sees Import,
 * and Import never writes on its own: it previews the parsed file in a dialog first, and
 * /api/cmr/ap/import/commit re-checks the Controller role, re-parses the file and replaces the
 * account's snapshot in one transaction. Hiding the button is cosmetic.
 *
 * Vendors and "amount owed" come from Bill and Credit lines only (credits are negative). The
 * other lines of the report — journal entries, bill payments, adjustment accounts — are kept so
 * the import adds up to the report TOTAL, and are listed separately as never payable.
 *
 * The account filter, sort and search are computed here from the one response (lib/cmr/ap).
 */

type ApiResult<T> = { success: true; data: T } | { success: false; error: string; code?: string }

async function getJson<T>(input: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(input, { headers: { Accept: 'application/json' } })
    const json = (await res.json().catch(() => null)) as ApiResult<T> | null
    if (json) return json
    return { success: false, error: `Request failed (${res.status}).` }
  } catch {
    return { success: false, error: 'Network error — check your connection and try again.' }
  }
}

/** multipart POST — no Content-Type header, so the browser writes the boundary. */
async function upload<T>(input: string, body: FormData): Promise<ApiResult<T>> {
  try {
    const res = await fetch(input, { method: 'POST', body })
    const json = (await res.json().catch(() => null)) as ApiResult<T> | null
    if (json) return json
    return { success: false, error: `Request failed (${res.status}).` }
  } catch {
    return { success: false, error: 'Network error — check your connection and try again.' }
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

const STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const stamp = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : STAMP.format(d)
}

interface PreviewData {
  account: { id: string; name: string }
  fileName: string
  summary: CmrApPreviewSummary
  replaces: {
    importId: string
    importedAt: string
    sourceFilename: string | null
    lineCount: number
    payableTotalCents: number
    importedByName: string | null
  } | null
}

export default function CmrApClient() {
  const [view, setView] = useState<CmrApView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [accountId, setAccountId] = useState('')
  const [sort, setSort] = useState<CmrApVendorSort>('owed')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [importing, setImporting] = useState(false)
  const importBtn = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    const r = await getJson<CmrApView>('/api/cmr/ap')
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

  const canImport = view?.canImport === true
  const filter = accountId === '' ? null : accountId

  // The filter offers every account that has AP, plus every active account (so a Controller can
  // see which ones still need a first import). Retired accounts without AP are left out.
  const filterAccounts = useMemo(() => {
    if (!view) return []
    const withAp = new Set(view.imports.map((i) => i.accountId))
    return view.accounts.filter((a) => a.active || withAp.has(a.id))
  }, [view])
  const filterName = filterAccounts.find((a) => a.id === filter)?.name ?? null

  const totals = useMemo(() => (view ? apTotals(view, filter) : null), [view, filter])
  const vendors = useMemo(() => (view ? apVendorGroups(view.lines, view.accounts, filter, sort) : []), [view, filter, sort])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return vendors
    return vendors.filter((v) => v.vendorName.toLowerCase().includes(q) || v.lines.some((l) => (l.invoiceNum ?? '').toLowerCase().includes(q)))
  }, [vendors, query])
  const other = useMemo(() => (view ? apReconciliationLines(view.lines, filter) : []), [view, filter])
  const importsShown = useMemo(() => {
    if (!view) return []
    return filterAccounts.filter((a) => filter === null || a.id === filter)
  }, [view, filterAccounts, filter])

  const notImported = importsShown.filter((a) => !view?.imports.some((i) => i.accountId === a.id))

  useEffect(() => {
    if (filter && view && !filterAccounts.some((a) => a.id === filter)) setAccountId('')
  }, [filter, view, filterAccounts])

  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const importOf = (id: string): CmrApImport | undefined => view?.imports.find((i) => i.accountId === id)

  async function imported(message: string, importedAccountId: string) {
    setImporting(false)
    setStatus(message)
    setAccountId(importedAccountId)
    setOpen(new Set())
    await load()
    requestAnimationFrame(() => importBtn.current?.focus())
  }

  const scopeLabel = filterName ?? 'All accounts'
  const nothingImported = view !== null && view.imports.length === 0

  return (
    <>
      <header className="cmr-pagehead cmr-lg-head">
        <div>
          <h1 className="cmr-serif">Accounts payable</h1>
          <p>QuickBooks A/P Aging Detail, one snapshot per account. Each new import replaces that account&rsquo;s snapshot.</p>
        </div>
        {canImport && (
          <div className="actions">
            <button type="button" ref={importBtn} className="cmr-btn" onClick={() => setImporting(true)} disabled={importing}>
              <CmrIcon name="upload" size={15} /> Import A/P aging
            </button>
          </div>
        )}
      </header>

      <p className="cmr-sr-only" role="status" aria-live="polite">{status}</p>

      {status && (
        <div className="cmr-notice ok cmr-ap-done" style={{ marginBottom: 14 }}>
          <CmrIcon name="check" size={14} />
          <span style={{ flex: 1 }}>{status}</span>
          <button type="button" className="cmr-btn sm ghost" onClick={() => setStatus('')}>Dismiss</button>
        </div>
      )}

      {view && !canImport && (
        <div className="cmr-notice" style={{ marginBottom: 18 }}>
          <CmrIcon name="lock" size={14} />
          <span>You can view accounts payable. Only a Controller can import an A/P aging report.</span>
        </div>
      )}

      {loadError && (
        <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <button type="button" className="cmr-btn sm ghost" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {!view && !loadError && (
        <div aria-busy="true" aria-label="Loading accounts payable">
          <div className="cmr-hero cmr-lg-hero">
            <div className="l">
              <span className="cmr-skel" style={{ width: 140, height: 10, opacity: 0.35 }} />
              <span className="cmr-skel" style={{ width: 240, height: 38, margin: '14px 0 10px', opacity: 0.35 }} />
              <span className="cmr-skel" style={{ width: 180, height: 10, opacity: 0.35 }} />
            </div>
          </div>
          <div className="cmr-card">
            {[0, 1, 2, 3].map((i) => (
              <div className="cmr-row" key={i}>
                <span className="cmr-skel" style={{ width: '38%', height: 12 }} />
                <span className="cmr-skel" style={{ width: 80, height: 12, marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {view && nothingImported && (
        <div className="cmr-card">
          <div className="cmr-empty">
            <div className="ring"><CmrIcon name="ap" /></div>
            <h2 className="cmr-serif">No A/P imported yet</h2>
            <p>
              {canImport
                ? 'Export an account’s A/P Aging Detail from QuickBooks to Excel, then import it here. Each account keeps its own snapshot.'
                : 'Nothing has been imported yet. A Controller imports each account’s QuickBooks A/P Aging Detail report.'}
            </p>
            {canImport && (
              <button type="button" className="cmr-btn" style={{ marginTop: 16 }} onClick={() => setImporting(true)}>
                <CmrIcon name="upload" size={15} /> Import the first report
              </button>
            )}
          </div>
        </div>
      )}

      {view && totals && !nothingImported && (
        <>
          <ApHero totals={totals} scope={scopeLabel} />

          {/* ── the filter ── */}
          <div className="cmr-ap-bar">
            <label className="cmr-ro-filter cmr-ap-filter">
              <span className="cmr-label">Account</span>
              <Select value={accountId} onChange={(v) => { setAccountId(v); setOpen(new Set()) }} ariaLabel="Filter by account">
                <option value="">All accounts</option>
                {filterAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.active ? '' : ' (inactive)'}</option>
                ))}
              </Select>
            </label>
          </div>

          {/* ── each account's import ── */}
          <section className="cmr-sec" aria-labelledby="cmr-ap-imp-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-ap-imp-title">Last import</h2>
                <span className="c">{filter ? scopeLabel : `${plural(view.imports.length, 'account')} imported`}</span>
              </div>
            </div>
            <div className="cmr-card">
              <ul className="cmr-ap-list" aria-label="Each account's current import">
                {importsShown.filter((a) => importOf(a.id)).map((a) => (
                  <ImportRow key={a.id} account={a} imp={importOf(a.id) as CmrApImport} />
                ))}
                {notImported.length > 0 && (
                  <li className="cmr-row cmr-ap-imp none">
                    <div className="who">
                      <span className="desc">
                        <span className="nm">{notImported.map((a) => a.name).join(', ')}</span>
                      </span>
                      <span className="mt">No A/P imported yet</span>
                    </div>
                  </li>
                )}
              </ul>
            </div>
          </section>

          {/* ── vendors ── */}
          <section className="cmr-sec" aria-labelledby="cmr-ap-ven-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-ap-ven-title">Vendors</h2>
                <span className="c">
                  {scopeLabel} · {plural(vendors.length, 'vendor')}
                  {query.trim() && shown.length !== vendors.length ? ` · ${shown.length} shown` : ''}
                </span>
              </div>
              <span className="tot">Owed <b className="cmr-num">{formatBalanceCents(totals.payableCents)}</b></span>
            </div>
            <div className="cmr-ap-tools">
              <label className="cmr-ap-search">
                <span className="cmr-sr-only">Find a vendor or invoice number</span>
                <input
                  className="cmr-input"
                  type="search"
                  placeholder="Find a vendor or invoice #"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="cmr-seg" role="group" aria-label="Sort vendors">
                <button type="button" aria-pressed={sort === 'owed'} onClick={() => setSort('owed')}>Largest first</button>
                <button type="button" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>A–Z</button>
              </div>
            </div>
            <p className="cmr-lg-blurb">
              Amount owed is every open Bill less every open Credit. Open a vendor to see its invoices; credits show as
              negative lines.
            </p>
            <div className="cmr-card">
              {shown.length === 0 ? (
                <div className="cmr-lg-empty">
                  {vendors.length === 0
                    ? filter
                      ? importOf(filter)
                        ? `${scopeLabel} has no open bills or credits in its current import.`
                        : `No A/P has been imported for ${scopeLabel} yet.`
                      : 'No open bills or credits.'
                    : 'No vendor or invoice matches that search.'}
                </div>
              ) : (
                <ul className="cmr-ap-list" aria-label="Vendors owed">
                  {shown.map((v) => (
                    <VendorRow key={v.key} vendor={v} showAccount={filter === null} open={open.has(v.key)} onToggle={() => toggle(v.key)} />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ── the rest of the report ── */}
          {other.length > 0 && (
            <section className="cmr-sec" aria-labelledby="cmr-ap-oth-title">
              <div className="cmr-sh cmr-lg-sh">
                <div className="hd">
                  <h2 id="cmr-ap-oth-title">Not payable — reconciliation only</h2>
                  <span className="c">{plural(other.length, 'line')}</span>
                </div>
                <span className="tot">Net <b className="cmr-num">{formatBalanceCents(totals.otherCents)}</b></span>
              </div>
              <p className="cmr-lg-blurb">
                Journal entries, bill payments and adjustment accounts from the same report. They are kept so the import
                adds up to the report TOTAL, and can never be requested or paid here.
              </p>
              <div className="cmr-card">
                <details className="cmr-ap-other">
                  <summary>
                    <CmrIcon name="down" size={14} className="chev" /> Show the {plural(other.length, 'line')}
                  </summary>
                  <InvoiceTable lines={other} showVendor caption="Lines that are not payable" />
                </details>
              </div>
            </section>
          )}

          {canImport && (
            <p className="cmr-hint">
              Import each account&rsquo;s report daily — invoices paid in QuickBooks since the last import drop off when
              the new snapshot replaces the old one.
            </p>
          )}
        </>
      )}

      {importing && view && (
        <ImportDialog
          accounts={view.accounts.filter((a) => a.active)}
          initialAccountId={filter && view.accounts.find((a) => a.id === filter)?.active ? filter : ''}
          onCancel={() => { setImporting(false); requestAnimationFrame(() => importBtn.current?.focus()) }}
          onDone={imported}
        />
      )}
    </>
  )
}

// ── the masthead ────────────────────────────────────────────────────────────

function ApHero({ totals, scope }: { totals: ReturnType<typeof apTotals>; scope: string }) {
  const whole = formatBalanceCents(totals.payableCents)
  const dot = whole.lastIndexOf('.')
  const none = totals.importCount === 0
  return (
    <section className="cmr-hero cmr-lg-hero" aria-labelledby="cmr-ap-hero-cap">
      <div className="l">
        <h2 className="cmr-hero-cap" id="cmr-ap-hero-cap">
          Payable · {scope}
          {!none && (totals.reconciled
            ? <span className="cmr-lg-chip">Reconciled</span>
            : <span className="cmr-lg-chip short">Not reconciled</span>)}
        </h2>
        <p className={`cmr-hero-big cmr-serif cmr-num${totals.payableCents < 0 ? ' neg' : ''}`}>
          {none ? '—' : <>{whole.slice(0, dot)}<span className="c">{whole.slice(dot)}</span></>}
        </p>
        <div className="cmr-hero-rule" aria-hidden="true" />
        <p className="cmr-hero-meta">
          {none ? (
            <>No A/P has been imported for {scope}.</>
          ) : (
            <>
              <b>{plural(totals.vendorCount, 'vendor')}</b> · {plural(totals.billCount, 'bill')} and{' '}
              {plural(totals.creditCount, 'credit')}
            </>
          )}
        </p>
      </div>
      <dl className="cmr-lg-stmt">
        <div>
          <dt>Open bills</dt>
          <dd className="cmr-num">{formatBalanceCents(totals.billsCents)}</dd>
        </div>
        <div>
          <dt>Open credits</dt>
          <dd className="cmr-num">{formatBalanceCents(totals.creditsCents)}</dd>
        </div>
        <div>
          <dt>Not payable ({totals.otherCount})</dt>
          <dd className="cmr-num">{formatBalanceCents(totals.otherCents)}</dd>
        </div>
        <div className="total">
          <dt>Report TOTAL</dt>
          <dd className="cmr-num">{formatBalanceCents(totals.reportCents)}</dd>
        </div>
      </dl>
    </section>
  )
}

// ── one account's import ────────────────────────────────────────────────────

function ImportRow({ account, imp }: { account: CmrApAccountRef; imp: CmrApImport }) {
  return (
    <li className={`cmr-row cmr-ap-imp${imp.reconciled ? '' : ' off'}`}>
      <div className="who">
        <span className="desc">
          <span className="nm">{account.name}</span>
          {!account.active && <span className="cmr-pill">Inactive account</span>}
          {imp.reconciled ? (
            <span className="cmr-pill ok"><CmrIcon name="check" size={11} /> Reconciled</span>
          ) : (
            <span className="cmr-pill warn"><CmrIcon name="alert" size={11} /> Not reconciled</span>
          )}
        </span>
        <span className="mt">
          Imported <time dateTime={imp.importedAt}>{stamp(imp.importedAt)}</time>
          {imp.importedByName ? ` by ${imp.importedByName}` : ''}
          {imp.sourceFilename ? <> · <span className="file">{imp.sourceFilename}</span></> : null}
        </span>
        <span className={`mt recon${imp.reconciled ? '' : ' bad'}`}>
          {plural(imp.lineCount, 'line')} totalling {formatBalanceCents(imp.importedTotalCents)} vs report TOTAL{' '}
          {formatBalanceCents(imp.reportTotalCents)}
          {imp.reconciled ? '' : ` — ${describeReconciliation(imp).toLowerCase()}`}
        </span>
      </div>
      <span className="amt cmr-num" aria-label={`${account.name} payable ${formatBalanceCents(imp.payableTotalCents)}`}>
        {formatBalanceCents(imp.payableTotalCents)}
        <span className="sub">payable · {plural(imp.vendorCount, 'vendor')}</span>
      </span>
    </li>
  )
}

// ── one vendor ──────────────────────────────────────────────────────────────

function VendorRow({
  vendor: v,
  showAccount,
  open,
  onToggle,
}: {
  vendor: CmrApVendorGroup
  showAccount: boolean
  open: boolean
  onToggle: () => void
}) {
  const panel = `cmr-ap-inv-${v.key.replace(/[^a-z0-9]/gi, '')}`.slice(0, 80)
  const counts = [plural(v.billCount, 'bill'), v.creditCount ? plural(v.creditCount, 'credit') : null].filter(Boolean).join(' · ')
  return (
    <li className={`cmr-ap-ven${open ? ' open' : ''}`}>
      <button type="button" className="cmr-row cmr-ap-venbtn" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
        <CmrIcon name="right" size={14} className="chev" />
        <span className="who">
          <span className="desc"><span className="nm">{v.vendorName}</span></span>
          <span className="mt">
            {showAccount ? `${v.accountName} · ` : ''}
            {counts}
            {v.oldestAgingDays !== null ? ` · oldest ${formatAging(v.oldestAgingDays)}` : ''}
          </span>
        </span>
        <span className={`amt cmr-num${v.owedCents < 0 ? ' neg' : ''}`}>
          {formatBalanceCents(v.owedCents)}
          {v.owedCents < 0 && <span className="sub">in credit</span>}
        </span>
      </button>
      {open && (
        <div id={panel} className="cmr-ap-inv">
          <InvoiceTable lines={v.lines} caption={`Open invoices for ${v.vendorName}`} />
        </div>
      )}
    </li>
  )
}

// ── invoices ────────────────────────────────────────────────────────────────

export function InvoiceTable({ lines, showVendor = false, caption }: { lines: CmrApLine[]; showVendor?: boolean; caption: string }) {
  return (
    <table className="cmr-ap-table">
      <caption className="cmr-sr-only">{caption}</caption>
      <thead>
        <tr>
          {showVendor && <th scope="col">Vendor</th>}
          <th scope="col">Num</th>
          <th scope="col">Type</th>
          <th scope="col">Date</th>
          <th scope="col">Due</th>
          <th scope="col">Aging</th>
          <th scope="col" className="r">Balance</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className={l.openBalanceCents < 0 ? 'credit' : undefined}>
            {showVendor && <td data-label="Vendor" className="ven">{l.vendorName}</td>}
            <td data-label="Num" className="num">{l.invoiceNum ?? '—'}</td>
            <td data-label="Type">
              {l.docType === 'Credit' ? <span className="cmr-pill ok">Credit</span> : l.docType === 'Bill' ? 'Bill' : <span className="cmr-pill">{l.docType}</span>}
            </td>
            <td data-label="Date" className="cmr-num">{formatApDate(l.billDate)}</td>
            <td data-label="Due" className="cmr-num">{formatApDate(l.dueDate)}</td>
            <td data-label="Aging" className="cmr-num">
              {formatAging(l.agingDays)}
              {l.agingBucket && <span className="bk">{l.agingBucket}</span>}
            </td>
            <td data-label="Balance" className="r cmr-num bal">{formatBalanceCents(l.openBalanceCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── import: pick → preview → confirm ────────────────────────────────────────

function ImportDialog({
  accounts,
  initialAccountId,
  onCancel,
  onDone,
}: {
  accounts: CmrApAccountRef[]
  initialAccountId: string
  onCancel: () => void
  onDone: (message: string, accountId: string) => void | Promise<void>
}) {
  const [accountId, setAccountId] = useState(initialAccountId)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)

  const wrap = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLElement | null>(null)
  const account = accounts.find((a) => a.id === accountId) ?? null
  const named = file ? accountFromFileName(file.name, accounts) : null
  const mismatch = named && account && named.id !== account.id ? named : null

  useEffect(() => { requestAnimationFrame(() => (wrap.current?.querySelector<HTMLElement>('select, input, button'))?.focus()) }, [])
  useEffect(() => { if (preview) requestAnimationFrame(() => firstRef.current?.focus()) }, [preview])

  // Escape closes (unless a request is in flight); Tab stays inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!busy) onCancel(); return }
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
  }, [onCancel, busy])

  function pickFile(f: File | null) {
    setFile(f)
    setError(null)
    setPreview(null)
    if (f && !accountId) {
      const guess = accountFromFileName(f.name, accounts)
      if (guess) setAccountId(guess.id)
    }
  }

  const body = (extra: Record<string, string> = {}) => {
    const f = new FormData()
    f.append('accountId', accountId)
    if (file) f.append('file', file)
    for (const [k, v] of Object.entries(extra)) f.append(k, v)
    return f
  }

  async function runPreview(e: React.FormEvent) {
    e.preventDefault()
    if (!accountId) { setError('Choose the account this report is for.'); return }
    if (!file) { setError('Choose the A/P Aging Detail file (.xlsx or .csv).'); return }
    setBusy(true)
    setError(null)
    const r = await upload<PreviewData>('/api/cmr/ap/import/preview', body())
    setBusy(false)
    if (!r.success) { setError(r.error); return }
    setPreview(r.data)
  }

  async function runCommit() {
    if (!preview) return
    setBusy(true)
    setError(null)
    const r = await upload<{ importId: string }>(
      '/api/cmr/ap/import/commit',
      body({
        expectedLineCount: String(preview.summary.lineCount),
        expectedReportTotalCents: String(preview.summary.reportTotalCents),
      }),
    )
    setBusy(false)
    if (!r.success) { setError(r.error); return }
    const s = preview.summary
    await onDone(
      `${preview.account.name} A/P imported: ${plural(s.payableVendorCount, 'vendor')}, ${formatBalanceCents(s.payableTotalCents)} payable${s.reconciled ? ', reconciled to the report TOTAL.' : ' — it does NOT reconcile to the report TOTAL.'}`,
      preview.account.id,
    )
  }

  const s = preview?.summary
  const otherTypes = s ? Object.entries(s.docTypeCounts).filter(([t]) => t !== 'Bill' && t !== 'Credit') : []

  return (
    <div className="cmr-rq-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <div
        ref={wrap}
        className="cmr-rq-dialog cmr-card cmr-ap-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmr-ap-dlg-title"
        aria-describedby="cmr-ap-dlg-desc"
        aria-busy={busy || undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!preview || !s ? (
          <>
            <h2 id="cmr-ap-dlg-title" className="cmr-serif">Import an A/P aging report</h2>
            <p id="cmr-ap-dlg-desc">
              QuickBooks → Reports → Vendors &amp; Payables → <b>A/P Aging Detail</b> → Excel. Nothing changes until you
              confirm the preview.
            </p>
            <form onSubmit={runPreview} noValidate>
              <div className="cmr-rq-dialogfields cmr-ap-fields">
                <label className="cmr-field span-all">
                  <span className="cmr-label">Account</span>
                  <Select value={accountId} onChange={(v) => { setAccountId(v); setPreview(null); setError(null) }} ariaLabel="Account" disabled={busy}>
                    <option value="">Choose an account…</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </label>
                <label className="cmr-field span-all">
                  <span className="cmr-label">Report (.xlsx or .csv)</span>
                  <input
                    className="cmr-input cmr-ap-file"
                    type="file"
                    accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                    disabled={busy}
                  />
                </label>
                {mismatch && (
                  <p className="cmr-rq-dialognote span-all cmr-ap-warn" role="note">
                    <CmrIcon name="alert" size={13} /> The file name says <b>{mismatch.name}</b>, but you chose{' '}
                    <b>{account?.name}</b>. Check it is the right report before importing.
                  </p>
                )}
                {account && (
                  <p className="cmr-rq-dialognote span-all">
                    Importing replaces <b>{account.name}</b>&rsquo;s current A/P snapshot.
                  </p>
                )}
              </div>
              {error && <div className="cmr-notice err" role="alert" style={{ marginTop: 14 }}>{error}</div>}
              <div className="acts">
                <button type="button" className="cmr-btn sm ghost" onClick={onCancel} disabled={busy}>Cancel</button>
                <button type="submit" className="cmr-btn sm" disabled={busy}>
                  {busy ? 'Reading…' : 'Preview'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 id="cmr-ap-dlg-title" className="cmr-serif">Import {preview.account.name} A/P?</h2>
            <p id="cmr-ap-dlg-desc" className="cmr-ap-file-line">{preview.fileName}</p>

            <div className={`cmr-ap-recon${s.reconciled ? '' : ' bad'}`} role={s.reconciled ? undefined : 'alert'}>
              <CmrIcon name={s.reconciled ? 'check' : 'alert'} size={15} />
              <span>
                {s.reconciled ? (
                  <>The {plural(s.lineCount, 'line')} add up to the report TOTAL of <b>{formatBalanceCents(s.reportTotalCents)}</b>.</>
                ) : (
                  <>
                    The lines add up to <b>{formatBalanceCents(s.importedTotalCents)}</b>, but the report TOTAL is{' '}
                    <b>{formatBalanceCents(s.reportTotalCents)}</b> (off by {formatBalanceCents(s.differenceCents)}). Check the
                    export before importing.
                  </>
                )}
              </span>
            </div>

            <dl className="cmr-ap-sum">
              <div className="big"><dt>Payable (bills − credits)</dt><dd className="cmr-num">{formatBalanceCents(s.payableTotalCents)}</dd></div>
              <div><dt>Vendors owed</dt><dd className="cmr-num">{s.payableVendorCount}</dd></div>
              <div><dt>Bills</dt><dd className="cmr-num">{s.docTypeCounts.Bill ?? 0}</dd></div>
              <div><dt>Credits</dt><dd className="cmr-num">{s.docTypeCounts.Credit ?? 0}</dd></div>
              <div>
                <dt>Not payable</dt>
                <dd className="cmr-num">
                  {s.lineCount - s.payableLineCount}
                  {otherTypes.length > 0 && <span className="why">{otherTypes.map(([t, n]) => `${n} ${t}`).join(', ')}</span>}
                </dd>
              </div>
            </dl>

            {s.sampleVendors.length > 0 && (
              <div className="cmr-ap-sample">
                <span className="cmr-label">Largest balances</span>
                <ul>
                  {s.sampleVendors.map((v) => (
                    <li key={v.vendorName}>
                      <span className="nm">{v.vendorName}</span>
                      <span className="cmr-num">{formatBalanceCents(v.owedCents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="cmr-rq-dialognote">
              {preview.replaces ? (
                <>
                  Replaces the snapshot imported <b>{stamp(preview.replaces.importedAt)}</b>
                  {preview.replaces.importedByName ? ` by ${preview.replaces.importedByName}` : ''} (
                  {plural(preview.replaces.lineCount, 'line')}, {formatBalanceCents(preview.replaces.payableTotalCents)} payable).
                </>
              ) : (
                <>This is {preview.account.name}&rsquo;s first A/P import.</>
              )}
            </p>

            {error && <div className="cmr-notice err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
            <div className="acts">
              <button type="button" className="cmr-btn sm ghost" onClick={() => { setPreview(null); setError(null) }} disabled={busy}>
                Back
              </button>
              <button
                type="button"
                ref={(el) => { firstRef.current = el }}
                className={`cmr-btn sm${s.reconciled ? '' : ' danger'}`}
                onClick={() => void runCommit()}
                disabled={busy}
              >
                <CmrIcon name="check" size={14} />
                {busy ? 'Importing…' : s.reconciled ? (preview.replaces ? `Replace ${preview.account.name} A/P` : 'Import') : 'Import anyway'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
