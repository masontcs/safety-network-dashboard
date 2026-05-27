'use client'

import { useState, useEffect, useCallback } from 'react'

interface AgingTotals {
  'Current': number
  '1-30':    number
  '31-60':   number
  '61-90':   number
  '>90':     number
}

interface MeetingKPIs {
  totalAr:                number
  pastDue60Plus:          number
  customersInCollections: number
  highPriorityCount:      number
  totalCollectionAr:      number
  newCustomersCount:      number
  agingTotals:            AgingTotals
  totalCustomers:         number
}

interface ActionItem {
  id: string
  displayName: string
  collectionStatus: string
  customerStatus: string
  priority: number
  totalAr: number
  maxAgingBucket: string
  latestNote: {
    content: string
    createdAt: string
    createdByName: string | null
  } | null
}

interface TopCustomer {
  id: string
  displayName: string
  collectionStatus: string
  totalAr: number
  maxAgingBucket: string
}

interface RecentActivity {
  noteId: string
  customerId: string
  customerName: string
  content: string
  createdAt: string
  createdByName: string | null
}

interface NewCustomer {
  id: string
  displayName: string
  createdAt: string
  totalAr: number
}

interface MeetingData {
  kpis: MeetingKPIs
  actionItems: ActionItem[]
  topCustomers: TopCustomer[]
  recentActivity: RecentActivity[]
  newCustomers: NewCustomer[]
}

interface Props {
  entity: string
  onSelectCustomer: (id: string, name: string) => void
}

const COLLECTION_STATUS_LABELS: Record<string, string> = {
  promise_to_pay: 'Promise to Pay',
  payment_plan:   'Payment Plan',
  legal:          'Legal',
  collections:    'Collections',
  on_hold:        'On Hold',
  dispute:        'Dispute',
  write_off:      'Write Off',
  none:           '',
}

const COLLECTION_STATUS_COLORS: Record<string, string> = {
  promise_to_pay: '#ff6b00',
  payment_plan:   '#ff6b00',
  legal:          '#992222',
  collections:    '#cc4444',
  on_hold:        '#cc9900',
  dispute:        '#cc6600',
  write_off:      'var(--text-faint)',
}

const AGING_COLORS: Record<string, string> = {
  'Current': '#4caf50',
  '1-30':    '#cc9900',
  '31-60':   '#cc6600',
  '61-90':   '#cc4444',
  '>90':     '#992222',
}

const PRIORITY_LABELS: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3' }
const PRIORITY_COLORS: Record<number, string>  = { 1: '#cc4444', 2: '#cc9900', 3: 'var(--text-muted)' }

const AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '>90'] as const

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtShort(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(0) + 'K'
  return fmt(n)
}

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30)  return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function pct(part: number, total: number) {
  if (!total) return '0%'
  return ((part / total) * 100).toFixed(1) + '%'
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent, warn,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
  warn?: boolean
}) {
  const bg    = accent ? '#ff6b00' : 'var(--bg-surface)'
  const muted = accent ? 'rgba(255,255,255,0.7)' : warn ? '#cc6600' : 'var(--text-muted)'
  const subC  = accent ? 'rgba(255,255,255,0.6)' : 'var(--text-dim)'
  return (
    <div style={{ background: bg, border: accent ? 'none' : '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 11, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 500, color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: subC, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ─── Aging bar strip ───────────────────────────────────────────────────────────

function AgingBar({ kpis }: { kpis: MeetingKPIs }) {
  const total = kpis.totalAr || 1
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
        Aging Breakdown — {kpis.totalCustomers} customers
      </div>

      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 12, gap: 1 }}>
        {AGING_BUCKETS.map((b) => {
          const val = kpis.agingTotals[b] ?? 0
          const w   = (val / total) * 100
          return w > 0 ? (
            <div key={b} style={{ width: `${w}%`, background: AGING_COLORS[b], minWidth: 2 }} title={`${b}: ${fmt(val)}`} />
          ) : null
        })}
      </div>

      {/* Legend — flex-wrap so items flow to a second row on narrow screens */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px' }}>
        {AGING_BUCKETS.map((b) => {
          const val = kpis.agingTotals[b] ?? 0
          return (
            <div key={b} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 100, flex: '1 1 100px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: AGING_COLORS[b], flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b} days</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(val)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{pct(val, total)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</div>
      {count !== undefined && (
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{count}</div>
      )}
    </div>
  )
}

// ─── Customer row (shared by action items and top customers) ───────────────────

function CustomerRow({
  id, displayName, collectionStatus, totalAr, maxAgingBucket,
  priority, latestNote, isLast, onSelect,
}: {
  id: string
  displayName: string
  collectionStatus: string
  totalAr: number
  maxAgingBucket: string
  priority?: number
  latestNote?: ActionItem['latestNote']
  isLast: boolean
  onSelect: () => void
}) {
  const statusLabel = COLLECTION_STATUS_LABELS[collectionStatus]
  const statusColor = COLLECTION_STATUS_COLORS[collectionStatus]

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '13px 16px',
        borderBottom: isLast ? 'none' : '1px solid #222',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#242424')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      {/* Row 1: priority + name + amount */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {priority !== undefined && (
          <span style={{
            fontSize: 10, fontWeight: 600,
            color: PRIORITY_COLORS[priority] ?? 'var(--text-muted)',
            background: `${PRIORITY_COLORS[priority] ?? 'var(--text-muted)'}22`,
            borderRadius: 4, padding: '2px 6px',
            minWidth: 28, textAlign: 'center', flexShrink: 0,
          }}>
            {PRIORITY_LABELS[priority] ?? 'P?'}
          </span>
        )}

        <span style={{ fontSize: 13, fontWeight: 500, color: '#ff6b00', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {displayName}
        </span>

        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {fmt(totalAr)}
        </span>
      </div>

      {/* Row 2: status badge + aging bucket */}
      <div style={{ paddingLeft: priority !== undefined ? 36 : 0, display: 'flex', alignItems: 'center', gap: 8, marginBottom: latestNote !== undefined ? 4 : 0 }}>
        {statusLabel && (
          <span style={{
            fontSize: 10, color: statusColor,
            background: `${statusColor}22`,
            borderRadius: 4, padding: '2px 8px', flexShrink: 0,
          }}>
            {statusLabel}
          </span>
        )}
        <span style={{ fontSize: 10, color: AGING_COLORS[maxAgingBucket] ?? 'var(--text-muted)', flexShrink: 0 }}>
          {maxAgingBucket}
        </span>
      </div>

      {/* Row 3: latest note (action items only) */}
      {latestNote !== undefined && (
        latestNote ? (
          <div style={{ paddingLeft: priority !== undefined ? 36 : 0, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', marginTop: 1 }}>
              {latestNote.createdByName ?? 'Unknown'} · {timeAgo(latestNote.createdAt)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {latestNote.content}
            </div>
          </div>
        ) : (
          <div style={{ paddingLeft: priority !== undefined ? 36 : 0, fontSize: 11, color: '#3a3a3a', fontStyle: 'italic' }}>
            No notes yet
          </div>
        )
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function ArMeetingDashboard({ entity, onSelectCustomer }: Props) {
  const [data, setData]       = useState<MeetingData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (entity) p.set('entity', entity)
    const res = await fetch(`/api/ar/meeting?${p}`)
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [entity])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--text-faint)', fontSize: 13 }}>
        Loading meeting data…
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--text-faint)', fontSize: 13 }}>
        Failed to load data.
      </div>
    )
  }

  const { kpis, actionItems, topCustomers, recentActivity, newCustomers } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPI row */}
      <div className="dash-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard
          label="Total AR"
          value={fmtShort(kpis.totalAr)}
          sub={`${kpis.totalCustomers} customers`}
          accent
        />
        <KpiCard
          label="60+ Days Past Due"
          value={fmtShort(kpis.pastDue60Plus)}
          sub={`${pct(kpis.pastDue60Plus, kpis.totalAr)} of total AR`}
          warn
        />
        <KpiCard
          label="In Collections"
          value={kpis.customersInCollections}
          sub={kpis.highPriorityCount > 0 ? `${kpis.highPriorityCount} high priority (P1)` : 'No active collections'}
        />
        <KpiCard
          label="New Customers (30d)"
          value={kpis.newCustomersCount}
          sub={newCustomers.length > 0 ? fmt(newCustomers.reduce((s, c) => s + c.totalAr, 0)) + ' total AR' : 'None this period'}
        />
      </div>

      {/* Aging bar */}
      <AgingBar kpis={kpis} />

      {/* Main grid */}
      <div className="ar-meeting-grid">

        {/* Left: Action items (if any) or Top Customers */}
        <div>
          {actionItems.length > 0 ? (
            <>
              <SectionHeader title="Action Items" count={actionItems.length} />
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                {actionItems.map((item, idx) => (
                  <CustomerRow
                    key={item.id}
                    id={item.id}
                    displayName={item.displayName}
                    collectionStatus={item.collectionStatus}
                    totalAr={item.totalAr}
                    maxAgingBucket={item.maxAgingBucket}
                    priority={item.priority}
                    latestNote={item.latestNote}
                    isLast={idx === actionItems.length - 1}
                    onSelect={() => onSelectCustomer(item.id, item.displayName)}
                  />
                ))}
              </div>
            </>
          ) : null}

          <SectionHeader
            title={actionItems.length > 0 ? 'All Customers by Balance' : 'Top Customers by Balance'}
            count={topCustomers.length}
          />
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {topCustomers.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                No AR data yet. Import a file to get started.
              </div>
            ) : (
              topCustomers.map((cust, idx) => (
                <CustomerRow
                  key={cust.id}
                  id={cust.id}
                  displayName={cust.displayName}
                  collectionStatus={cust.collectionStatus}
                  totalAr={cust.totalAr}
                  maxAgingBucket={cust.maxAgingBucket}
                  isLast={idx === topCustomers.length - 1}
                  onSelect={() => onSelectCustomer(cust.id, cust.displayName)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: Recent activity + New customers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, overflow: 'hidden' }}>

          {/* Recent activity */}
          <div>
            <SectionHeader title="Recent Activity" />
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {recentActivity.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No recent notes.</div>
              ) : (
                recentActivity.map((act, idx) => (
                  <div
                    key={act.noteId}
                    onClick={() => onSelectCustomer(act.customerId, act.customerName)}
                    style={{
                      padding: '12px 14px',
                      borderBottom: idx < recentActivity.length - 1 ? '1px solid #222' : 'none',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#242424')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#ff6b00' }}>{act.customerName}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{timeAgo(act.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#aaa', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {act.content}
                    </div>
                    {act.createdByName && (
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{act.createdByName}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* New customers */}
          {newCustomers.length > 0 && (
            <div>
              <SectionHeader title="New Customers (30d)" count={newCustomers.length} />
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {newCustomers.map((cust, idx) => (
                  <div
                    key={cust.id}
                    onClick={() => onSelectCustomer(cust.id, cust.displayName)}
                    style={{
                      padding: '11px 14px',
                      borderBottom: idx < newCustomers.length - 1 ? '1px solid #222' : 'none',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#242424')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: '#ff6b00' }}>{cust.displayName}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{fmtDate(cust.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: 12, color: cust.totalAr > 0 ? 'var(--text-primary)' : 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                      {cust.totalAr > 0 ? fmt(cust.totalAr) : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
