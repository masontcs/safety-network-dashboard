'use client'

import { useEffect, useMemo, useState } from 'react'
import Sheet from '@/components/tech/Sheet'
import { techApi, TechApiError, type TechItem, type Features } from '@/lib/tech/client'

/**
 * "Add equipment" — full-catalog searchable picker (no prices, ever). qty, an equipment
 * ID for tracked items, and pickup/return ONLY when the ticket is ambiguous (add+return).
 * DTC / add-only / return-only tickets derive the event server-side, so we don't ask.
 */
export default function AddEquipmentSheet({ ticketId, features, onClose, onSaved }: { ticketId: string; features: Features; onClose: () => void; onSaved: () => void }) {
  const [items, setItems] = useState<TechItem[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<TechItem | null>(null)
  const [variationId, setVariationId] = useState('')
  const [qty, setQty] = useState(1)
  const [equipmentId, setEquipmentId] = useState('')
  const [eventType, setEventType] = useState('') // only used when ambiguous
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const ambiguous = features.add && features.return

  useEffect(() => { techApi.listItems().then(setItems).catch(() => {}) }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items.slice(0, 50)
    return items.filter((i) => i.code.toLowerCase().includes(s) || i.name.toLowerCase().includes(s)).slice(0, 50)
  }, [items, q])

  function pick(item: TechItem) {
    setSel(item)
    setVariationId('')
    setEquipmentId('')
    setErr(null)
  }

  async function save() {
    if (busy || !sel) return
    if (sel.variations.length > 0 && !variationId) { setErr('Choose a variation.'); return }
    if (sel.tracked && !equipmentId.trim()) { setErr('This item is tracked — enter its equipment ID.'); return }
    if (ambiguous && !eventType) { setErr('Is this a pickup or a return?'); return }
    setBusy(true); setErr(null)
    try {
      await techApi.addEquipment(ticketId, {
        itemId: sel.id,
        variationId: variationId || null,
        qty,
        eventType: ambiguous ? eventType : undefined,
        equipmentId: sel.tracked ? equipmentId.trim() : null,
      })
      onSaved()
      onClose()
    } catch (e) {
      setErr(e instanceof TechApiError ? e.message : 'Could not add that equipment.')
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add equipment" onClose={onClose}>
      {err && <div className="tech-note err" role="alert">{err}</div>}

      {!sel ? (
        <>
          <input className="tech-input" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div style={{ marginTop: 10 }}>
            {filtered.map((i) => (
              <button key={i.id} type="button" className="tech-item" style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => pick(i)}>
                <div className="body">
                  <div className="t1">{i.name}</div>
                  <div className="t2">{i.code}{i.tracked ? ' · tracked' : ''}{i.variations.length ? ` · ${i.variations.length} variations` : ''}</div>
                </div>
                <span style={{ color: 'var(--dim)', fontSize: 20 }}>›</span>
              </button>
            ))}
            {items.length > 0 && filtered.length === 0 && <div className="tech-empty">No items match “{q}”.</div>}
            {items.length === 0 && <div className="tech-empty">Loading items…</div>}
          </div>
        </>
      ) : (
        <>
          <div className="tech-field">
            <span className="tech-lbl">Item</span>
            <div className="tech-row">
              <div>
                <div className="t1" style={{ fontSize: 16, fontWeight: 600 }}>{sel.name}</div>
                <div className="t2" style={{ color: 'var(--muted)', fontSize: 13 }}>{sel.code}</div>
              </div>
              <button type="button" className="tech-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setSel(null)}>Change</button>
            </div>
          </div>

          {sel.variations.length > 0 && (
            <div className="tech-field">
              <span className="tech-lbl">Variation</span>
              <select className="tech-select" value={variationId} onChange={(e) => setVariationId(e.target.value)}>
                <option value="">Select…</option>
                {sel.variations.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          )}

          <div className="tech-field">
            <span className="tech-lbl">Quantity</span>
            <div className="tech-stepper">
              <button type="button" onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="Less">−</button>
              <div className="val">{qty}</div>
              <button type="button" onClick={() => setQty((n) => n + 1)} aria-label="More">+</button>
            </div>
          </div>

          {sel.tracked && (
            <div className="tech-field">
              <span className="tech-lbl">Equipment ID</span>
              <input className="tech-input" placeholder="e.g. AB-1042" value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} />
            </div>
          )}

          {ambiguous && (
            <div className="tech-field">
              <span className="tech-lbl">Pickup or return?</span>
              <div className="tech-chips">
                <button type="button" className={`tech-chip ${eventType === 'pickup' ? 'on' : ''}`} onClick={() => setEventType('pickup')}>Pickup</button>
                <button type="button" className={`tech-chip ${eventType === 'return' ? 'on' : ''}`} onClick={() => setEventType('return')}>Return</button>
              </div>
            </div>
          )}

          <button className="tech-btn block" onClick={save} disabled={busy}>{busy ? 'Adding…' : 'Add equipment'}</button>
        </>
      )}
    </Sheet>
  )
}
