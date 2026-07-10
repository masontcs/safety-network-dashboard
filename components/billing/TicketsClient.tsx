'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Skeleton from '@/components/ui/Skeleton'
import Select from '@/components/billing/Select'
import { rowOpen } from '@/components/billing/rowOpen'

/**
 * Global tickets list — across all jobs. Create happens from a job (see the
 * job detail page), so this view is search + status triage.
 */

interface TicketRow {
  id: string
  ticketNumber: string
  date: string
  status: string
  recurring: boolean
  features: string[]
  job: { id: string; number: string; name: string | null } | null
  customer: string | null
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)' }

export default function TicketsClient() {
  const router = useRouter()
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/billing/tickets')
      .then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setTickets(j.data); setErr(null) })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tickets.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false
      if (!q) return true
      return t.ticketNumber.toLowerCase().includes(q) ||
        (t.customer ?? '').toLowerCase().includes(q) ||
        (t.job?.number ?? '').toLowerCase().includes(q) ||
        (t.job?.name ?? '').toLowerCase().includes(q)
    })
  }, [tickets, search, statusFilter])

  const statusColors: Record<string, string> = { active: 'var(--pill-neutral-fg)', in_review: 'var(--pill-pending-fg)', final_edit: 'var(--pill-paid-fg)', invoiced: 'var(--accent)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Tickets</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -12 }}>New tickets are created from a job. This view is for search and triage.</div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets, jobs, customers…" style={{ ...inputStyle, maxWidth: 320 }} />
          <div style={{ width: 160 }}>
            <Select ariaLabel="Status filter" value={statusFilter} onChange={setStatusFilter}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="in_review">In review</option>
              <option value="final_edit">Final edit</option>
              <option value="invoiced">Invoiced</option>
            </Select>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{filtered.length} of {tickets.length}</span>
        </div>

        {err ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {err}</div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={42} />)}</div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 2px' }}>{tickets.length === 0 ? 'No tickets yet.' : 'No tickets match.'}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Ticket #', 'Date', 'Job', 'Customer', 'Features', 'Status'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} {...rowOpen(() => router.push(`/billing/tickets/${t.id}`))} style={{ cursor: 'pointer' }}>
                    <td style={td}>
                      <Link href={`/billing/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)', fontWeight: 500, textDecoration: 'none', fontVariantNumeric: 'tabular-nums' }}>{t.ticketNumber}</Link>
                      {t.recurring && <span title="Equipment still out" style={{ marginLeft: 6, fontSize: 9.5, color: 'var(--pill-pending-fg)' }}>REC</span>}
                    </td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{t.date}</td>
                    <td style={td}>{t.job ? <Link href={`/billing/jobs/${t.job.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{t.job.number}</Link> : '—'}</td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>{t.customer ?? '—'}</td>
                    <td style={{ ...td, color: 'var(--text-secondary)' }}>{t.features.join(' + ') || '—'}</td>
                    <td style={{ ...td, fontSize: 11, fontWeight: 600, color: statusColors[t.status], textTransform: 'capitalize' }}>{t.status.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
