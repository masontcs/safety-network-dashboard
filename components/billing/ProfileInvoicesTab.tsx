'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Skeleton from '@/components/ui/Skeleton'
import { rowOpen } from '@/components/billing/rowOpen'

/** The invoices belonging to a billing profile — a tab on the profile detail page. */

interface InvoiceRow {
  id: string
  invoiceNumber: string
  invoiceDate: string
  status: string
  totalCents: number
  jobNumber: string | null
}

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)',
}
const money = (c: number) => `$${(c / 100).toFixed(2)}`

export default function ProfileInvoicesTab({ profileId }: { profileId: string }) {
  const router = useRouter()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/billing/invoices?profileId=${profileId}`)
      .then((r) => r.json())
      .then((json) => { if (!json.success) throw new Error(json.error); setInvoices(json.data); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [profileId])

  if (error) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {error}</div>
  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={40} />)}</div>

  return (
    <div className="card">
      {invoices.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 2px' }}>
          No invoices yet. Invoices for this profile will appear here once they&apos;re generated.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Invoice #', 'Job', 'Date', 'Status', 'Total'].map((h) => <th key={h} style={{ ...th, textAlign: h === 'Total' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} {...rowOpen(() => router.push(`/billing/invoices/${inv.id}`))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, fontWeight: 500, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{inv.invoiceNumber}</td>
                  <td style={{ ...td, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{inv.jobNumber ?? '—'}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{inv.invoiceDate}</td>
                  <td style={{ ...td, textTransform: 'capitalize' }}>{inv.status.replace('_', ' ')}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(inv.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
