'use client'

import { useMemo, useState } from 'react'
import {
  summarizeWhAging,
  whLocations,
  WH_BUCKET_ORDER,
  type WhAgingRow,
  type WhAgingBucket,
  type WhPartyFilter,
} from '@/lib/wh/summary'

/**
 * The Western Highways A/R and A/P aging view — one component, two reports.
 *
 * The snapshot is small (213 A/R lines, 684 A/P lines on the real exports), so the page ships
 * every row once and this component filters and rolls them up in the browser: bucket totals,
 * the grand total against the report's own TOTAL, and a counterparty list that expands to its
 * lines. No extra round trip, and the filters are instant.
 *
 * The outside-vs-intercompany split is given its own pair of cards rather than a footnote,
 * because for WH it is the number that changes the meaning of everything else: most of its
 * A/R lines are transfers between Safety Network entities, while most of its A/P money is owed
 * to genuine outside vendors.
 */

interface SnapshotMeta {
  reportAsOf: string | null
  filename: string | null
  importedAt: string | null
  importedBy: string | null
  lineCount: number
  reportTotalCents: number | null
  openTotalCents: number
  reconciled: boolean
}

interface Props {
  report: 'ar' | 'ap'
  snapshot: SnapshotMeta | null
  rows: WhAgingRow[]
  /** Whether this viewer may upload — drives the empty state's call to action. */
  canUpload: boolean
}

const BUCKET_COLORS: Record<WhAgingBucket, string> = {
  'Current': '#ff6b00',
  '1-30':    '#cc9900',
  '31-60':   '#cc6600',
  '61-90':   '#cc4444',
  '>90':     '#992222',
}

function fmt(cents: number): string {
  const v = cents / 100
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const card = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
} as const

const label = {
  fontSize: 11,
  color: 'var(--text-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
  marginBottom: 8,
}

export default function WhAgingView({ report, snapshot, rows, canUpload }: Props) {
  const isAr = report === 'ar'
  const partyNoun = isAr ? 'Customer' : 'Vendor'
  const openNoun = isAr ? 'receivable' : 'payable'

  const [location, setLocation] = useState('')
  const [party, setParty] = useState<WhPartyFilter>('all')
  const [openOnly, setOpenOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [bucket, setBucket] = useState<WhAgingBucket | ''>('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const locations = useMemo(() => whLocations(rows), [rows])
  const summary = useMemo(
    () => summarizeWhAging(rows, { location, party, openOnly, search }),
    [rows, location, party, openOnly, search],
  )

  // The bucket chip narrows the counterparty list without changing the cards above it, so the
  // totals a reader just looked at stay on screen while they drill in.
  const counterparties = useMemo(
    () => (bucket ? summary.counterparties.filter((c) => c.buckets[bucket] !== 0) : summary.counterparties),
    [summary, bucket],
  )

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  if (!snapshot) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: 48 }}>
        <div style={{ fontSize: 15, color: 'var(--text-primary)', marginBottom: 6 }}>
          No Western Highways A/{isAr ? 'R' : 'P'} snapshot yet
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {canUpload
            ? `Upload the QuickBooks Online A/${isAr ? 'R' : 'P'} Aging Detail export on the Import tab.`
            : 'Ask an administrator to upload the QuickBooks Online export.'}
        </div>
      </div>
    )
  }

  const variance =
    snapshot.reportTotalCents === null ? null : summarizeWhAging(rows).totalCents - snapshot.reportTotalCents

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Snapshot header ───────────────────────────────────────────────── */}
      <div className="wh-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
            Western Highways · A/{isAr ? 'R' : 'P'} Aging
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            As of {fmtDate(snapshot.reportAsOf)} · {snapshot.lineCount.toLocaleString()} lines
            {snapshot.filename ? ` · ${snapshot.filename}` : ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            Imported {fmtDateTime(snapshot.importedAt)}
            {snapshot.importedBy ? ` by ${snapshot.importedBy}` : ''}
          </div>
        </div>

        <div
          style={{
            padding: '6px 12px',
            borderRadius: 999,
            fontSize: 12,
            background: snapshot.reconciled ? 'var(--pill-paid-bg)' : 'var(--pill-overdue-bg)',
            color: snapshot.reconciled ? 'var(--pill-paid-fg)' : 'var(--pill-overdue-fg)',
            whiteSpace: 'nowrap',
          }}
          title={
            snapshot.reconciled
              ? "Every line adds up to the report's own TOTAL row."
              : `The lines do not add up to the report's TOTAL row${variance !== null ? ` (off by ${fmt(variance)})` : ''}.`
          }
        >
          {snapshot.reconciled ? '✓ Reconciled to report TOTAL' : '⚠ Does not reconcile'}
        </div>
      </div>

      {/* ── Aging cards ───────────────────────────────────────────────────── */}
      <div className="wh-aging-grid">
        <div
          onClick={() => setBucket('')}
          style={{ ...card, background: '#ff6b00', border: 'none', cursor: bucket ? 'pointer' : 'default' }}
        >
          <div style={{ ...label, color: 'rgba(255,255,255,0.75)' }}>Total {isAr ? 'A/R' : 'A/P'}</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#fff' }}>{fmt(summary.totalCents)}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>All buckets</div>
        </div>

        {WH_BUCKET_ORDER.map((b) => {
          const active = bucket === b
          const value = summary.bucketTotals[b]
          const share = summary.totalCents !== 0 ? (value / summary.totalCents) * 100 : 0
          return (
            <button
              key={b}
              type="button"
              onClick={() => setBucket(active ? '' : b)}
              aria-pressed={active}
              style={{
                ...card,
                textAlign: 'left',
                cursor: 'pointer',
                background: active ? 'var(--bg-secondary)' : 'var(--bg-surface)',
                border: `1px solid ${active ? BUCKET_COLORS[b] : 'var(--border)'}`,
              }}
            >
              <div style={label}>{b === 'Current' ? 'Current' : `${b} days`}</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: active ? BUCKET_COLORS[b] : 'var(--text-primary)' }}>
                {fmt(value)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{share.toFixed(1)}%</div>
            </button>
          )
        })}
      </div>

      {/* ── Outside vs intercompany ───────────────────────────────────────── */}
      <div className="wh-split-grid">
        <div style={card}>
          <div style={label}>Outside {isAr ? 'customers' : 'vendors'}</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(summary.outsideCents)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Real money {isAr ? 'owed to' : 'owed by'} WH
          </div>
        </div>
        <div style={card}>
          <div style={label}>Intercompany</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-secondary)' }}>{fmt(summary.intercompanyCents)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Safety Network entities · internal transfers
          </div>
        </div>
        <div style={card}>
          <div style={label}>Open {openNoun}</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(snapshot.openTotalCents)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {isAr ? 'Invoices + credit memos' : 'Bills + vendor credits'}
          </div>
        </div>
      </div>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${partyNoun.toLowerCase()}s…`}
          aria-label={`Search ${partyNoun.toLowerCase()}s`}
          style={{
            flex: '1 1 200px', minWidth: 0, padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg-surface)',
            color: 'var(--text-primary)', fontSize: 13,
          }}
        />

        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          aria-label="Location"
          style={{
            padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13,
          }}
        >
          <option value="">All locations</option>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>

        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {([['all', 'All'], ['outside', 'Outside'], ['internal', 'Intercompany']] as [WhPartyFilter, string][]).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setParty(v)}
              aria-pressed={party === v}
              style={{
                padding: '8px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                background: party === v ? '#ff6b00' : 'var(--bg-surface)',
                color: party === v ? '#fff' : 'var(--text-muted)',
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Open {openNoun} only
        </label>
      </div>

      {bucket && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Showing {partyNoun.toLowerCase()}s with a balance in <strong style={{ color: BUCKET_COLORS[bucket] }}>{bucket}</strong>
          {' · '}
          <button type="button" onClick={() => setBucket('')} style={{ background: 'none', border: 'none', color: '#ff6b00', cursor: 'pointer', padding: 0, fontSize: 12 }}>
            clear
          </button>
        </div>
      )}

      {/* ── Counterparties ────────────────────────────────────────────────── */}
      {counterparties.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Nothing matches those filters.
        </div>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="wh-table-wrap" style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>{partyNoun}</th>
                  {WH_BUCKET_ORDER.map((b) => (
                    <th key={b} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, whiteSpace: 'nowrap' }}>
                      {b}
                    </th>
                  ))}
                  <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {counterparties.map((c) => {
                  const open = expanded.has(c.name)
                  return (
                    <FragmentRow
                      key={c.name}
                      open={open}
                      onToggle={() => toggle(c.name)}
                      group={c}
                      isAr={isAr}
                    />
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid var(--border-emphasis)' }}>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                    {counterparties.length} {partyNoun.toLowerCase()}{counterparties.length === 1 ? '' : 's'} · {summary.rowCount} lines
                  </td>
                  {WH_BUCKET_ORDER.map((b) => (
                    <td key={b} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {fmt(summary.bucketTotals[b])}
                    </td>
                  ))}
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {fmt(summary.totalCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Phone: cards, so nothing scrolls sideways */}
          <div className="wh-card-list">
            {counterparties.map((c) => {
              const open = expanded.has(c.name)
              return (
                <div key={c.name} style={card}>
                  <button
                    type="button"
                    onClick={() => toggle(c.name)}
                    aria-expanded={open}
                    style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.name}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        {c.lineCount} line{c.lineCount === 1 ? '' : 's'}
                        {c.isIntercompany ? ' · intercompany' : ''}
                      </span>
                    </span>
                    <span style={{ fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(c.totalCents)}</span>
                  </button>

                  {open && (
                    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {c.rows.map((r) => (
                        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                          <span style={{ minWidth: 0, color: 'var(--text-muted)' }}>
                            {fmtDate(r.txnDate)} · {r.txnType}
                            {r.num ? ` · ${r.num}` : ''}
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                              due {fmtDate(r.dueDate)} · {r.agingBucket ?? '—'}
                            </span>
                          </span>
                          <span style={{ whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{fmt(r.openBalanceCents)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── One counterparty row, plus its expanded lines ────────────────────────────

function FragmentRow({
  group, open, onToggle, isAr,
}: {
  group: ReturnType<typeof summarizeWhAging>['counterparties'][number]
  open: boolean
  onToggle: () => void
  isAr: boolean
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
      >
        <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--text-dim)', marginRight: 6 }}>{open ? '▾' : '▸'}</span>
          {group.name}
          {group.isIntercompany && (
            <span
              style={{
                marginLeft: 8, padding: '2px 7px', borderRadius: 999, fontSize: 10,
                background: 'var(--pill-neutral-bg)', color: 'var(--pill-neutral-fg)', whiteSpace: 'nowrap',
              }}
              title="Another Safety Network entity — an internal transfer, not outside exposure"
            >
              intercompany
            </span>
          )}
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-dim)' }}>
            {group.lineCount} line{group.lineCount === 1 ? '' : 's'}
          </span>
        </td>
        {WH_BUCKET_ORDER.map((b) => (
          <td key={b} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: group.buckets[b] ? 'var(--text-secondary)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>
            {group.buckets[b] ? fmt(group.buckets[b]) : '—'}
          </td>
        ))}
        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {fmt(group.totalCents)}
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={WH_BUCKET_ORDER.length + 2} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Date', 'Type', 'Num', 'Location', 'Due', isAr ? '' : 'Past due', 'Bucket', 'Open balance'].map((h, i) => (
                    <th key={i} style={{ padding: '8px 12px', textAlign: i >= 6 ? 'right' : 'left', fontSize: 10, color: 'var(--text-dim)', fontWeight: 400, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(r.txnDate)}</td>
                    <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.txnType}</td>
                    <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--text-muted)' }}>{r.num ?? '—'}</td>
                    <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--text-muted)' }}>{r.location ?? '—'}</td>
                    <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(r.dueDate)}</td>
                    <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {isAr ? '' : r.pastDueDays === null ? '—' : `${r.pastDueDays}d`}
                    </td>
                    <td style={{ padding: '6px 12px', fontSize: 12, textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.agingBucket ?? '—'}</td>
                    <td style={{ padding: '6px 12px', fontSize: 12, textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(r.openBalanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}
