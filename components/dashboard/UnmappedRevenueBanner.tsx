'use client'

import { useEffect, useState } from 'react'

/**
 * Safety net for the "silent revenue drop" problem: if any branch+entity has revenue but no
 * revenue code, that revenue can fall off code-grouped reports. This banner surfaces it at
 * the top of the dashboard so it's caught immediately instead of by noticing low totals.
 * Renders nothing when everything is mapped.
 */

interface Unmapped { branch: string; entity: string; rows: number; totalRevenue: number }

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function UnmappedRevenueBanner() {
  const [data, setData] = useState<{ unmapped: Unmapped[]; totalUnmapped: number; combos: number } | null>(null)

  useEffect(() => {
    fetch('/api/revenue/unmapped')
      .then((r) => r.json())
      .then((j) => { if (j.success) setData(j.data) })
      .catch(() => {})
  }, [])

  if (!data || data.combos === 0) return null

  return (
    <div style={{
      background: 'var(--alert-warning-bg, #fbf3e4)', border: '1px solid var(--alert-warning-fg, #8a6d00)',
      borderRadius: 12, padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--alert-warning-fg, #8a6d00)', marginBottom: 4 }}>
        ⚠ {money(data.totalUnmapped)} of revenue isn’t attributed to a code
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #555)', marginBottom: 8 }}>
        These branch + entity combinations have revenue but no revenue code, so they can drop off code-grouped reports. Add a revenue code for each to capture it:
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {data.unmapped.map((u) => (
          <span key={`${u.branch}|${u.entity}`} style={{
            fontSize: 12, background: 'var(--bg-surface, #fff)', border: '1px solid var(--border, #e0ddd4)',
            borderRadius: 999, padding: '4px 10px', fontVariantNumeric: 'tabular-nums',
          }}>
            <strong>{u.branch} · {u.entity}</strong> — {money(u.totalRevenue)} ({u.rows} rows)
          </span>
        ))}
      </div>
    </div>
  )
}
