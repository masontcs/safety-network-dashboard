'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBranch } from '@/components/billing/BranchContext'

/**
 * Billing home — the concept dashboard, over live aggregates from /api/billing/dashboard.
 * Read-only: it never writes, just surfaces where the business stands right now.
 */

interface Dash {
  billedThisMonthCents: number; billedDeltaPct: number | null
  onRentUnits: number; onRentJobCount: number
  readyJobCount: number; overdueCents: number; overdueCount: number
  billingByMonth: { month: string; cents: number }[]
  needsAttention: { pickupsMissingBillingType: number; ticketsInReview: number }
  onRentByJob: { job: string; items: string[] }[]
}

const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function DashboardClient() {
  const [d, setD] = useState<Dash | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()
  const { query } = useBranch()

  useEffect(() => {
    setD(null)
    fetch('/api/billing/dashboard' + query).then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setD(j.data) })
      .catch((e: Error) => setErr(e.message))
  }, [query])

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  if (err) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load dashboard: {err}</div>

  const maxBar = d ? Math.max(1, ...d.billingByMonth.map((m) => m.cents)) : 1
  const kpi = (lbl: string, val: string, delta: string, deltaCls: string, barPct: number, barColor: string, onClick: () => void) => (
    <div className="kpi" onClick={onClick}>
      <div className="lbl">{lbl}</div>
      <div className="val">{d ? val : '—'}</div>
      <div className="delta" style={{ color: deltaCls }}>{d ? delta : ' '}</div>
      <div className="kbar"><i style={{ width: `${barPct}%`, background: barColor }} /></div>
    </div>
  )

  return (
    <div>
      <h1 className="bx-h1">Good morning, Mason</h1>
      <div className="bx-sub">{today} · here&apos;s where the business stands today.</div>

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {kpi('Billed this month', d ? money(d.billedThisMonthCents) : '—',
          d?.billedDeltaPct != null ? `${d.billedDeltaPct >= 0 ? '▲' : '▼'} ${Math.abs(d.billedDeltaPct)}% vs last month` : 'first billing',
          d && d.billedDeltaPct != null && d.billedDeltaPct < 0 ? 'var(--danger)' : 'var(--accent)', 64, 'var(--accent)', () => router.push('/billing/invoices'))}
        {kpi('On rent now', d ? d.onRentUnits.toLocaleString() : '—',
          d ? `units · ${d.onRentJobCount} job${d.onRentJobCount === 1 ? '' : 's'}` : ' ', 'var(--muted)', 78, 'var(--brand)', () => router.push('/billing/jobs'))}
        {kpi('Ready to invoice', d ? String(d.readyJobCount) : '—',
          d ? `job${d.readyJobCount === 1 ? '' : 's'} final-edited` : ' ', 'var(--accent)', 40, 'var(--accent)', () => router.push('/billing/jobs'))}
        {kpi('Overdue A/R', d ? money(d.overdueCents) : '—',
          d ? `${d.overdueCount} invoice${d.overdueCount === 1 ? '' : 's'} past due` : ' ', 'var(--danger)', 24, 'var(--danger)', () => router.push('/billing/invoices'))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="bx-cardhead"><h3>Billing · last 6 months</h3></div>
          <div className="bx-chart">
            {(d?.billingByMonth ?? []).map((m, i) => (
              <div className="col" key={i}>
                <i style={{ height: `${Math.round((m.cents / maxBar) * 100)}%` }} title={money(m.cents)} />
                <small>{m.month}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="bx-cardhead"><h3>Needs attention</h3></div>
          {d && (d.needsAttention.pickupsMissingBillingType > 0 || d.needsAttention.ticketsInReview > 0) ? (
            <div>
              {d.needsAttention.pickupsMissingBillingType > 0 && (
                <span className="chip">⚠ <b>{d.needsAttention.pickupsMissingBillingType}</b> pickups need a billing type</span>
              )}
              {d.needsAttention.ticketsInReview > 0 && (
                <span className="chip" onClick={() => router.push('/billing/tickets')} style={{ cursor: 'pointer' }}>● <b>{d.needsAttention.ticketsInReview}</b> tickets in review</span>
              )}
            </div>
          ) : <div className="bx-empty">All caught up — nothing needs attention.</div>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="bx-cardhead"><h3>Equipment on rent by job</h3><button className="bx-link" onClick={() => router.push('/billing/jobs')}>All jobs →</button></div>
        {d && d.onRentByJob.length > 0 ? (
          <div>{d.onRentByJob.map((r, i) => (
            <span className="chip" key={i}>{r.job.length > 40 ? r.job.slice(0, 40) + '…' : r.job} — {r.items.join(' · ') || 'nothing out'}</span>
          ))}</div>
        ) : <div className="bx-empty">Nothing on rent right now.</div>}
      </div>
    </div>
  )
}
