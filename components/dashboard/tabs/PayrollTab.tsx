'use client'

import MetricCard from '@/components/ui/MetricCard'
import { formatCurrency } from '@/lib/utils/format'
import type { TabProps } from './types'

export default function PayrollTab({ role, data, branches, allocationOn }: TabProps) {
  const pay = data.payroll
  if (!pay) {
    return <div style={{ color: '#888888', fontSize: 13, padding: 24 }}>No payroll data for this period.</div>
  }

  const isAdminOrExec = role === 'admin' || role === 'executive'
  const branchNameMap: Record<string, string> = {}
  for (const b of branches) branchNameMap[b.id] = b.name

  const overviewTotals = data.overview?.totals
  const corpOverhead = allocationOn && isAdminOrExec ? (overviewTotals?.corpOverhead ?? 0) : 0
  const hqOverhead = allocationOn && isAdminOrExec ? (overviewTotals?.hqOverhead ?? 0) : 0

  const directTotal = pay.total.direct
  const adminTotal = pay.total.admin
  const taxesTotal = pay.total.taxes
  const totalPayroll = directTotal + adminTotal + taxesTotal + corpOverhead + hqOverhead

  const maxTotal = Math.max(
    ...pay.byWeek.map((w) => w.direct + w.admin + w.taxes),
    1
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── KPI row ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MetricCard label='Direct Labor' value={formatCurrency(directTotal)} />
        <MetricCard label='Admin Payroll' value={formatCurrency(adminTotal)} />
        <MetricCard label='Employer Taxes' value={formatCurrency(taxesTotal)} />
        <MetricCard
          label='Total Payroll'
          sub={allocationOn && isAdminOrExec ? 'Incl. Corp/HQ' : undefined}
          value={formatCurrency(totalPayroll)}
        />
      </div>

      {/* Corp/HQ payroll breakdown when allocation is on */}
      {allocationOn && isAdminOrExec && (corpOverhead > 0 || hqOverhead > 0) && (
        <div style={{
          background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: '12px 16px',
          display: 'flex', gap: 32, alignItems: 'center',
        }}>
          <div style={{ fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Corp/HQ Overhead</div>
          <Item label='Corp Payroll' value={formatCurrency(corpOverhead)} />
          <Item label='HQ Payroll (SN share)' value={formatCurrency(hqOverhead)} />
        </div>
      )}

      {/* ── Weekly stacked bar ────────────────────────────────────────────────── */}
      {pay.byWeek.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Weekly Payroll</div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, minWidth: pay.byWeek.length * 60 }}>
              {pay.byWeek.map((w) => {
                const total = w.direct + w.admin + w.taxes
                const dirH = (w.direct / maxTotal) * 100
                const admH = (w.admin / maxTotal) * 100
                const taxH = (w.taxes / maxTotal) * 100
                const d = new Date(w.periodDate + 'T00:00:00')
                const label = `${d.getMonth() + 1}/${d.getDate()}`
                return (
                  <div key={w.periodDate} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 40 }}>
                    <div title={`Total: ${formatCurrency(total)}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 100, width: '80%' }}>
                      <div style={{ width: '100%', height: `${taxH}%`, background: '#555555', borderRadius: 0 }} title={`Taxes: ${formatCurrency(w.taxes)}`} />
                      <div style={{ width: '100%', height: `${admH}%`, background: '#888888', borderRadius: 0 }} title={`Admin: ${formatCurrency(w.admin)}`} />
                      <div style={{ width: '100%', height: `${dirH}%`, background: '#ff6b00', borderRadius: '2px 2px 0 0' }} title={`Direct: ${formatCurrency(w.direct)}`} />
                    </div>
                    <div style={{ fontSize: 9, color: '#555555', marginTop: 4 }}>{label}</div>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <LegendDot color='#ff6b00' label='Direct Labor' />
            <LegendDot color='#888888' label='Admin Payroll' />
            <LegendDot color='#555555' label='Taxes' />
          </div>
        </div>
      )}

      {/* ── Employee detail table — admin/exec see full rows, managers see summary ─ */}
      {isAdminOrExec && pay.total.directDetail && pay.total.directDetail.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Direct Labor Detail</div>
          <EmployeeTable rows={pay.total.directDetail} branchNameMap={branchNameMap} />
        </div>
      )}

      {/* Admin payroll detail — admin/exec only */}
      {isAdminOrExec && pay.total.adminDetail && pay.total.adminDetail.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Admin Payroll Detail</div>
          <EmployeeTable rows={pay.total.adminDetail} branchNameMap={branchNameMap} />
        </div>
      )}

      {/* Managers: direct labor detail only */}
      {!isAdminOrExec && pay.total.directDetail && pay.total.directDetail.length > 0 && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 12 }}>Direct Labor</div>
          <EmployeeTable rows={pay.total.directDetail} branchNameMap={branchNameMap} />
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888888' }}>Admin Payroll</span>
            <span style={{ fontSize: 14, color: '#ffffff', fontWeight: 500 }}>{formatCurrency(adminTotal)}</span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888888' }}>Employer Taxes</span>
            <span style={{ fontSize: 14, color: '#ffffff', fontWeight: 500 }}>{formatCurrency(taxesTotal)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 14, color: '#ffffff', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 10, color: '#888888' }}>{label}</span>
    </div>
  )
}

type EmpRow = { employeeId: string; displayName: string; laborType: string; amount: number; hours: number | null; rate: number | null; branchId?: string | null }

function EmployeeTable({ rows, branchNameMap }: { rows: EmpRow[]; branchNameMap: Record<string, string> }) {
  const sorted = [...rows].sort((a, b) => b.amount - a.amount)
  const total = rows.reduce((s, r) => s + r.amount, 0)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Employee</th>
            <th style={th}>Branch</th>
            <th style={th}>Hours</th>
            <th style={th}>Rate</th>
            <th style={th}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={`${r.employeeId}-${i}`} style={{ borderBottom: '1px solid #2a2a2a' }}>
              <td style={{ ...td, textAlign: 'left', color: '#cccccc' }}>{r.displayName}</td>
              <td style={{ ...td, color: '#888888' }}>{r.branchId ? (branchNameMap[r.branchId] ?? '—') : '—'}</td>
              <td style={td}>{r.hours !== null ? r.hours.toFixed(2) : '—'}</td>
              <td style={td}>{r.rate !== null ? formatCurrency(r.rate) : '—'}</td>
              <td style={{ ...td, color: '#ffffff' }}>{formatCurrency(r.amount)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid #333333' }}>
            <td colSpan={4} style={{ ...td, textAlign: 'left', color: '#888888' }}>Total</td>
            <td style={{ ...td, color: '#ff6b00', fontWeight: 500 }}>{formatCurrency(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: '#666666', fontWeight: 400 }
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', color: '#cccccc' }
