'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Skeleton from '@/components/ui/Skeleton'

/** Photo attachments for a ticket — a tab on the ticket detail page. */

interface Photo {
  id: string
  fileName: string
  contentType: string | null
  sizeBytes: number | null
  createdAt: string
  url: string | null
}

const ghost: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6,
  padding: '7px 14px', fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
}

export default function TicketPhotosTab({ ticketId, canEdit }: { ticketId: string; canEdit: boolean }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/billing/tickets/${ticketId}/photos`)
      .then((r) => r.json())
      .then((json) => { if (!json.success) throw new Error(json.error); setPhotos(json.data); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticketId])

  useEffect(() => { load() }, [load])

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true); setMsg(null)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/api/billing/tickets/${ticketId}/photos`, { method: 'POST', body: fd })
        const json = await res.json()
        if (!json.success) { setMsg(json.error); break }
      }
      load()
    } catch { setMsg('Upload failed — please try again.') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function remove(id: string) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/billing/tickets/${ticketId}/photos?photoId=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) setMsg(json.error); else load()
    } catch { setMsg('Delete failed — please try again.') }
    finally { setBusy(false) }
  }

  return (
    <div className="card">
      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary" style={{ padding: '8px 16px', opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Uploading…' : '+ Add photos'}
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Images up to 15 MB.</span>
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6, marginBottom: 14 }}>{msg}</div>}

      {error ? (
        <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {error}</div>
      ) : loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={150} />)}</div>
      ) : photos.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 2px' }}>
          No photos yet.{canEdit ? ' Add photos of the job site, equipment, or signed tickets.' : ''}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {photos.map((p) => (
            <div key={p.id} style={{ position: 'relative', border: '1px solid var(--border-subtle, var(--border-emphasis))', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
              <button
                onClick={() => p.url && window.open(p.url, '_blank', 'noopener')}
                title={p.fileName}
                style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', padding: 0, border: 0, cursor: p.url ? 'zoom-in' : 'default', background: 'var(--bg-tertiary)' }}
              >
                {p.url
                  ? <img src={p.url} alt={p.fileName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>unavailable</span>}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={p.fileName}>{p.fileName}</span>
                {canEdit && (
                  <button onClick={() => remove(p.id)} disabled={busy} title="Delete photo"
                    style={{ ...ghost, padding: '2px 7px', fontSize: 12, lineHeight: 1.2 }}>✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
