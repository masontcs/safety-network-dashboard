'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Skeleton from '@/components/ui/Skeleton'
import { rowOpen } from '@/components/billing/rowOpen'

/** The jobs belonging to a billing profile — a tab on the profile detail page. */

interface JobRow {
  id: string
  jobNumber: string
  name: string | null
  status: string
  entityCode: string
  branch: string
  customer: string | null
}

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)',
}

export default function ProfileJobsTab({ profileId }: { profileId: string }) {
  const router = useRouter()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/billing/jobs?profileId=${profileId}`)
      .then((r) => r.json())
      .then((json) => { if (!json.success) throw new Error(json.error); setJobs(json.data); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [profileId])

  if (error) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {error}</div>
  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={40} />)}</div>

  return (
    <div className="card">
      {jobs.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 2px' }}>No jobs for this profile yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Job #', 'Name', 'Entity', 'Branch', 'Status'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} {...rowOpen(() => router.push(`/billing/jobs/${j.id}`))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, fontWeight: 500, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{j.jobNumber}</td>
                  <td style={td}>{j.name ?? '—'}</td>
                  <td style={td}>{j.entityCode}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{j.branch}</td>
                  <td style={{ ...td, textTransform: 'capitalize' }}>{j.status.replace('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
