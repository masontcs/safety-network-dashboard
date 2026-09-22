'use client'

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import Select from '@/components/billing/Select'
import CmrIcon from '@/components/cmr/CmrIcon'
import { InvoiceTable } from '@/components/cmr/CmrApClient'
import { formatAging } from '@/lib/cmr/ap'
import { formatBalanceCents } from '@/lib/cmr/ledger'
import {
  displayVendorName,
  matchesVendorQuery,
  vendorRollup,
  vendorRollupTotals,
  type CmrVendorAccountShare,
  type CmrVendorRollupRow,
  type CmrVendorSort,
  type CmrVendorsView,
} from '@/lib/cmr/vendors'

/**
 * Vendors — the cross-account rollup (AP Phase 3a). READ ONLY, for every CMR role.
 *
 * One row per canonical vendor with the total owed across every account's current A/P (Σ open
 * bills − open credits, payable lines only). Open a vendor for its per-account subtotals; open
 * an account for that account's invoices. The account filter narrows every figure to that one
 * account; search matches the vendor's name, any QuickBooks spelling of it, or an invoice #.
 *
 * Only identical spellings (after conservative normalization) are one vendor here. Merging
 * differently-spelled vendors, renaming and AI merge suggestions are AP Phase 3b — there is no
 * control on this screen that changes anything.
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

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const counts = (b: number, c: number) => [plural(b, 'bill'), c ? plural(c, 'credit') : null].filter(Boolean).join(' · ')

export default function CmrVendorsClient() {
  const [view, setView] = useState<CmrVendorsView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState('')
  const [sort, setSort] = useState<CmrVendorSort>('owed')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const load = useCallback(async () => {
    const r = await getJson<CmrVendorsView>('/api/cmr/vendors')
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

  const filter = accountId === '' ? null : accountId
  // Only accounts that have an A/P import can narrow the rollup.
  const filterAccounts = useMemo(() => {
    if (!view) return []
    const withAp = new Set(view.imports.map((i) => i.accountId))
    return view.accounts.filter((a) => withAp.has(a.id))
  }, [view])
  const scope = filterAccounts.find((a) => a.id === filter)?.name ?? 'All accounts'

  const rows = useMemo(() => (view ? vendorRollup(view, filter, sort) : []), [view, filter, sort])
  const totals = useMemo(() => vendorRollupTotals(rows), [rows])
  const shown = useMemo(() => rows.filter((r) => matchesVendorQuery(r, query)), [rows, query])
  const unlinked = useMemo(
    () => (view ? view.lines.filter((l) => !l.vendorId && (filter === null || l.accountId === filter)).length : 0),
    [view, filter],
  )

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

  const nothingImported = view !== null && view.imports.length === 0

  return (
    <>
      <header className="cmr-pagehead cmr-lg-head">
        <div>
          <h1 className="cmr-serif">Vendors</h1>
          <p>
            Every vendor owed across the accounts&rsquo; current A/P — the total, then each account&rsquo;s share and its
            invoices.
          </p>
        </div>
      </header>

      {loadError && (
        <div className="cmr-notice err" role="alert" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <button type="button" className="cmr-btn sm ghost" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {!view && !loadError && (
        <div aria-busy="true" aria-label="Loading vendors">
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

      {nothingImported && (
        <div className="cmr-card cmr-lg-empty" role="status">
          No A/P has been imported yet. Vendors appear here once an account&rsquo;s QuickBooks A/P aging is imported on{' '}
          <a href="/cmr/ap">Accounts Payable</a>.
        </div>
      )}

      {view && !nothingImported && (
        <>
          <VendorsHero totals={totals} scope={scope} allAccounts={filter === null} />

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

          <section className="cmr-sec" aria-labelledby="cmr-vn-title">
            <div className="cmr-sh cmr-lg-sh">
              <div className="hd">
                <h2 id="cmr-vn-title">Vendors owed</h2>
                <span className="c">
                  {scope} · {plural(rows.length, 'vendor')}
                  {query.trim() && shown.length !== rows.length ? ` · ${shown.length} shown` : ''}
                </span>
              </div>
              <span className="tot">Owed <b className="cmr-num">{formatBalanceCents(totals.owedCents)}</b></span>
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
              Owed is every open Bill less every open Credit. A vendor spelled identically in QuickBooks under several
              accounts is one vendor here; differently spelled ones are listed separately for now.
            </p>
            {unlinked > 0 && (
              <div className="cmr-notice" role="note" style={{ marginBottom: 12 }}>
                <CmrIcon name="alert" size={14} />
                <span>
                  {plural(unlinked, 'invoice')} {unlinked === 1 ? 'is' : 'are'} not linked to a vendor yet and{' '}
                  {unlinked === 1 ? 'is' : 'are'} grouped by the QuickBooks name. Re-importing that account&rsquo;s A/P links them.
                </span>
              </div>
            )}
            <div className="cmr-card">
              {shown.length === 0 ? (
                <div className="cmr-lg-empty">
                  {rows.length === 0 ? `No open bills or credits in ${scope === 'All accounts' ? 'any account' : scope}.` : 'No vendor or invoice matches that search.'}
                </div>
              ) : (
                <ul className="cmr-ap-list" aria-label="Vendors owed">
                  {shown.map((r) => (
                    <VendorRow
                      key={r.key}
                      row={r}
                      allAccounts={filter === null}
                      open={open.has(r.key)}
                      isOpen={(k) => open.has(k)}
                      onToggle={toggle}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </>
  )
}

// ── the masthead ────────────────────────────────────────────────────────────

function VendorsHero({ totals, scope, allAccounts }: { totals: ReturnType<typeof vendorRollupTotals>; scope: string; allAccounts: boolean }) {
  const whole = formatBalanceCents(totals.owedCents)
  const dot = whole.lastIndexOf('.')
  return (
    <section className="cmr-hero cmr-lg-hero" aria-labelledby="cmr-vn-hero-cap">
      <div className="l">
        <h2 className="cmr-hero-cap" id="cmr-vn-hero-cap">Owed to vendors · {scope}</h2>
        <p className={`cmr-hero-big cmr-serif cmr-num${totals.owedCents < 0 ? ' neg' : ''}`}>
          {whole.slice(0, dot)}<span className="c">{whole.slice(dot)}</span>
        </p>
        <div className="cmr-hero-rule" aria-hidden="true" />
        <p className="cmr-hero-meta">
          <b>{plural(totals.vendorCount, 'vendor')}</b>
          {allAccounts && <> · {plural(totals.multiAccountCount, 'vendor')} owed by more than one account</>}
        </p>
      </div>
      <dl className="cmr-lg-stmt">
        <div>
          <dt>Accounts</dt>
          <dd className="cmr-num">{totals.accountCount}</dd>
        </div>
        <div>
          <dt>Open bills</dt>
          <dd className="cmr-num">{totals.billCount.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt>Open credits</dt>
          <dd className="cmr-num">{totals.creditCount.toLocaleString('en-US')}</dd>
        </div>
        <div className="total">
          <dt>Bills − credits</dt>
          <dd className="cmr-num">{whole}</dd>
        </div>
      </dl>
    </section>
  )
}

// ── one canonical vendor ────────────────────────────────────────────────────

function VendorRow({
  row: r,
  allAccounts,
  open,
  isOpen,
  onToggle,
}: {
  row: CmrVendorRollupRow
  allAccounts: boolean
  open: boolean
  isOpen: (key: string) => boolean
  onToggle: (key: string) => void
}) {
  // useId, not the name: distinct vendors can share a punctuation-free name.
  const panel = `cmr-vn-acc-${useId().replace(/:/g, '')}`
  const name = displayVendorName(r.name)
  const accNames = r.accounts.map((s) => s.accountName)
  // A vendor in one account opens straight onto its invoices.
  const single = r.accounts.length === 1
  return (
    <li className={`cmr-ap-ven cmr-vn-row${open ? ' open' : ''}`}>
      <button type="button" className="cmr-row cmr-ap-venbtn" aria-expanded={open} aria-controls={panel} onClick={() => onToggle(r.key)}>
        <CmrIcon name="right" size={14} className="chev" />
        <span className="who">
          <span className="desc">
            <span className="nm">{name}</span>
            {allAccounts && r.accounts.length > 1 && <span className="cmr-pill ok">{r.accounts.length} accounts</span>}
            {!r.vendorId && <span className="cmr-pill warn">Not linked</span>}
          </span>
          <span className="mt">
            {allAccounts ? `${accNames.join(', ')} · ` : ''}
            {counts(r.billCount, r.creditCount)}
            {r.oldestAgingDays !== null ? ` · oldest ${formatAging(r.oldestAgingDays)}` : ''}
          </span>
        </span>
        <span className={`amt cmr-num${r.owedCents < 0 ? ' neg' : ''}`}>
          {formatBalanceCents(r.owedCents)}
          {r.owedCents < 0 && <span className="sub">in credit</span>}
        </span>
      </button>
      {open && (
        <div id={panel} className="cmr-vn-accs">
          <ul className="cmr-ap-list" aria-label={`${name} by account`}>
            {r.accounts.map((s) => {
              const key = `${r.key}\u0000${s.accountId}`
              return (
                <AccountShare
                  key={key}
                  vendorName={name}
                  share={s}
                  open={single || isOpen(key)}
                  fixed={single}
                  onToggle={() => onToggle(key)}
                />
              )
            })}
          </ul>
        </div>
      )}
    </li>
  )
}

// ── one account's share of a vendor ─────────────────────────────────────────

function AccountShare({
  vendorName,
  share: s,
  open,
  fixed,
  onToggle,
}: {
  vendorName: string
  share: CmrVendorAccountShare
  open: boolean
  /** The vendor's only account: always open, not a toggle. */
  fixed: boolean
  onToggle: () => void
}) {
  const panel = `cmr-vn-inv-${useId().replace(/:/g, '')}`
  // Show the QuickBooks spelling when it differs from the canonical name (case, spaces, a trailing ".").
  const spellings = s.rawNames.map(displayVendorName).filter((n) => n !== vendorName)
  const body = (
    <>
      <span className="who">
        <span className="desc"><span className="nm">{s.accountName}</span></span>
        <span className="mt">
          {counts(s.billCount, s.creditCount)}
          {s.oldestAgingDays !== null ? ` · oldest ${formatAging(s.oldestAgingDays)}` : ''}
          {spellings.length > 0 && <> · in QuickBooks as {spellings.map((n) => `“${n}”`).join(', ')}</>}
        </span>
      </span>
      <span className={`amt cmr-num${s.owedCents < 0 ? ' neg' : ''}`}>
        {formatBalanceCents(s.owedCents)}
        {s.owedCents < 0 && <span className="sub">in credit</span>}
      </span>
    </>
  )
  return (
    <li className={`cmr-ap-ven cmr-vn-acc${open ? ' open' : ''}`}>
      {fixed ? (
        <div className="cmr-row cmr-ap-venbtn cmr-vn-accrow">
          <CmrIcon name="down" size={14} className="chev fixed" />
          {body}
        </div>
      ) : (
        <button type="button" className="cmr-row cmr-ap-venbtn cmr-vn-accrow" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
          <CmrIcon name="right" size={14} className="chev" />
          {body}
        </button>
      )}
      {open && (
        <div id={panel} className="cmr-ap-inv cmr-vn-inv">
          <InvoiceTable lines={s.lines} caption={`Open invoices for ${vendorName} in ${s.accountName}`} />
        </div>
      )}
    </li>
  )
}
