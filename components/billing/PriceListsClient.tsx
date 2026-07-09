'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Skeleton from '@/components/ui/Skeleton'

interface PriceListRow {
  id: string
  name: string
  entityId: string
  entityCode: string
  isActive: boolean
  tierCount: number
  itemCount: number
  inUseByProfiles: number
}
interface Entity { entityId: string; code: string; name: string }

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)',
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6,
  padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
}

export default function PriceListsClient({ isAdmin }: { isAdmin: boolean }) {
  const [lists, setLists] = useState<PriceListRow[]>([])
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [showNew, setShowNew] = useState(false)
  const [nName, setNName] = useState('')
  const [nEntity, setNEntity] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/billing/price-lists').then((r) => r.json()),
      // entity list comes from any profile's entity-config shape; reuse reference for branches/terms
      fetch('/api/billing/entities').then((r) => r.json()).catch(() => ({ success: true, data: [] })),
    ])
      .then(([pl, ent]) => {
        if (!pl.success) throw new Error(pl.error)
        setLists(pl.data)
        if (ent.success) setEntities(ent.data)
        setFetchError(null)
      })
      .catch((e: Error) => setFetchError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function create() {
    if (busy || !nName.trim() || !nEntity) return
    setBusy(true); setActionError(null)
    try {
      const res = await fetch('/api/billing/price-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nName, entityId: nEntity }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setNName(''); setNEntity(''); setShowNew(false); load()
    } catch { setActionError('Network error — please try again.') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Price Lists</div>
        {isAdmin && (
          <button onClick={() => setShowNew((v) => !v)} className="btn-primary" style={{ marginLeft: 'auto', padding: '8px 16px' }}>
            + New price list
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -12 }}>
        Each list belongs to one entity. New lists start with tiers T1–T4 (base, then 10% / 10% / 5% off the previous tier).
      </div>

      {actionError && (
        <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6 }}>{actionError}</div>
      )}

      {showNew && isAdmin && (
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16, color: 'var(--text-primary)' }}>New price list</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label style={labelStyle}>Name</label>
              <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="2025 Private Rates" style={inputStyle} />
            </div>
            <div style={{ minWidth: 180 }}>
              <label style={labelStyle}>Entity</label>
              <select value={nEntity} onChange={(e) => setNEntity(e.target.value)} style={inputStyle}>
                <option value="">Select…</option>
                {entities.map((e) => <option key={e.entityId} value={e.entityId}>{e.code}</option>)}
              </select>
            </div>
            <button onClick={create} disabled={busy || !nName.trim() || !nEntity} className="btn-primary"
              style={{ padding: '8px 18px', opacity: busy || !nName.trim() || !nEntity ? 0.5 : 1 }}>Create</button>
            <button onClick={() => setShowNew(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        {fetchError ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={42} />)}</div>
        ) : lists.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 2px' }}>No price lists yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Name', 'Entity', 'Tiers', 'Items', 'Used by'].map((h) => (
                  <th key={h} style={{ ...thStyle, textAlign: ['Tiers', 'Items', 'Used by'].includes(h) ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lists.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>
                    <Link href={`/billing/price-lists/${p.id}`} style={{ color: 'var(--accent)', fontWeight: 500, textDecoration: 'none' }}>{p.name}</Link>
                  </td>
                  <td style={tdStyle}>{p.entityCode}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.tierCount}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.itemCount}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: p.inUseByProfiles ? 'var(--text-primary)' : 'var(--text-dim)' }}>
                    {p.inUseByProfiles || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
