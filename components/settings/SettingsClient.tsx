'use client'

import { useState, useEffect } from 'react'
import Skeleton from '@/components/ui/Skeleton'

interface HqPct {
  safetyNetwork: number
  westernHighways: number
  signs: number
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#2a2a2a',
  border: '1px solid #333333',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  color: '#ffffff',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

export default function SettingsClient() {
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [sn, setSn] = useState('')
  const [wh, setWh] = useState('')
  const [signs, setSigns] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    fetch('/api/admin/settings/hq-allocation')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        const d = json.data as HqPct
        setSn(pctStr(d.safetyNetwork))
        setWh(pctStr(d.westernHighways))
        setSigns(pctStr(d.signs))
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [])

  function pctStr(decimal: number): string {
    return (decimal * 100).toFixed(2)
  }

  function parsePct(str: string): number {
    return parseFloat(str) / 100
  }

  const snVal = parseFloat(sn) || 0
  const whVal = parseFloat(wh) || 0
  const signsVal = parseFloat(signs) || 0
  const total = Math.round((snVal + whVal + signsVal) * 100) / 100
  const totalOk = Math.abs(total - 100) < 0.005

  async function handleSave() {
    if (!totalOk) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch('/api/admin/settings/hq-allocation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safetyNetwork: parsePct(sn),
          westernHighways: parsePct(wh),
          signs: parsePct(signs),
        }),
      })
      const json = await res.json()
      if (!json.success) { setSaveError(json.error); return }
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch {
      setSaveError('Network error — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Settings</div>

      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 4 }}>
          HQ Allocation Percentages
        </div>
        <div style={{ fontSize: 12, color: '#888888', marginBottom: 20 }}>
          Controls how HQ payroll overhead is split between businesses before distributing to branches by revenue share.
        </div>

        {fetchError ? (
          <div style={{ color: '#cc4444', fontSize: 13 }}>Failed to load: {fetchError}</div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3].map((i) => <Skeleton key={i} height={40} />)}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Safety Network */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Safety Network %
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={sn}
                  onChange={(e) => { setSn(e.target.value); setSaveSuccess(false) }}
                  style={{ ...inputStyle, maxWidth: 140 }}
                />
                <span style={{ fontSize: 13, color: '#666666' }}>%</span>
              </div>
            </div>

            {/* Western Highways */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Western Highways %
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={wh}
                  onChange={(e) => { setWh(e.target.value); setSaveSuccess(false) }}
                  style={{ ...inputStyle, maxWidth: 140 }}
                />
                <span style={{ fontSize: 13, color: '#666666' }}>%</span>
              </div>
            </div>

            {/* Signs */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Signs %
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={signs}
                  onChange={(e) => { setSigns(e.target.value); setSaveSuccess(false) }}
                  style={{ ...inputStyle, maxWidth: 140 }}
                />
                <span style={{ fontSize: 13, color: '#666666' }}>%</span>
              </div>
            </div>

            {/* Running total */}
            <div style={{
              padding: '10px 14px',
              background: '#1a1a1a',
              borderRadius: 8,
              border: `1px solid ${totalOk ? '#1a3a1a' : '#3a1a1a'}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{ fontSize: 13, color: '#888888' }}>Total:</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: totalOk ? '#4caf50' : '#cc4444' }}>
                {total.toFixed(2)}%
              </span>
              {totalOk
                ? <span style={{ fontSize: 12, color: '#4caf50' }}>✓ Ready to save</span>
                : <span style={{ fontSize: 12, color: '#cc4444' }}>— must equal exactly 100%</span>
              }
            </div>

            {saveError && (
              <div style={{ fontSize: 12, color: '#cc4444', padding: '8px 10px', background: '#2a1a1a', borderRadius: 6 }}>
                {saveError}
              </div>
            )}

            {saveSuccess && (
              <div style={{ fontSize: 12, color: '#4caf50', padding: '8px 10px', background: '#1a2a1a', borderRadius: 6 }}>
                Saved successfully.
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving || !totalOk}
              className="btn-primary"
              style={{ opacity: (saving || !totalOk) ? 0.5 : 1, alignSelf: 'flex-start', padding: '8px 20px' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
