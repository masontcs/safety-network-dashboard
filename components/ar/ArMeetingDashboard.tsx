'use client'

import { useState, useEffect, useCallback } from 'react'

interface MeetingKPIs {
  customersInCollections: number
  highPriorityCount: number
  totalCollectionAr: number
  newCustomersCount: number
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
  legal:          'Legal Action',
  collections:    'Collections',
  on_hold:        'On Hold',
  dispute:        'Dispute',
  write_off:      'Write Off',
  none:           'None',
}

const COLLECTION_STATUS_COLORS: Record<string, string> = {
  promise_to_pay: '#ff6b00',
  payment_plan:   '#ff6b00',
  legal:          '#992222',
  collections:    '#cc4444',
  on_hold:        '#cc9900',
  dispute:        '#cc6600',
  write_off:      '#555',
  none:           '#555',
}

const AGING_COLORS: Record<string, string> = {
  'Current': '#4caf50',
  '1-30':    '#cc9900',
  '31-60':   '#cc6600',
  '61-90':   '#cc4444',
  '>90':     '#992222',
}

const PRIORITY_LABELS: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3' }
const PRIORITY_COLORS: Record<number, string>  = { 1: '#cc4444', 2: '#cc9900', 3: '#888' }

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
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

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
}) {
  return (
    <div style={{
      background: accent ? '#ff6b00' : '#1e1e1e',
      border: accent ? 'none' : '1px solid #2a2a2a',
      borderRadius: 12, padding: 20,
    }}>
      <div style={{ fontSize: 11, color: accent ? 'rgba(255,255,255,0.7)' : '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 500, color: '#fff' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: accent ? 'rgba(255,255,255,0.6)' : '#666', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>{title}</div>
      {count !== undefined && (
        <div style={{ fontSize: 11, color: '#555' }}>{count}</div>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: '#555', fontSize: 13 }}>
        Loading meeting data…
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: '#555', fontSize: 13 }}>
        Failed to load data.
      </div>
    )
  }

  const { kpis, actionItems, recentActivity, newCustomers } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard
          label="Total Collection AR"
          value={fmt(kpis.totalCollectionAr)}
          sub={`${kpis.customersInCollections} customer${kpis.customersInCollections !== 1 ? 's' : ''}`}
          accent
        />
        <KpiCard
          label="High Priority (P1)"
          value={kpis.highPriorityCount}
          sub="Promise, Plan, Legal, Collections"
        />
        <KpiCard
          label="In Collections Total"
          value={kpis.customersInCollections}
          sub="Active collection status"
        />
        <KpiCard
          label="New Customers (30d)"
          value={kpis.newCustomersCount}
          sub="Added in last 30 days"
        />
      </div>

      {/* Main grid: action items + right column */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>

        {/* Action items */}
        <div>
          <SectionHeader title="Action Items" count={actionItems.length} />
          <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
            {actionItems.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>
                No customers in collections. Clear board!
              </div>
            ) : (
              actionItems.map((item, idx) => (
                <div
                  key={item.id}
                  onClick={() => onSelectCustomer(item.id, item.displayName)}
                  style={{
                    padding: '14px 16px',
                    borderBottom: idx < actionItems.length - 1 ? '1px solid #222' : 'none',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#242424')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  {/* Row 1: priority badge + customer name + aging + AR */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: item.latestNote ? 8 : 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      color: PRIORITY_COLORS[item.priority] ?? '#888',
                      background: `${PRIORITY_COLORS[item.priority] ?? '#888'}22`,
                      borderRadius: 4, padding: '2px 6px',
                      minWidth: 28, textAlign: 'center',
                    }}>
                      {PRIORITY_LABELS[item.priority] ?? 'P?'}
                    </span>

                    <span style={{ fontSize: 13, fontWeight: 500, color: '#ff6b00', flex: 1 }}>
                      {item.displayName}
                    </span>

                    <span style={{
                      fontSize: 10,
                      color: COLLECTION_STATUS_COLORS[item.collectionStatus] ?? '#888',
                      background: `${COLLECTION_STATUS_COLORS[item.collectionStatus] ?? '#888'}22`,
                      borderRadius: 4, padding: '2px 8px',
                    }}>
                      {COLLECTION_STATUS_LABELS[item.collectionStatus] ?? item.collectionStatus}
                    </span>

                    <span style={{
                      fontSize: 10,
                      color: AGING_COLORS[item.maxAgingBucket] ?? '#888',
                    }}>
                      {item.maxAgingBucket}
                    </span>

                    <span style={{ fontSize: 13, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(item.totalAr)}
                    </span>
                  </div>

                  {/* Row 2: latest note */}
                  {item.latestNote && (
                    <div style={{ paddingLeft: 38, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap', marginTop: 1 }}>
                        {item.latestNote.createdByName ?? 'Unknown'} · {timeAgo(item.latestNote.createdAt)}
                      </div>
                      <div style={{
                        fontSize: 12, color: '#aaa',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        flex: 1,
                      }}>
                        {item.latestNote.content}
                      </div>
                    </div>
                  )}
                  {!item.latestNote && (
                    <div style={{ paddingLeft: 38, fontSize: 11, color: '#444', fontStyle: 'italic' }}>
                      No notes yet
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right column: Recent activity + New customers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Recent activity */}
          <div>
            <SectionHeader title="Recent Activity" />
            <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
              {recentActivity.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#555', fontSize: 12 }}>No recent notes.</div>
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
                      <span style={{ fontSize: 10, color: '#555' }}>{timeAgo(act.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {act.content}
                    </div>
                    {act.createdByName && (
                      <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{act.createdByName}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* New customers */}
          <div>
            <SectionHeader title="New Customers (30d)" count={newCustomers.length} />
            <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
              {newCustomers.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#555', fontSize: 12 }}>No new customers this month.</div>
              ) : (
                newCustomers.map((cust, idx) => (
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
                      <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{fmtDate(cust.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: 12, color: cust.totalAr > 0 ? '#fff' : '#444', fontVariantNumeric: 'tabular-nums' }}>
                      {cust.totalAr > 0 ? fmt(cust.totalAr) : '—'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
