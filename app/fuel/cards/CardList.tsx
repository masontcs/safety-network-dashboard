'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Role } from '@/lib/supabase/database.types'

interface FuelCard {
  id: string
  cardName: string
  vendor: string
  employeeId: string | null
  employeeDisplayName: string | null
  branchId: string | null
  branchName: string | null
  businessTag: string | null
  isConfirmed: boolean
}

type FilterTab = 'all' | 'linked' | 'general' | 'unlinked' | 'business'

function cardStatus(c: FuelCard): FilterTab {
  if (!c.isConfirmed) return 'unlinked'
  if (c.businessTag) return 'business'
  if (c.employeeId) return 'linked'
  return 'general'
}

interface Props {
  role: Role
}

export default function CardList({ role: _role }: Props) {
  const router = useRouter()
  const [cards, setCards] = useState<FuelCard[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/fuel/cards')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setCards(json.data)
      })
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let list = cards
    if (filter !== 'all') list = list.filter((c) => cardStatus(c) === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((c) => c.cardName.toLowerCase().includes(q))
    }
    return list
  }, [cards, filter, search])

  const counts = useMemo(() => ({
    all: cards.length,
    linked: cards.filter((c) => cardStatus(c) === 'linked').length,
    general: cards.filter((c) => cardStatus(c) === 'general').length,
    unlinked: cards.filter((c) => cardStatus(c) === 'unlinked').length,
    business: cards.filter((c) => cardStatus(c) === 'business').length,
  }), [cards])

  const tabs: Array<{ key: FilterTab; label: string }> = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'linked', label: `Linked (${counts.linked})` },
    { key: 'general', label: `General (${counts.general})` },
    { key: 'unlinked', label: `Unlinked (${counts.unlinked})` },
    { key: 'business', label: `WH/Signs (${counts.business})` },
  ]

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button onClick={() => router.push('/fuel')} style={navPillStyle(false)}>Dashboard</button>
        <button style={navPillStyle(true)}>Cards</button>
      </div>

      {/* Filter tabs + search */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setFilter(t.key)} style={filterTabStyle(filter === t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search card name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            marginLeft: 'auto',
            background: '#2a2a2a',
            border: '1px solid #333333',
            borderRadius: 8,
            padding: '5px 12px',
            fontSize: 12,
            color: '#cccccc',
            outline: 'none',
            width: 200,
          }}
        />
      </div>

      {/* Table */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
              {['Card Name', 'Vendor', 'Assignment', 'Branch', 'Status'].map((h) => (
                <th key={h} style={{ textAlign: 'left', fontSize: 11, color: '#666666', fontWeight: 400, padding: '10px 12px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#555555', fontSize: 12 }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#555555', fontSize: 12 }}>No cards found</td></tr>
            ) : filtered.map((c) => {
              const status = cardStatus(c)
              return (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/fuel/cards/${c.id}`)}
                  style={{ borderTop: '1px solid #2a2a2a', cursor: 'pointer', transition: 'background 100ms' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#252525')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#cccccc', fontWeight: 500 }}>{c.cardName}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#888888', textTransform: 'capitalize' }}>{c.vendor}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#cccccc' }}>
                    {status === 'linked' ? c.employeeDisplayName
                      : status === 'general' ? '—'
                      : status === 'business' ? (c.businessTag?.replace('_', ' ') ?? '—')
                      : <span style={{ color: '#cc4444' }}>Unassigned</span>}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#ff6b00' }}>
                    {c.branchName ?? '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <StatusBadge status={status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: FilterTab }) {
  const config: Record<FilterTab, { label: string; bg: string; color: string }> = {
    linked: { label: 'Linked', bg: '#1a2a1a', color: '#ff6b00' },
    general: { label: 'General', bg: '#2a2a2a', color: '#888888' },
    unlinked: { label: 'Unlinked', bg: '#2a1a1a', color: '#cc4444' },
    business: { label: 'WH/Signs', bg: '#2a2a2a', color: '#666666' },
    all: { label: '', bg: '', color: '' },
  }
  const { label, bg, color } = config[status]
  if (!label) return null
  return (
    <span style={{ background: bg, color, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500 }}>
      {label}
    </span>
  )
}

function navPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 14px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    background: active ? '#ff6b00' : '#2a2a2a',
    color: active ? '#ffffff' : '#888888',
  }
}

function filterTabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 400,
    background: active ? '#ff6b00' : '#2a2a2a',
    color: active ? '#ffffff' : '#888888',
  }
}
