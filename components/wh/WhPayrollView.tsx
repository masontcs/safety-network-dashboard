'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  summarizeWhPayrollPeriod,
  whPayrollTrend,
  formatWhPeriod,
  type WhPayrollLineRow,
  type WhPayrollPeriodRow,
  type WhPayrollSort,
} from '@/lib/wh/payroll-summary'

/**
 * The Western Highways payroll view: one pay period in detail, and the series it belongs to.
 *
 * Payroll is the first WH area with HISTORY, which is what shapes this screen. The period picker
 * changes the URL (?period=…) so the server fetches that period's lines — the lines are the only
 * part that is per-period, and a week is sixteen rows. The trend is built from the period rows
 * the page already has, so scrolling the history costs nothing.
 *
 * Money is formatted from integer cents; hours stay decimal hours. Withheld taxes are stored
 * negative and shown that way, so a column of them adds up on screen the way it does in the
 * database.
 */

interface Props {
  /** Newest first, as the server ordered them. */
  periods: WhPayrollPeriodRow[]
  selectedPeriodId: string | null
  /** The selected period's lines only. */
  lines: WhPayrollLineRow[]
  canUpload: boolean
}

function fmt(cents: number): string {
  const v = cents / 100
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtHours(hours: number): string {
  return hours.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function signed(cents: number): string {
  return (cents > 0 ? '+' : '') + fmt(cents).replace('-$', '-$')
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

const SORTS: [WhPayrollSort, string][] = [
  ['gross', 'Gross'],
  ['hours', 'Hours'],
  ['net', 'Net'],
  ['name', 'Name'],
]

export default function WhPayrollView({ periods, selectedPeriodId, lines, canUpload }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [sort, setSort] = useState<WhPayrollSort>('gross')
  const [showInactive, setShowInactive] = useState(true)

  const selected = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  )

  const visible = useMemo(
    () => (showInactive ? lines : lines.filter((l) => l.isActive)),
    [lines, showInactive],
  )
  const summary = useMemo(() => summarizeWhPayrollPeriod(visible, sort), [visible, sort])

  // Oldest first for reading left to right; the history table below reverses it.
  const trend = useMemo(() => whPayrollTrend(periods), [periods])
  const thisPoint = useMemo(() => trend.find((t) => t.periodId === selectedPeriodId) ?? null, [trend, selectedPeriodId])
  const peakGross = useMemo(() => Math.max(1, ...trend.map((t) => t.grossTotalCents)), [trend])

  const choose = (id: string) => {
    const next = new URLSearchParams(searchParams.toString())
    next.set('period', id)
    router.push(`/wh/payroll?${next.toString()}`)
  }

  if (!selected) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: 48 }}>
        <div style={{ fontSize: 15, color: 'var(--text-primary)', marginBottom: 6 }}>
          No Western Highways payroll yet
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {canUpload
            ? 'Upload the QuickBooks Online Payroll Summary by Employee export on the Import tab. Each pay period is kept, so importing week by week builds the history.'
            : 'Ask an administrator to upload the QuickBooks Online payroll export.'}
        </div>
      </div>
    )
  }

  const inactiveInPeriod = lines.filter((l) => !l.isActive).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Header + period picker ────────────────────────────────────────── */}
      <div className="wh-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
            Western Highways · Payroll
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {formatWhPeriod(selected.periodStart, selected.periodEnd)} · {selected.employeeCount} employee
            {selected.employeeCount === 1 ? '' : 's'}
            {selected.sourceFilename ? ` · ${selected.sourceFilename}` : ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            Imported {fmtDateTime(selected.importedAt)}
            {selected.importedBy ? ` by ${selected.importedBy}` : ''}
            {periods.length > 1 ? ` · ${periods.length} periods stored` : ''}
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ ...label, marginBottom: 0 }}>Pay period</span>
          <select
            value={selected.id}
            onChange={(e) => choose(e.target.value)}
            style={{
              padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13, maxWidth: '100%',
            }}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {formatWhPeriod(p.periodStart, p.periodEnd)} · {fmt(p.grossTotalCents)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── The period's figures ──────────────────────────────────────────── */}
      <div className="wh-payroll-grid">
        <div style={{ ...card, background: '#ff6b00', border: 'none' }}>
          <div style={{ ...label, color: 'rgba(255,255,255,0.75)' }}>Gross pay</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#fff' }}>{fmt(summary.grossCents)}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
            {thisPoint?.grossChangeCents === null || thisPoint === null
              ? 'First period stored'
              : `${signed(thisPoint.grossChangeCents!)} vs the week before${
                  thisPoint.grossChangePct !== null ? ` (${thisPoint.grossChangePct > 0 ? '+' : ''}${thisPoint.grossChangePct.toFixed(1)}%)` : ''
                }`}
          </div>
        </div>

        <div style={card}>
          <div style={label}>Hours</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{fmtHours(summary.totalHours)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {summary.averageHourlyCents === null ? 'No hours logged' : `${fmt(summary.averageHourlyCents)} avg per hour`}
          </div>
        </div>

        <div style={card}>
          <div style={label}>Employee taxes</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-secondary)' }}>{fmt(summary.taxesCents)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Withheld from pay</div>
        </div>

        <div style={card}>
          <div style={label}>Net pay</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(summary.netCents)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Adjusted gross less taxes</div>
        </div>

        <div style={card}>
          <div style={label}>Employees</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{summary.employeeCount}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {inactiveInPeriod > 0
              ? `${summary.activeCount} active · ${inactiveInPeriod} inactive`
              : 'All active'}
            {thisPoint?.headcountChange ? ` · ${thisPoint.headcountChange > 0 ? '+' : ''}${thisPoint.headcountChange} vs prior` : ''}
          </div>
        </div>
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Sort by</span>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {SORTS.map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setSort(v)}
              aria-pressed={sort === v}
              style={{
                padding: '8px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                background: sort === v ? '#ff6b00' : 'var(--bg-surface)',
                color: sort === v ? '#fff' : 'var(--text-muted)',
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {inactiveInPeriod > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Include inactive employees
          </label>
        )}
      </div>

      {/* ── The period's employees ────────────────────────────────────────── */}
      <div className="wh-table-wrap" style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>Employee</th>
              {['Hours', 'Gross', 'Taxes', 'Net'].map((h) => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)' }}>
                  {r.employeeName}
                  {!r.isActive && (
                    <span
                      style={{
                        marginLeft: 8, padding: '2px 7px', borderRadius: 999, fontSize: 10,
                        background: 'var(--pill-neutral-bg)', color: 'var(--pill-neutral-fg)', whiteSpace: 'nowrap',
                      }}
                      title="Marked inactive or terminated in QuickBooks (the report prefixes the name with an asterisk)"
                    >
                      inactive
                    </span>
                  )}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtHours(r.hours)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(r.grossCents)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmt(r.taxesCents)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(r.netCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--border-emphasis)' }}>
              <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                {summary.employeeCount} employee{summary.employeeCount === 1 ? '' : 's'}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtHours(summary.totalHours)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{fmt(summary.grossCents)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmt(summary.taxesCents)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{fmt(summary.netCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phone: cards, so nothing scrolls sideways */}
      <div className="wh-card-list">
        {summary.rows.map((r) => (
          <div key={r.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.employeeName}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  {fmtHours(r.hours)} hrs · taxes {fmt(r.taxesCents)}
                  {!r.isActive ? ' · inactive' : ''}
                </span>
              </span>
              <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'block', fontSize: 14, color: 'var(--text-primary)' }}>{fmt(r.grossCents)}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>net {fmt(r.netCents)}</span>
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── The series ────────────────────────────────────────────────────── */}
      {periods.length > 1 && (
        <div style={card}>
          <div style={label}>Gross payroll by period</div>

          {/* A plain bar per period — no chart library, and it reads the same in both themes. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {[...trend].reverse().map((t) => {
              const isSelected = t.periodId === selectedPeriodId
              return (
                <button
                  key={t.periodId}
                  type="button"
                  onClick={() => choose(t.periodId)}
                  aria-current={isSelected ? 'true' : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '4px 6px',
                    background: isSelected ? 'var(--bg-secondary)' : 'none', border: 'none',
                    borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ flex: '0 0 auto', width: 132, fontSize: 11, color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {formatWhPeriod(t.periodStart, t.periodEnd)}
                  </span>
                  <span style={{ flex: '1 1 auto', minWidth: 0, height: 14, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                    <span
                      style={{
                        display: 'block', height: '100%',
                        width: `${Math.max(1, (t.grossTotalCents / peakGross) * 100)}%`,
                        background: isSelected ? '#ff6b00' : 'var(--text-dim)',
                        borderRadius: 3,
                      }}
                    />
                  </span>
                  <span style={{ flex: '0 0 auto', width: 96, textAlign: 'right', fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    {fmt(t.grossTotalCents)}
                  </span>
                  <span style={{ flex: '0 0 auto', width: 64, textAlign: 'right', fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    {t.employeeCount} ppl
                  </span>
                </button>
              )
            })}
          </div>

          {/* The same series as numbers, newest first */}
          <div className="wh-table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Period', 'Employees', 'Hours', 'Gross', 'vs prior', 'Net'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: i === 0 ? 'left' : 'right', fontSize: 10, color: 'var(--text-dim)', fontWeight: 400, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...trend].reverse().map((t) => (
                  <tr key={t.periodId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        onClick={() => choose(t.periodId)}
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12,
                          color: t.periodId === selectedPeriodId ? '#ff6b00' : 'var(--text-secondary)',
                        }}
                      >
                        {formatWhPeriod(t.periodStart, t.periodEnd)}
                      </button>
                    </td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{t.employeeCount}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtHours(t.totalHours)}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(t.grossTotalCents)}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {t.grossChangeCents === null ? '—' : signed(t.grossChangeCents)}
                    </td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmt(t.netTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: the series stacked */}
          <div className="wh-card-list">
            {[...trend].reverse().map((t) => (
              <button
                key={t.periodId}
                type="button"
                onClick={() => choose(t.periodId)}
                style={{
                  ...card, display: 'flex', justifyContent: 'space-between', gap: 8, cursor: 'pointer',
                  textAlign: 'left', background: t.periodId === selectedPeriodId ? 'var(--bg-secondary)' : 'var(--bg-surface)',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)' }}>
                    {formatWhPeriod(t.periodStart, t.periodEnd)}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {t.employeeCount} people · {fmtHours(t.totalHours)} hrs
                  </span>
                </span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)' }}>{fmt(t.grossTotalCents)}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {t.grossChangeCents === null ? 'first period' : signed(t.grossChangeCents)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
