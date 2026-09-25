'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WH_BUCKET_ORDER, type WhAgingBucket } from '@/lib/wh/qbo'
import { formatWhPeriod } from '@/lib/wh/payroll-summary'
import type {
  WhImportPreview,
  WhImportCommitted,
  WhPayrollImportPreview,
  WhPayrollImportCommitted,
} from '@/lib/wh/import-preview'

/**
 * Upload a Western Highways QuickBooks Online report.
 *
 * Two steps, always: the file is parsed server-side and shown back as a preview — counts, both
 * totals, whether it reconciles to the report's own TOTAL row, the outside/intercompany split
 * and the first few rows — and only a second, explicit click writes anything. That matters
 * here more than usual, because an import REPLACES the current snapshot rather than adding to
 * it: whatever is on screen is what the WH dashboards will show afterwards.
 *
 * The report date gets its own field because the A/P export has no title block and therefore
 * no date of its own. The server derives it from due date + past-due days and says so; the
 * uploader can correct it, and an A/P file with no derivable date cannot be committed until
 * one is supplied.
 *
 * Payroll is the exception to "replaces the current snapshot". Pay periods ACCUMULATE: the
 * period comes from the report's own "From … to …" line (never typed by hand), and the upload
 * either adds that week to the history or overwrites the one already stored for it. The preview
 * says which, by name, before anything is written.
 */

type Report = 'ar' | 'ap' | 'payroll'

const REPORTS: { key: Report; label: string; hint: string }[] = [
  { key: 'ar', label: 'A/R Aging Detail', hint: 'Who owes Western Highways' },
  { key: 'ap', label: 'A/P Aging Detail', hint: 'What Western Highways owes' },
  { key: 'payroll', label: 'Payroll Summary by Employee', hint: 'One pay period, kept as history' },
]

/** What the file picker accepts — payroll still arrives as the old .xls. */
const ACCEPT: Record<Report, string> = {
  ar: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv',
  ap: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv',
  payroll: '.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function fmtHours(hours: number): string {
  return hours.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
  marginBottom: 6,
}

export default function WhImportClient() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)

  const [report, setReport] = useState<Report>('ar')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<WhImportPreview | null>(null)
  const [committed, setCommitted] = useState<WhImportCommitted | null>(null)
  const [payrollPreview, setPayrollPreview] = useState<WhPayrollImportPreview | null>(null)
  const [payrollCommitted, setPayrollCommitted] = useState<WhPayrollImportCommitted | null>(null)
  const [asOf, setAsOf] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setFile(null)
    setPreview(null)
    setCommitted(null)
    setPayrollPreview(null)
    setPayrollCommitted(null)
    setAsOf('')
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const chooseReport = (r: Report) => {
    setReport(r)
    reset()
  }

  const send = async (mode: 'preview' | 'commit') => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('mode', mode)
      // Payroll's period is read from the report and is never supplied by the client.
      if (asOf && report !== 'payroll') form.set('reportAsOf', asOf)

      const res = await fetch(`/api/wh/${report}/import`, { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))

      if (!res.ok || !body.success) {
        setError(body.error ?? 'That upload could not be processed.')
        if (mode === 'preview') {
          setPreview(null)
          setPayrollPreview(null)
        }
        return
      }

      if (mode === 'preview') {
        if (report === 'payroll') {
          setPayrollPreview(body.preview as WhPayrollImportPreview)
        } else {
          const p = body.preview as WhImportPreview
          setPreview(p)
          setAsOf(p.reportAsOf ?? '')
        }
      } else if (report === 'payroll') {
        setPayrollCommitted(body.committed as WhPayrollImportCommitted)
        setPayrollPreview(null)
        router.refresh()
      } else {
        setCommitted(body.committed as WhImportCommitted)
        setPreview(null)
        router.refresh()
      }
    } catch {
      setError('The upload could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const needsDate = report === 'ap' && !asOf
  // A payroll file that does not add up to its own Total column was not read correctly, and the
  // server refuses it outright — so the button says so rather than letting the click fail.
  const payrollBlocked = !!payrollPreview && !payrollPreview.reconciled

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 880 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
          Import a Western Highways report
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
          Export the report from QuickBooks Online and upload it here — <strong>.xlsx</strong> or{' '}
          <strong>.csv</strong> for the aging reports, <strong>.xls</strong> or <strong>.xlsx</strong> for payroll.
          An aging import <strong>replaces</strong> that report&rsquo;s current snapshot; a payroll import adds or
          replaces <strong>one pay period</strong> and leaves the rest of the history alone. Nothing is written
          until you confirm the preview.
        </p>
      </div>

      {/* ── 1. Which report ───────────────────────────────────────────────── */}
      <div style={card}>
        <div style={label}>1 · Report</div>
        <div className="wh-report-choices">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => chooseReport(r.key)}
              aria-pressed={report === r.key}
              style={{
                flex: '1 1 200px', textAlign: 'left', padding: 12, borderRadius: 10, cursor: 'pointer',
                background: report === r.key ? 'var(--accent-soft-bg)' : 'var(--bg-secondary)',
                border: `1px solid ${report === r.key ? '#ff6b00' : 'var(--border)'}`,
              }}
            >
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{r.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{r.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── 2. The file ───────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={label}>2 · File</div>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT[report]}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setPreview(null)
            setCommitted(null)
            setPayrollPreview(null)
            setPayrollCommitted(null)
            setError(null)
          }}
          style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: '100%' }}
        />
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => send('preview')}
            style={{
              padding: '9px 16px', borderRadius: 8, border: 'none', fontSize: 13,
              background: !file || busy ? 'var(--bg-tertiary)' : '#ff6b00',
              color: !file || busy ? 'var(--text-dim)' : '#fff',
              cursor: !file || busy ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Reading…' : 'Check the file'}
          </button>
          {(preview || committed || payrollPreview || payrollCommitted || error) && (
            <button
              type="button"
              onClick={reset}
              style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}
            >
              Start over
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ ...card, background: 'var(--alert-danger-bg)', border: 'none', color: 'var(--alert-danger-fg)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── 3. Preview ────────────────────────────────────────────────────── */}
      {preview && <PreviewPanel preview={preview} asOf={asOf} onAsOf={setAsOf} />}
      {payrollPreview && <PayrollPreviewPanel preview={payrollPreview} />}

      {payrollPreview && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy || payrollBlocked}
            onClick={() => send('commit')}
            style={{
              padding: '10px 18px', borderRadius: 8, border: 'none', fontSize: 14,
              background: busy || payrollBlocked ? 'var(--bg-tertiary)' : '#ff6b00',
              color: busy || payrollBlocked ? 'var(--text-dim)' : '#fff',
              cursor: busy || payrollBlocked ? 'default' : 'pointer',
            }}
          >
            {busy
              ? 'Importing…'
              : payrollPreview.existingPeriod
                ? 'Replace this pay period'
                : 'Add this pay period'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {payrollBlocked
              ? 'This file does not add up to its own Total column, so it cannot be imported.'
              : payrollPreview.existingPeriod
                ? `${formatWhPeriod(payrollPreview.periodStart, payrollPreview.periodEnd)} is already stored — its rows will be replaced. No other period is touched.`
                : `${formatWhPeriod(payrollPreview.periodStart, payrollPreview.periodEnd)} will be added to the history.`}
          </span>
        </div>
      )}

      {payrollCommitted && (
        <div style={{ ...card, background: 'var(--alert-success-bg)', border: 'none' }}>
          <div style={{ fontSize: 14, color: 'var(--alert-success-fg)', marginBottom: 6 }}>
            Imported {formatWhPeriod(payrollCommitted.periodStart, payrollCommitted.periodEnd)} ·{' '}
            {payrollCommitted.employeeCount} employees · {fmt(payrollCommitted.grossTotalCents)} gross
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {payrollCommitted.replacedExisting
              ? 'Replaced the period already stored for those dates. Every other period is unchanged.'
              : 'Added to the payroll history. Every other period is unchanged.'}
          </div>
          <a href="/wh/payroll" style={{ display: 'inline-block', marginTop: 10, fontSize: 13, color: '#ff6b00' }}>
            View the payroll →
          </a>
        </div>
      )}

      {preview && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy || needsDate}
            onClick={() => send('commit')}
            style={{
              padding: '10px 18px', borderRadius: 8, border: 'none', fontSize: 14,
              background: busy || needsDate ? 'var(--bg-tertiary)' : '#ff6b00',
              color: busy || needsDate ? 'var(--text-dim)' : '#fff',
              cursor: busy || needsDate ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Importing…' : `Replace the WH ${preview.report.toUpperCase()} snapshot`}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {needsDate
              ? 'Set the report date first — this export has none of its own.'
              : `${preview.lineCount.toLocaleString()} lines will replace whatever is there now.`}
          </span>
        </div>
      )}

      {/* ── 4. Done ───────────────────────────────────────────────────────── */}
      {committed && (
        <div style={{ ...card, background: 'var(--alert-success-bg)', border: 'none' }}>
          <div style={{ fontSize: 14, color: 'var(--alert-success-fg)', marginBottom: 6 }}>
            Imported {committed.lineCount.toLocaleString()} {committed.report.toUpperCase()} lines · {fmt(committed.sumOpenCents)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            As of {fmtDate(committed.reportAsOf)}
            {committed.replaced
              ? ` · replaced the snapshot from ${fmtDate(committed.replaced.reportAsOf)} (${committed.replaced.lineCount.toLocaleString()} lines)`
              : ' · first import for this report'}
          </div>
          <a
            href={`/wh/${committed.report}`}
            style={{ display: 'inline-block', marginTop: 10, fontSize: 13, color: '#ff6b00' }}
          >
            View the {committed.report.toUpperCase()} aging →
          </a>
        </div>
      )}
    </div>
  )
}

// ─── The preview panel ────────────────────────────────────────────────────────

function PreviewPanel({
  preview, asOf, onAsOf,
}: {
  preview: WhImportPreview
  asOf: string
  onAsOf: (v: string) => void
}) {
  const isAr = preview.report === 'ar'
  const variance = preview.reportTotalCents === null ? null : preview.sumOpenCents - preview.reportTotalCents

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={label}>3 · Check before importing</div>

      {/* Reconciliation — the headline */}
      <div
        style={{
          padding: 12, borderRadius: 10, fontSize: 13,
          background: preview.reconciled ? 'var(--alert-success-bg)' : 'var(--alert-danger-bg)',
          color: preview.reconciled ? 'var(--alert-success-fg)' : 'var(--alert-danger-fg)',
        }}
      >
        {preview.reconciled ? (
          <>✓ The {preview.lineCount.toLocaleString()} lines add up to the report&rsquo;s own TOTAL of {fmt(preview.reportTotalCents ?? 0)}.</>
        ) : (
          <>
            ⚠ The lines total {fmt(preview.sumOpenCents)}, but the report&rsquo;s TOTAL row says{' '}
            {preview.reportTotalCents === null ? 'nothing (no TOTAL row was found)' : fmt(preview.reportTotalCents)}
            {variance !== null ? ` — off by ${fmt(variance)}` : ''}. Importing anyway will store figures that do not
            match the report.
          </>
        )}
      </div>

      {/* Report date */}
      <div>
        <div style={label}>Report date</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={asOf}
            onChange={(e) => onAsOf(e.target.value)}
            aria-label="Report date"
            style={{
              padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13,
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {preview.reportAsOfSource === 'title' && 'Read from the report’s “As of” line.'}
            {preview.reportAsOfSource === 'derived' &&
              `Worked out from due date + past-due days — all ${preview.reportAsOfEvidence.toLocaleString()} past-due lines agree.`}
            {preview.reportAsOfSource === 'none' &&
              'This export carries no date and none could be worked out — set it yourself.'}
          </span>
        </div>
      </div>

      {/* Figures */}
      <div className="wh-preview-grid">
        <Stat title="Lines" value={preview.lineCount.toLocaleString()} note={Object.entries(preview.typeCounts).map(([t, n]) => `${n} ${t}`).join(' · ')} />
        <Stat title="Total open" value={fmt(preview.sumOpenCents)} note="Every line, signed" />
        <Stat title={isAr ? 'Receivable' : 'Payable'} value={fmt(preview.openTotalCents)} note={`${preview.openLineCount.toLocaleString()} ${isAr ? 'invoices + credit memos' : 'bills + vendor credits'}`} />
        <Stat title="Outside" value={fmt(preview.outsideCents)} note={`${(preview.lineCount - preview.intercompanyLineCount).toLocaleString()} lines`} />
        <Stat title="Intercompany" value={fmt(preview.intercompanyCents)} note={`${preview.intercompanyLineCount.toLocaleString()} Safety Network lines`} />
        <Stat title="Locations" value={String(preview.locations.length)} note={preview.locations.join(' · ') || '—'} />
      </div>

      {/* Buckets */}
      <div>
        <div style={label}>Aging</div>
        <div className="wh-preview-buckets">
          {WH_BUCKET_ORDER.map((b: WhAgingBucket) => (
            <div key={b} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' }}>{b}</div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', marginTop: 2 }}>{fmt(preview.buckets[b])}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sample rows */}
      <div>
        <div style={label}>First {preview.sample.length} rows</div>
        <div className="wh-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date', 'Type', 'Num', isAr ? 'Customer' : 'Vendor', 'Location', 'Due', 'Bucket', 'Open'].map((h, i) => (
                  <th key={i} style={{ padding: '6px 10px', textAlign: i === 7 ? 'right' : 'left', fontSize: 10, color: 'var(--text-dim)', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(r.txnDate)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.txnType}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>{r.num ?? '—'}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)' }}>
                    {r.counterparty}
                    {r.isIntercompany && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-dim)' }}>· internal</span>}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>{r.location ?? '—'}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(r.dueDate)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>{r.agingBucket ?? '—'}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(r.openBalanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Phone: the same rows, stacked */}
        <div className="wh-card-list" style={{ marginTop: 8 }}>
          {preview.sample.map((r, i) => (
            <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ minWidth: 0, fontSize: 12 }}>
                <span style={{ display: 'block', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.counterparty}</span>
                <span style={{ display: 'block', color: 'var(--text-dim)', fontSize: 11 }}>
                  {fmtDate(r.txnDate)} · {r.txnType} · {r.agingBucket ?? '—'}
                </span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(r.openBalanceCents)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 10, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      <div style={{ fontSize: 15, color: 'var(--text-primary)', marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</div>
    </div>
  )
}

// ─── The payroll preview panel ────────────────────────────────────────────────

/**
 * Payroll's own preview. It answers two questions the aging preview never has to: which pay
 * period is this, and is that week already stored? Everything else — the reconciliation
 * headline, the figures, the rows — follows the same shape so the screen reads as one thing.
 */
function PayrollPreviewPanel({ preview }: { preview: WhPayrollImportPreview }) {
  const variance = preview.grossTotalCents - preview.reportTotals.grossCents

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={label}>3 · Check before importing</div>

      {/* Reconciliation — the headline */}
      <div
        style={{
          padding: 12, borderRadius: 10, fontSize: 13,
          background: preview.reconciled ? 'var(--alert-success-bg)' : 'var(--alert-danger-bg)',
          color: preview.reconciled ? 'var(--alert-success-fg)' : 'var(--alert-danger-fg)',
        }}
      >
        {preview.reconciled ? (
          <>✓ The {preview.employeeCount} employee columns add up to the report&rsquo;s own Total of {fmt(preview.reportTotals.grossCents)}.</>
        ) : (
          <>
            ⚠ The employee columns total {fmt(preview.grossTotalCents)}, but the report&rsquo;s Total column says{' '}
            {fmt(preview.reportTotals.grossCents)} — off by {fmt(variance)}. The file was not read correctly and
            cannot be imported.
          </>
        )}
      </div>

      {/* Which period, and whether it is already stored */}
      <div>
        <div style={label}>Pay period</div>
        <div style={{ fontSize: 15, color: 'var(--text-primary)' }}>
          {formatWhPeriod(preview.periodStart, preview.periodEnd)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          Read from the report&rsquo;s own period line — payroll dates are never typed in.
        </div>
        {preview.existingPeriod && (
          <div
            style={{
              marginTop: 10, padding: 10, borderRadius: 8, fontSize: 12,
              background: 'var(--alert-warning-bg, var(--bg-secondary))', color: 'var(--text-secondary)',
            }}
          >
            This period is already stored{preview.existingPeriod.filename ? ` from ${preview.existingPeriod.filename}` : ''} —{' '}
            {preview.existingPeriod.employeeCount} employees, {fmt(preview.existingPeriod.grossTotalCents)} gross.
            Importing replaces those rows. No other period is affected.
          </div>
        )}
      </div>

      {/* Figures */}
      <div className="wh-preview-grid">
        <Stat title="Employees" value={String(preview.employeeCount)} note={preview.inactiveCount > 0 ? `${preview.inactiveCount} marked inactive` : 'All active'} />
        <Stat title="Hours" value={fmtHours(preview.totalHours)} note={preview.checks.hours ? 'Matches the Total column' : 'Does NOT match the Total column'} />
        <Stat title="Gross pay" value={fmt(preview.grossTotalCents)} note={preview.checks.grossCents ? 'Matches the Total column' : 'Does NOT match the Total column'} />
        <Stat title="Employee taxes" value={fmt(preview.taxesTotalCents)} note={preview.checks.taxesCents ? 'Matches the Total column' : 'Does NOT match the Total column'} />
        <Stat title="Adjusted gross" value={fmt(preview.adjustedGrossTotalCents)} note="Gross less pretax deductions" />
        <Stat title="Net pay" value={fmt(preview.netTotalCents)} note={preview.checks.netCents ? "Matches the report's Net pay row" : "Does NOT match the report's Net pay row"} />
      </div>

      {/* Every employee — this is a short list, so all of it is shown */}
      <div>
        <div style={label}>All {preview.employees.length} employees</div>
        <div className="wh-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Employee', 'Hours', 'Gross', 'Taxes', 'Net'].map((h, i) => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: 10, color: 'var(--text-dim)', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.employees.map((e) => (
                <tr key={e.name} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)' }}>
                    {e.name}
                    {!e.isActive && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-dim)' }}>· inactive</span>}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 12, textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtHours(e.hours)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(e.grossCents)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmt(e.taxesCents)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(e.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Phone: the same rows, stacked */}
        <div className="wh-card-list" style={{ marginTop: 8 }}>
          {preview.employees.map((e) => (
            <div key={e.name} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ minWidth: 0, fontSize: 12 }}>
                <span style={{ display: 'block', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.name}{!e.isActive ? ' · inactive' : ''}
                </span>
                <span style={{ display: 'block', color: 'var(--text-dim)', fontSize: 11 }}>
                  {fmtHours(e.hours)} hrs · taxes {fmt(e.taxesCents)}
                </span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmt(e.grossCents)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
