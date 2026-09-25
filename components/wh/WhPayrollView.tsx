'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  summarizeWhPayrollPeriod,
  whPayrollTrend,
  whCostsOf,
  formatWhPeriod,
  type WhPayrollBreakdownItem,
  type WhPayrollEmployeeCosts,
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
 * It reads as a COST report rather than a payslip: the headline is what Western Highways actually
 * pays — gross, plus the employer's own payroll taxes, plus its company contributions — with the
 * employee-facing figures (gross, withheld taxes, net) beside it. Every employer-side figure is
 * derived server-side from the report's own items, so the reconciliation line under the headline
 * is the report's identity checked, not a restatement of it.
 *
 * Money is formatted from integer cents; hours stay decimal hours. Withheld taxes are stored
 * negative and shown that way, so a column of them adds up on screen the way it does in the
 * database.
 */

interface Props {
  /** Newest first, as the server ordered them. */
  periods: WhPayrollPeriodRow[]
  selectedPeriodId: string | null
  /** The selected period's lines only, each carrying its derived employer-side figures. */
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
  ['cost', 'Total cost'],
  ['hours', 'Hours'],
  ['net', 'Net'],
  ['name', 'Name'],
]

const th = {
  padding: '10px 12px',
  textAlign: 'right' as const,
  fontSize: 11,
  color: 'var(--text-dim)',
  fontWeight: 400,
  whiteSpace: 'nowrap' as const,
}

const money = { padding: '10px 12px', textAlign: 'right' as const, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap' as const }
const quiet = { padding: '10px 12px', textAlign: 'right' as const, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' as const }

/** One block of the per-employee breakdown: a heading, its lines, and its own total. */
function Breakdown({ title, items, totalLabel, totalCents }: {
  title: string
  items: WhPayrollBreakdownItem[]
  totalLabel: string
  totalCents: number
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...label, marginBottom: 6 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>None</div>
      ) : (
        items.map((i) => (
          <div key={i.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '2px 0' }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.label}</span>
            <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmt(i.cents)}</span>
          </div>
        ))
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '6px 0 0', marginTop: 4, borderTop: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--text-dim)' }}>{totalLabel}</span>
        <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(totalCents)}</span>
      </div>
    </div>
  )
}

/**
 * Everything the report holds for one employee, in four blocks.
 *
 * Employer taxes are listed by their five named items even when a rate is zero — on the WH file
 * FUTA, CA ETT and CA SUI all are, and "$0.00" is the answer to "what did this person cost us in
 * that tax", not a line worth hiding.
 */
function EmployeeBreakdown({ costs }: { costs: WhPayrollEmployeeCosts }) {
  const et = costs.employerTaxes
  const employerLines: WhPayrollBreakdownItem[] = [
    { label: 'Social Security (employer)', cents: et.socialSecurityCents },
    { label: 'Medicare (employer)', cents: et.medicareCents },
    { label: 'FUTA', cents: et.futaCents },
    { label: 'CA ETT', cents: et.caEttCents },
    { label: 'CA SUI', cents: et.caSuiCents },
    ...(et.otherCents !== 0 ? [{ label: 'Other employer taxes', cents: et.otherCents }] : []),
  ]

  const pt = costs.employeeTaxes
  const employeeLines: WhPayrollBreakdownItem[] = [
    { label: 'Federal income tax', cents: pt.federalIncomeCents },
    { label: 'Social Security', cents: pt.socialSecurityCents },
    { label: 'Medicare', cents: pt.medicareCents },
    { label: 'CA income tax', cents: pt.caIncomeCents },
    { label: 'CA SDI', cents: pt.caSdiCents },
    ...(pt.otherCents !== 0 ? [{ label: 'Other withholdings', cents: pt.otherCents }] : []),
  ]

  return (
    <div className="wh-breakdown-grid">
      <Breakdown
        title="Earnings"
        items={costs.earnings}
        totalLabel="Gross pay"
        totalCents={costs.earnings.reduce((s, i) => s + i.cents, 0)}
      />
      <Breakdown title="Employee taxes" items={employeeLines} totalLabel="Withheld" totalCents={pt.totalCents} />
      <Breakdown title="Employer taxes" items={employerLines} totalLabel="Employer taxes" totalCents={et.totalCents} />
      <Breakdown title="Company contributions" items={costs.contributions} totalLabel="Contributions" totalCents={costs.contributionsCents} />
    </div>
  )
}

export default function WhPayrollView({ periods, selectedPeriodId, lines, canUpload }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [sort, setSort] = useState<WhPayrollSort>('gross')
  const [showInactive, setShowInactive] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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
  const peakCost = useMemo(() => Math.max(1, ...trend.map((t) => t.totalCostCents)), [trend])

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

      {/* ── What Western Highways actually pays ───────────────────────────── */}
      <div className="wh-payroll-cost-grid">
        <div style={{ ...card, background: '#ff6b00', border: 'none' }}>
          <div style={{ ...label, color: 'rgba(255,255,255,0.75)' }}>Total payroll cost</div>
          <div style={{ fontSize: 26, fontWeight: 500, color: '#fff' }}>{fmt(summary.totalCostCents)}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
            {thisPoint === null || thisPoint.totalCostChangeCents === null
              ? 'First period stored'
              : `${signed(thisPoint.totalCostChangeCents)} vs the week before${
                  thisPoint.totalCostChangePct !== null ? ` (${thisPoint.totalCostChangePct > 0 ? '+' : ''}${thisPoint.totalCostChangePct.toFixed(1)}%)` : ''
                }`}
          </div>
        </div>

        <div style={card}>
          <div style={label}>Employer taxes</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(summary.employerTaxesCents)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Social Security {fmt(summary.employerTaxes.socialSecurityCents)} · Medicare {fmt(summary.employerTaxes.medicareCents)}
          </div>
        </div>

        <div style={card}>
          <div style={label}>Company contributions</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(summary.contributionsCents)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {summary.contributions.length === 0 ? 'None this period' : summary.contributions.map((c) => c.label).join(' · ')}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: summary.reconciles ? 'var(--text-dim)' : '#c0392b' }}>
        {summary.reconciles
          ? `Gross ${fmt(summary.grossCents)} + employer taxes ${fmt(summary.employerTaxesCents)} + contributions ${fmt(summary.contributionsCents)} = ${fmt(summary.totalCostCents)}`
          : `Gross ${fmt(summary.grossCents)} + employer taxes ${fmt(summary.employerTaxesCents)} + contributions ${fmt(summary.contributionsCents)} does not equal the report’s own total payroll cost ${fmt(summary.totalCostCents)} — worth a look at the export.`}
      </div>

      {/* ── The period's employee-facing figures ──────────────────────────── */}
      <div className="wh-payroll-grid">
        <div style={card}>
          <div style={label}>Gross pay</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{fmt(summary.grossCents)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {thisPoint === null || thisPoint.grossChangeCents === null
              ? 'First period stored'
              : `${signed(thisPoint.grossChangeCents)} vs the week before${
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

        <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>
          Select an employee for their full breakdown
        </span>
      </div>

      {/* ── The period's employees ────────────────────────────────────────── */}
      <div className="wh-table-wrap" style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>Employee</th>
              {['Hours', 'Gross', 'Employee taxes', 'Net', 'Employer taxes', 'Total cost'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => {
              const costs = whCostsOf(r)
              const open = expanded.has(r.id)
              return [
                <tr key={r.id} style={{ borderBottom: open ? 'none' : '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)' }}>
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      aria-expanded={open}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
                        padding: 0, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)', textAlign: 'left',
                      }}
                    >
                      <span aria-hidden style={{ color: 'var(--text-dim)', fontSize: 10, width: 8 }}>{open ? '▾' : '▸'}</span>
                      {r.employeeName}
                    </button>
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
                  <td style={quiet}>{fmtHours(r.hours)}</td>
                  <td style={money}>{fmt(r.grossCents)}</td>
                  <td style={quiet}>{fmt(r.taxesCents)}</td>
                  <td style={money}>{fmt(r.netCents)}</td>
                  <td style={quiet}>{fmt(costs.employerTaxesCents)}</td>
                  <td style={{ ...money, fontWeight: 500 }}>{fmt(costs.totalCostCents)}</td>
                </tr>,
                open ? (
                  <tr key={`${r.id}-breakdown`} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    <td colSpan={7} style={{ padding: '12px 12px 16px 30px' }}>
                      <EmployeeBreakdown costs={costs} />
                    </td>
                  </tr>
                ) : null,
              ]
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--border-emphasis)' }}>
              <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                {summary.employeeCount} employee{summary.employeeCount === 1 ? '' : 's'}
              </td>
              <td style={quiet}>{fmtHours(summary.totalHours)}</td>
              <td style={{ ...money, fontWeight: 500 }}>{fmt(summary.grossCents)}</td>
              <td style={quiet}>{fmt(summary.taxesCents)}</td>
              <td style={{ ...money, fontWeight: 500 }}>{fmt(summary.netCents)}</td>
              <td style={quiet}>{fmt(summary.employerTaxesCents)}</td>
              <td style={{ ...money, fontWeight: 500 }}>{fmt(summary.totalCostCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phone: cards, so nothing scrolls sideways */}
      <div className="wh-card-list">
        {summary.rows.map((r) => {
          const costs = whCostsOf(r)
          const open = expanded.has(r.id)
          return (
            <div key={r.id} style={card}>
              <button
                type="button"
                onClick={() => toggle(r.id)}
                aria-expanded={open}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%',
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span aria-hidden style={{ color: 'var(--text-dim)', fontSize: 10, marginRight: 6 }}>{open ? '▾' : '▸'}</span>
                    {r.employeeName}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {fmtHours(r.hours)} hrs · gross {fmt(r.grossCents)} · net {fmt(r.netCents)}
                    {!r.isActive ? ' · inactive' : ''}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    employer taxes {fmt(costs.employerTaxesCents)}
                    {costs.contributionsCents !== 0 ? ` · contributions ${fmt(costs.contributionsCents)}` : ''}
                  </span>
                </span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'block', fontSize: 14, color: 'var(--text-primary)' }}>{fmt(costs.totalCostCents)}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>total cost</span>
                </span>
              </button>
              {open && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <EmployeeBreakdown costs={costs} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── The series ────────────────────────────────────────────────────── */}
      {periods.length > 1 && (
        <div style={card}>
          <div style={label}>Total payroll cost by period</div>

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
                        width: `${Math.max(1, (t.totalCostCents / peakCost) * 100)}%`,
                        background: isSelected ? '#ff6b00' : 'var(--text-dim)',
                        borderRadius: 3,
                      }}
                    />
                  </span>
                  <span style={{ flex: '0 0 auto', width: 96, textAlign: 'right', fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    {fmt(t.totalCostCents)}
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
                  {['Period', 'Employees', 'Hours', 'Gross', 'Employer taxes', 'Contributions', 'Total cost', 'vs prior'].map((h, i) => (
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
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmt(t.grossTotalCents)}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmt(t.employerTaxesTotalCents)}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmt(t.contributionsTotalCents)}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(t.totalCostCents)}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {t.totalCostChangeCents === null ? '—' : signed(t.totalCostChangeCents)}
                    </td>
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
                    {t.employeeCount} people · {fmtHours(t.totalHours)} hrs · gross {fmt(t.grossTotalCents)}
                  </span>
                </span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)' }}>{fmt(t.totalCostCents)}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {t.totalCostChangeCents === null ? 'first period' : signed(t.totalCostChangeCents)}
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
